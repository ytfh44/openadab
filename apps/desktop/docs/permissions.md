# Permission Model

Agent actions in the desktop app are governed by a capability-based
permission system. Every agent operation that touches the project goes
through a permission gate before the main process executes it.

## Capability Levels

Eight capabilities are defined, each classified by risk:

| Capability | Risk Level | Auto-Approvable | Description |
|-----------|------------|-----------------|-------------|
| `read_project_file` | Low | Yes (after first approval) | Read any file within the project root |
| `write_artifact_draft` | Low | Yes (after first approval) | Write to artifact files under `adab/changes/<id>/` |
| `run_cli` | High | Never | Execute any `openadab` CLI command |
| `modify_wiki` | Canon | Never | Edit files under `adab/wiki/` |
| `modify_manuscript` | Canon | Never | Edit files under `adab/manuscript/` |
| `apply_wiki_diff` | Canon | Never | Apply wiki-diff operations that change wiki pages |
| `sync_change` | Canon | Never | Run `openadab sync` on a change |
| `archive_change` | Canon | Never | Run `openadab archive` on a completed change |

## Risk Classification

### Low-Risk Capabilities

`read_project_file` and `write_artifact_draft` are considered low-risk
because:

- Reading project files is read-only and scoped within the project root.
- Artifact drafts live under `adab/changes/<id>/`, which is a working area
  distinct from canon (wiki and manuscript).

These capabilities can be auto-approved for the remainder of a session
after the user explicitly approves them once. This avoids repetitive
approval prompts during a productive editing flow.

### Canon-Mutation Capabilities

`modify_wiki`, `modify_manuscript`, `apply_wiki_diff`, `sync_change`, and
`archive_change` mutate canon, i.e., project files that are not drafts:

- `adab/wiki/` - the living wiki of characters, locations, threads, and rules.
- `adab/manuscript/` - published or draft manuscript chapters.
- Sync and archive operations that move changes into completed state and
  apply wiki diffs permanently.

Canon mutations **always require explicit user approval** for each
individual operation. They can never be auto-approved.

### `run_cli`

`run_cli` is a special high-risk capability because it can execute any
allow-listed CLI command, including mutating ones. It always requires
explicit approval per invocation, regardless of session state.

## Approval Flow

```
Agent sends ACP message:
  { "type": "permission_request", "capability": "apply_wiki_diff", ... }

AgentSupervisor receives it:
  ├─ Can auto-approve?
  │   ├─ Yes → approve silently, log, return to agent
  │   └─ No  → create PermissionRequest, emit to renderer
  │
  └─ PendingPermission stored with resolve/reject promise
      │
      ▼
  Renderer receives via onPermissionRequest callback
      │
      ▼
  UI shows permission prompt (modal or notification)
      │
      ├─ User clicks Approve
      │     → window.openadab.approvePermission({ requestId, approved: true })
      │       → AgentSupervisor tracks capability for future auto-approval
      │       → Sends { type: "permission_response", requestId, approved: true } to agent
      │
      └─ User clicks Deny
            → window.openadab.denyPermission({ requestId, approved: false })
              → Sends { type: "permission_response", requestId, approved: false } to agent
```

### Permission Request Shape

```ts
{
  id: string;                // UUID for this request
  requestedBy: "agent";      // Always "agent" in current design
  capability: AgentCapability; // One of the 8 capabilities
  scope: string[];           // Files, changes, or resources affected
  commandPreview?: string;   // When run_cli: the command that would execute
  diffPreview?: unknown;     // When wiki/manuscript: preview of the change
}
```

### Permission Response Shape

```ts
{
  requestId: string;         // Matches the request ID
  approved: boolean;         // true = approve, false = deny
  reason?: string;           // Optional reason for audit log
}
```

## Agent Logging

Every permission decision is logged to `adab/agent-log.jsonl` in the
project directory via the `AgentLogger` class. Each log entry includes:

- `timestamp` - Unix ms and ISO 8601 string.
- `event` - Event type (`permission_request`, `permission_response`,
  `session_start`, `session_stop`, `session_error`, `message`, `tool_call`).
- `sessionId` - Active agent session ID.
- `description` - Human-readable summary.
- `payload` - Full event data for detailed audit.

Log entries are append-only and designed to be both machine-readable (JSONL)
and human-auditable.

## Security Principles

1. **Least privilege.** The agent process has no direct filesystem or
   process access. All operations go through permission-gated IPC calls
   handled by the main process.

2. **Explicit approval for canon.** Any operation that touches wiki,
   manuscript, or change lifecycle requires explicit user confirmation
   with a preview of what will change.

3. **Auditability.** All permission decisions, agent messages, and tool
   calls are logged to a project-local file that can be reviewed
   independently of the GUI.

4. **Session scoping.** Capability auto-approval is scoped to a single
   agent session. Closing and reopening a session resets all approvals.

5. **No silent escalation.** Low-risk capabilities cannot be used as a
   stepping stone to canon mutation. Each capability gate is checked
   independently.

## Session Lifecycle

| State | Meaning |
|-------|---------|
| `none` | No agent configured or session active |
| `starting` | Agent process is spawning |
| `running` | Agent is connected and accepting messages |
| `stopped` | Session ended normally |
| `error` | Agent process failed to start or crashed |

Only one session can be active at a time. Starting a new session while one
is running throws an error. Stopping a session rejects all pending
permission requests and cleans up the child process.
