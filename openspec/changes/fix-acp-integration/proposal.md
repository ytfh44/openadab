## Why

The desktop app's `agent-supervisor.ts` spawned OpenCode with `opencode agent --acp` (invalid flag) and communicated via a custom `{ type, content }` JSON protocol over stdio. An initial fix replaced this with `opencode acp` using `@agentclientprotocol/sdk`, implementing the ACP v1 lifecycle (initialize → session/new → session/prompt).

**Follow-up audit against `@agentclientprotocol/sdk` v0.25.0 and the official ACP v1 schema reveals three critical correctness bugs in the existing implementation:**

1. **ContentChunk text extraction broken**: `handleAcpSessionUpdate` casts `SessionUpdate` to `{ text?: string }` for `agent_message_chunk` / `agent_thought_chunk`, but ACP `ContentChunk` has `content: ContentBlock` (a discriminated union of `TextContent`, `ImageContent`, `ResourceLink`, etc.). Correct extraction: `chunk.content.type === "text"` → `chunk.content.text`. Currently `chunk.text` is always `undefined` — **no agent text messages are forwarded to the renderer**.

2. **Plan type structure mismatch**: Code reads `plan.title` but ACP `Plan` has `entries: PlanEntry[]` with no `title` property. Plan notifications always emit empty content.

3. **Missing SessionUpdate discriminator values**: Only 6 of 13 variants are handled. Unhandled (`user_message_chunk`, `plan_update`, `plan_removed`, `available_commands_update`, `current_mode_update`, `config_option_update`, `session_info_update`, `usage_update`) fall through to a generic default, losing context window info, mode changes, available commands, and user echo.

4. **Spec-test mismatch**: The `acp-client/spec.md` describes `{ update: { type: "agent_message", ... } }` but the actual ACP discriminator is `sessionUpdate: "agent_message_chunk"`.

## What Changes

- **DONE**: Change default agent command from `opencode agent --acp` to `opencode acp`
- **DONE**: Replace custom JSON protocol with `AcpClient` using `@agentclientprotocol/sdk`
- **DONE**: Implement ACP lifecycle (initialize, session/new, session/prompt, session/cancel)
- **FIX**: Correct `ContentChunk` text extraction — use discriminated `ContentBlock` union
- **FIX**: Correct `Plan` handling — iterate `plan.entries` instead of `plan.title`
- **FIX**: Add handlers for 8 missing `SessionUpdate` discriminator values
- **FIX**: Correct spec example discriminator names to match ACP types

## Capabilities

### Modified Capabilities
- `acp-client`: Correct `SessionNotification` / `SessionUpdate` parsing to match `@agentclientprotocol/sdk` v0.25.0 types; handle all 13 discriminator values with proper content extraction
- `desktop-agent-dock`: Correct agent message forwarding by fixing `ContentChunk` and `Plan` extraction

## Impact

- Affected code: `electron/agent-supervisor.ts` (handleAcpSessionUpdate rewrite), `tests/agent-supervisor.test.ts` (add ContentChunk/Plan/missing handler tests), `tests/acp-client.test.ts` (add ContentChunk extraction tests), `openspec/changes/fix-acp-integration/specs/acp-client/spec.md` (correct discriminator names)
