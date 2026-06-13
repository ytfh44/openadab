# CLI Command Contracts

The desktop GUI invokes `openadab` as a child process for all workflow
operations. This document lists every command the GUI may use, the expected
JSON response shape when `--json` is passed, and how errors are surfaced.

## Allow-List

The `CommandRunner` in `electron/command-runner.ts` enforces a fixed
allow-list of 20 subcommands. Any command not in this list is rejected
before spawning.

### Project Management

| Command | Mutating | Flags |
|---------|----------|-------|
| `openadab init --schema <name> --host <name> --json` | Yes | `--json` for structured output |
| `openadab update --schemas --json` | Yes | `--json` |

### Change Management

| Command | Mutating | Flags |
|---------|----------|-------|
| `openadab new <type> <id> --json` | Yes | `--json` |
| `openadab status --change <id> --json` | No | `--json` |
| `openadab instructions <artifact> --change <id> --json --inline-deps` | No | `--json` |
| `openadab context pack --change <id> --artifact <id> --json` | No | `--json` |
| `openadab validate --change <id> --mechanical --json` | No | `--json` |
| `openadab validate --change <id> --semantic --json` | No | `--json` |
| `openadab sync --change <id> --json` | Yes | `--json` |
| `openadab archive <change-id> --json` | Yes | `--json` |

### Schema

| Command | Mutating | Flags |
|---------|----------|-------|
| `openadab schema list --json` | No | `--json` |
| `openadab schema show <name> --json` | No | `--json` |
| `openadab schema validate <path> --json` | No | `--json` |
| `openadab schema fork <base> <name> --json` | Yes | `--json` |

### Wiki

| Command | Mutating | Flags |
|---------|----------|-------|
| `openadab wiki lint --json` | No | `--json` |
| `openadab wiki index --json` | No | `--json` |
| `openadab wiki diff --change <id> --json` | No | `--json` |
| `openadab wiki apply-diff --change <id> --dry-run --json` | No | `--json` |
| `openadab wiki apply-diff --change <id> --apply --json` | Yes | `--json` |

### Config & Log

| Command | Mutating | Flags |
|---------|----------|-------|
| `openadab config get <path> --json` | No | `--json` |
| `openadab config set <path> <value> --json` | Yes | `--json` |
| `openadab log --limit <N> --json` | No | `--json` |

## Command Invocation Model

Commands are sent from the renderer via the typed IPC bridge:

```ts
// Renderer calls:
const event = await window.openadab.runCli({
  commandId: crypto.randomUUID(),
  args: ['status', '--change', 'ch-001', '--json'],
  cwd: '/path/to/project',
  initiator: 'user',
});
```

The main process:

1. Validates the subcommand against the allow-list.
2. Queues it if it's mutating and another mutating command is running.
3. Spawns `openadab` with the args array via `child_process.spawn()`.
4. Streams `stdout` and `stderr` chunks as `event:command-output` events.
5. On completion, attempts JSON parse for commands supporting `--json`.
6. Fires `event:command-complete` with the full `CommandEvent` payload.
7. Persists the event to the transcript store.

## CommandEvent Shape

Every CLI invocation produces a `CommandEvent`:

```ts
{
  id: string;               // UUID from the request
  command: "openadab";      // Fixed literal
  args: string[];           // The argument array as passed
  cwd: string;              // Working directory
  startedAt: string;        // ISO 8601 timestamp
  endedAt?: string;         // ISO 8601 (present on completion)
  exitCode?: number;        // Process exit code (NaN on spawn failure)
  stdout: string;           // Full stdout capture
  stderr: string;           // Full stderr capture
  parsedJson?: unknown;     // JSON.parse(stdout) when applicable
  parseError?: string;      // Present when JSON parse fails
  initiator: "user" | "agent" | "auto-refresh";
  cancelled: boolean;       // True when killed via SIGTERM/SIGKILL
}
```

## Expected JSON Response Shapes

When `--json` is passed, the CLI writes JSON to stdout. The `CommandRunner`
parses this into `parsedJson`. Below are the expected shapes for common
commands.

### `status --change <id> --json`

```json
{
  "changeId": "ch-001",
  "type": "chapter",
  "status": "in_progress",
  "artifacts": [
    {
      "id": "brief",
      "type": "brief",
      "state": "done",
      "instructions": "...",
      "filePath": "adab/changes/ch-001/brief.md"
    },
    {
      "id": "draft",
      "type": "draft",
      "state": "ready",
      "instructions": "...",
      "filePath": "adab/changes/ch-001/draft.md"
    }
  ],
  "manifestStatus": "valid",
  "applyReadiness": "ready",
  "validationIssueCount": 0,
  "generatedFilePath": null
}
```

### `context pack --change <id> --artifact <id> --json`

```json
{
  "artifact": "draft",
  "change": "ch-001",
  "context": [
    {
      "path": "adab/wiki/characters/alice.md",
      "reason": "Mentioned in manuscript chapter 5",
      "bucket": "must_read",
      "tokens": 450,
      "pinned": false
    }
  ],
  "totalTokens": 3200
}
```

### `wiki diff --change <id> --json`

```json
{
  "changeId": "ch-001",
  "operations": [
    {
      "target": "characters/alice",
      "field": "status",
      "operation": "update",
      "oldValue": "alive",
      "newValue": "deceased",
      "evidence": "Chapter 7 draft states character death",
      "risk": "high"
    }
  ]
}
```

### `validate --change <id> --mechanical --json`

```json
{
  "changeId": "ch-001",
  "passed": true,
  "issues": [],
  "checks": [
    { "name": "file-existence", "passed": true },
    { "name": "frontmatter", "passed": true }
  ]
}
```

### `schema list --json`

```json
{
  "schemas": [
    {
      "name": "chapter-draft",
      "version": "1.0.0",
      "description": "Chapter draft workflow",
      "artifacts": ["brief", "outline", "draft", "revision"],
      "builtin": true
    }
  ]
}
```

## Error Handling

### Command Rejection

When a subcommand is not in the allow-list, the `CommandRunner` returns a
`CommandEvent` with `exitCode: NaN` and a descriptive `stderr` message
without spawning a process.

### Spawn Failure

If `spawn()` throws (e.g., `openadab` not found in PATH), the event has
`exitCode: NaN` and `stderr` contains the spawn error.

### Non-Zero Exit

The `exitCode` reflects the process exit code. `stdout` and `stderr` are
captured in full. If `stdout` contains valid JSON despite the non-zero exit,
`parsedJson` is populated and `stderr` (if any) is preserved alongside it.

### JSON Parse Failure

`parseError` contains the `JSON.parse` error message. `parsedJson` is
`undefined`. The raw `stdout` is always available as a fallback for the UI.

### Cancellation

`cli:cancel` sends SIGTERM (or SIGKILL on Windows). The resulting event has
`cancelled: true` and `exitCode: NaN`.

## Mutating Command Queue

Commands classified as mutating (`init`, `new`, `sync`, `archive`,
`schema fork`, `wiki apply-diff`, `config set`, `update`) are serialized.
Only one mutating command runs at a time. If a mutating command is requested
while another is running, it's queued and executed when the current one
finishes. Read-only commands can run concurrently with a mutating command,
but not with each other if they access the same resources.

## Initiator Tags

Every command is tagged with an initiator for transcript filtering:

| Initiator | Meaning |
|-----------|---------|
| `user` | Triggered by a direct UI action (button click, keyboard shortcut) |
| `agent` | Triggered by an agent permission grant |
| `auto-refresh` | Triggered automatically after save or navigation |

The transcript panel supports filtering by initiator to reduce noise from
auto-refresh commands.
