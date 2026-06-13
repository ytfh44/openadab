## Context

The desktop app (`apps/desktop`) `electron/agent-supervisor.ts` wraps `electron/acp-client.ts` which uses `@agentclientprotocol/sdk` v0.25.0 to communicate with `opencode acp` via JSON-RPC 2.0 over stdio. The ACP v1 lifecycle is: `initialize` → `session/new` → `session/prompt`. The agent sends `session/update` notifications during a prompt turn to stream content, tool calls, plans, and metadata.

**Current state:** The initial implementation correctly implements the ACP lifecycle (initialize, session creation, prompt sending, cancellation) but has correctness bugs in the `SessionUpdate` notification handler that prevent agent text from reaching the renderer and drop several notification types.

## Goals / Non-Goals

**Goals:**
- Fix `handleAcpSessionUpdate` to correctly extract text from `ContentChunk` notifications
- Fix `plan` handler to iterate `plan.entries` instead of reading `plan.title`
- Add handlers for all 13 `SessionUpdate` discriminator values defined by ACP v1
- Update tests to cover the corrected extraction logic

**Non-Goals:**
- Changing the ACP lifecycle (initialize/session/prompt/cancel are correct)
- Adding multi-session support
- Supporting ACP v2

## Decisions

### Root Cause: ContentChunk structure

The `@agentclientprotocol/sdk` v0.25.0 defines:

```typescript
type ContentChunk = { content: ContentBlock; messageId?: MessageId | null };

type ContentBlock = (TextContent & { type: "text" })
                 | (ImageContent & { type: "image" })
                 | (AudioContent & { type: "audio" })
                 | (ResourceLink & { type: "resource_link" })
                 | (EmbeddedResource & { type: "resource" });

type TextContent = { text: string; annotations?: Annotations | null };
```

The current code in `handleAcpSessionUpdate` casts to `{ text?: string }`:
```typescript
case "agent_message_chunk": {
    const chunk = update as unknown as { text?: string };  // WRONG
    if (chunk.text) { ... }  // always undefined
}
```

**Fix:** Cast to `ContentChunk`, check `content.type === "text"`, extract `content.text`.

### Root Cause: Plan structure

ACP defines `Plan` as:
```typescript
type Plan = { entries: PlanEntry[] };
type PlanEntry = { status: "pending"|"in_progress"|"completed"|"cancelled"; content: string; priority?: PlanPriority };
```

The current code accesses `plan.title` which does not exist. **Fix:** Iterate `plan.entries` and emit each entry's status and content.

### Decision: Complete SessionUpdate discriminator handling

The 13 discriminator values from `SessionUpdate` (SDK v0.25.0):
```
user_message_chunk     → emit as "agent" role message (user echo)
agent_message_chunk    → emit as "agent" role message
agent_thought_chunk    → emit as "system" role message with [thought] prefix
tool_call              → emit tool call info + route to permission
tool_call_update       → emit tool call update info
plan                   → emit plan entries
plan_update            → emit plan update entries
plan_removed           → emit plan removal notice
available_commands_update → emit available commands change
current_mode_update    → emit mode switch notice
config_option_update   → emit config change notice
session_info_update    → emit session metadata (model, cost)
usage_update           → emit context window / token usage info
```

Each unhandled variant currently falls through to a generic `[unknown]` message. **Fix:** Add explicit cases for all 13 values with appropriate content extraction.

### Risk: PlanEntry content could be large

**Mitigation:** Truncate plan entry content to 200 chars in the IPC message, keeping the full data available for future structured display.

## Risks / Trade-offs

- **[Risk] `ContentBlock` union is runtime-untyped** → Mitigation: Always check `content.type` discriminator before accessing sub-fields; emit warning for unknown types.
- **[Trade-off] Full SessionUpdate coverage increases handler complexity** → Acceptable; the discriminated union is finite (13 variants) and each handler is ~5 lines
- **[Risk] plan_update/plan_removed are marked unstable in SDK** → Mitigation: Guard with feature detection; handle missing fields gracefully
