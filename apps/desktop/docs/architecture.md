# Desktop Architecture

The OpenAdab desktop app is an Electron shell that wraps the `openadab` CLI,
never duplicating workflow logic. The CLI remains the single authoritative
source of truth for project state.

## Process Model

```
┌────────────────────────────────────────────────────────────────┐
│                     ELECTRON MAIN PROCESS                       │
│                                                                │
│  ┌──────────────┐  ┌───────────────┐  ┌────────────────────┐  │
│  │ BrowserWindow│  │ CommandRunner │  │  AgentSupervisor   │  │
│  │  lifecycle   │  │ child_process │  │  ACP sessions      │  │
│  └──────┬───────┘  └───────┬───────┘  └─────────┬──────────┘  │
│         │                  │                     │              │
│  ┌──────┴───────┐  ┌───────┴───────┐  ┌─────────┴──────────┐  │
│  │ ProjectStore │  │  Path Guards  │  │  TranscriptStore   │  │
│  │ (recent     │  │  (boundary    │  │  (command event    │  │
│  │  projects)  │  │   validation) │  │   persistence)     │  │
│  └─────────────┘  └───────────────┘  └────────────────────┘  │
└───────┬────────────────────┬────────────────────┬────────────────┘
        │                    │                    │
   contextBridge        child_process        child_process
   (typed IPC)          .spawn()             .spawn()
        │                    │                    │
┌───────┴────────┐   ┌──────┴──────┐    ┌───────┴──────────┐
│    PRELOAD     │   │  openadab   │    │   ACP Agent      │
│  (isolated     │   │  CLI proc   │    │   (optional)     │
│   world)       │   │             │    │                  │
└───────┬────────┘   └─────────────┘    └──────────────────┘
        │
┌───────┴────────────────────────────────────────────────────┐
│                     RENDERER PROCESS                        │
│                                                             │
│  React app with 7 routes:                                   │
│  Project, Manuscript, Changes, Timeline, Wiki, Schemas,     │
│  Agent                                                      │
│                                                             │
│  window.openadab.* — typed IPC calls only                   │
└─────────────────────────────────────────────────────────────┘
```

### Process Boundaries

| Process | Scope | Has Node access | Has fs access |
|---------|-------|-----------------|---------------|
| **Main** | BrowserWindow lifecycle, child processes, filesystem I/O | Yes | Yes (guarded) |
| **Preload** | contextBridge, narrow typed API surface | Yes (restricted) | No |
| **Renderer** | React UI, state management, editing | No | No |
| **CLI (child)** | Authoritative workflow execution via `openadab` binary | Inherits main env | Via CLI only |
| **Agent (child)** | Optional ACP client, talks JSON-line protocol over stdio | Inherits main env | Via permission gates |

## Data Flow

Every data path follows this pattern:

```
Renderer UI action
  → window.openadab.<channel>(request)
    → preload: ipcRenderer.invoke(channel, request)
      → main: ipcMain.handle(channel, handler)
        → guardFilePath() / CommandRunner / AgentSupervisor
          → disk I/O or child_process.spawn('openadab', args)
        ← result or error
      ← IPC response
    ← promise resolved
  ← UI updated
```

Key principles:

- **Renderer never touches the disk.** All file reads and writes go through
  `ipcMain.handle('file:read')` and `ipcMain.handle('file:write')`, which
  validate paths through `guardFilePath()` before any I/O.

- **CLI is the only workflow authority.** The GUI never directly manipulates
  `adab/changes/` state, manifest files, or wiki indexes. All such mutations
  happen via `openadab` CLI invocations through `CommandRunner`.

- **Streaming output is delivered as events.** While a CLI command runs,
  stdout/stderr chunks are pushed to the renderer via
  `event:command-output`. Completion is signaled via `event:command-complete`.

## Security Model

### Context Isolation

The renderer runs with `contextIsolation: true`, `nodeIntegration: false`,
and `sandbox: true`. The only bridge to Node.js capabilities is the typed
preload API declared in `shared/ipc-types.ts`.

### Path Guards

Every filesystem operation from the renderer passes through
`guardFilePath(requestedPath, projectRoot)` in `electron/path-guards.ts`:

1. Resolve the requested path relative to the project root.
2. Call `realpathSync()` on both the result and the project root to defeat
   symlink escapes.
3. Normalize and verify the result starts with `<projectRoot>/` (or equals
   it).

Any path that resolves outside the project root throws `PathEscapeError`.

### CLI Process Isolation

The CLI runs as a separate child process with `stdin: 'ignore'` to prevent
interactive hijacking. Arguments are passed as an array to `spawn()`, never
as a shell-joined string, avoiding injection on all platforms.

### Command Allow-List

Only a fixed set of 20 `openadab` subcommands may be invoked. Unknown
subcommands are rejected before spawning. See `cli-contracts.md` for the
full list.

### Mutating Command Queue

Commands that mutate project state (`init`, `new`, `sync`, `archive`,
`schema fork`, `wiki apply-diff`, `config set`) are serialized so only one
runs at a time. Read-only commands can execute concurrently.

## CLI Bridge

The `CommandRunner` class in `electron/command-runner.ts` is the single
entry point for all CLI invocations. It:

- Validates against the allow-list.
- Serializes mutating commands through a queue.
- Captures stdout/stderr as streaming events.
- Attempts JSON parse on commands known to support `--json`.
- Persists every command event to the transcript store.

## ACP Integration

Agent processes communicate via the ACP (Agent Communication Protocol), a
simple JSON-line protocol over stdin/stdout. The `AgentSupervisor` in
`electron/agent-supervisor.ts` manages session lifecycle, routes permission
requests to the renderer for user approval, and enforces capability-based
access control. See `permissions.md` for the full permission model.

## State Classification

| Category | Examples | Storage |
|----------|----------|---------|
| **Project truth** | Artifact files, wiki pages, manifest, config | `adab/` directory (CLI-authoritative) |
| **UI state** | Selected route, open tabs, collapsed panels, dirty buffers | Renderer memory (React state) |
| **App preferences** | Recent projects list, window position | Electron `userData` directory |
| **Transcript** | Command event history | `adab/transcript.jsonl` (project-rooted) |
| **Agent logs** | Permission requests, tool calls, session events | `adab/agent-log.jsonl` (project-rooted) |

## Failure Handling

- CLI non-zero exit with partial JSON: both stdout and stderr are preserved
  in the command event, with `parsedJson` alongside `parseError`.
- Save conflict: `file:write` accepts an optional `expectedMtimeMs`. If the
  file on disk has a different mtime, the write is rejected with
  `conflict: true`.
- Missing project root: the UI enters a recoverable state showing the
  project picker.
- Agent disconnect: the session remains readable in the transcript; logs
  are preserved.
