## Context

OpenAdab is currently a TypeScript CLI and library codebase. Its core workflows are local-first and schema-driven:

- Project state lives under `adab/`.
- Changes live under `adab/changes/<change-id>/`.
- Schemas define artifacts, dependencies, templates, validation rules, context budgets, and apply targets.
- The CLI exposes project lifecycle, change status, instructions, context packing, validation, wiki diff, sync, archive, schema, config, and log commands.

The desktop GUI must preserve those invariants while making the workflow easier to see, edit, review, and supervise.

## Goals / Non-Goals

**Goals:**
- Build an Electron desktop shell with separate main, preload, and renderer layers.
- Keep OpenAdab CLI and OpenAdab GUI as separate processes.
- Make schema workflows visible through an artifact DAG.
- Provide a safe Markdown editing surface for change artifacts and selected project documents.
- Expose context packing, validation, wiki impact, and CLI logs in the main workflow.
- Provide an ACP Agent Dock that is useful but never required.
- Make every canon-changing action reviewable and auditable.

**Non-Goals:**
- Do not invoke hosted LLM APIs from the GUI as part of the baseline app.
- Do not store OpenAdab project truth outside the project directory.
- Do not require the user to run a daemon.
- Do not mutate `adab/wiki/**` or `adab/manuscript/**` from an agent without user approval.
- Do not replace Git or implement multi-user collaboration.

## Architecture

```
Electron Main Process
  - BrowserWindow lifecycle
  - project root selection and validation
  - child-process command runner for `openadab`
  - bounded filesystem reads and writes
  - ACP process/session supervision
  - transcript event persistence

Preload
  - narrow typed IPC bridge
  - no broad fs/process exposure

Renderer
  - React application
  - routes and workbench state
  - editors and previews
  - diff and permission UI
  - command result rendering

OpenAdab CLI Process
  - authoritative workflow execution
  - project reads/writes for CLI operations
  - schema validation and context packing
  - wiki diff, sync, archive, config, log

Agent Process
  - optional ACP client target
  - reads context only through approved UI handoff
  - writes drafts only through approved artifact APIs
  - requests CLI execution through permission gate
```

## Package Layout

Recommended workspace layout:

```
apps/desktop/
  package.json
  electron/
    main.ts
    preload.ts
    command-runner.ts
    project-store.ts
    path-guards.ts
    agent-supervisor.ts
    transcript-store.ts
  renderer/
    src/
      app.tsx
      routes/
      components/
      workbenches/
      state/
      api/
      styles/
  tests/
```

Shared types can be imported from existing schema/type files where doing so does not couple the renderer to runtime domain modules. If a type is needed by both CLI and desktop app, prefer moving it to a stable shared type module instead of importing implementation classes.

## Decisions

### 1. CLI Remains Authoritative

**Decision:** The GUI SHALL invoke `openadab` as a child process for authoritative workflow operations.

**Rationale:** This preserves the existing local-first CLI contract and avoids two divergent implementations of workflow state.

**Rejected alternative:** Import `src/modules/*` directly into Electron main or renderer for speed. This would blur process boundaries, make CLI and GUI state diverge, and encourage GUI-only behavior not visible to terminal users.

### 2. Renderer Uses a Narrow IPC Bridge

**Decision:** The renderer SHALL only access project files and CLI commands through typed preload APIs.

**Rationale:** Electron renderers must not have unrestricted Node access. It also lets the main process enforce path boundaries, transcript logging, and permission checks.

### 3. UI State Is Not Project State

**Decision:** Selection, dirty buffers, panel state, transcript filters, and agent sessions are UI state. Artifact status, sync readiness, wiki operations, and archive state come from CLI output or project files.

**Rationale:** A local-first project must remain understandable outside the GUI.

### 4. The Changes Workbench Is the Primary Writing Workflow

**Decision:** The Changes page SHALL be the core workbench. Project, Manuscript, Timeline, Wiki, Schemas, and Agent are peer top-level areas, but the artifact DAG is the main operational view.

**Rationale:** OpenAdab's distinguishing model is schema-driven artifact workflow, not ordinary document browsing.

### 5. Agent Dock Is a Side Tool

**Decision:** Agent functionality SHALL live in a right-side dock or dedicated Agent workspace, never as the home page or required path.

**Rationale:** The product must remain complete for non-AI operation. Agent actions are assistive and permissioned.

## Interaction Tensions and Resolutions

### Tension: Fast Writing vs Review Gates

Writers want low-friction writing. OpenAdab needs review gates for canon mutations.

**Resolution:** Artifact drafts can be saved quickly to `adab/changes/<id>/`. Writes to manuscript chapters, wiki pages, sync, archive, and wiki apply require confirmation or diff review.

### Tension: Rich GUI State vs Local-First Truth

The GUI can know about selected tabs, dirty buffers, collapsed panels, and agent sessions, but OpenAdab truth must remain file-backed.

**Resolution:** GUI state is persisted separately as app preferences. Project status is recomputed from CLI commands and project files after meaningful actions.

### Tension: Schema-Driven Generic UI vs Polished Chapter-Draft UX

A generic DAG renderer handles custom schemas, but fiction writers expect chapter-specific affordances.

**Resolution:** The default UI is schema-generic. Optional presentation adapters may improve built-in schemas, but every feature must degrade to the generic artifact model.

### Tension: Context Transparency vs Inspector Noise

Context Pack is central, but showing every file and reason can overwhelm.

**Resolution:** Inspector cards show compact summaries first and expandable detail lists. Must-read is visible by default; optional and excluded lists are collapsible.

### Tension: Semantic Validation Placeholder vs User Expectations

Current semantic validation produces review prompts rather than executing an LLM.

**Resolution:** GUI labels semantic validation as "review prompt / manual semantic review" until an agent or host executes it. It must not present placeholder output as a completed semantic verdict.

### Tension: Agent Productivity vs Permission Safety

Agents are useful when they can run commands and edit drafts, but dangerous if they can silently mutate canon.

**Resolution:** Permissions are capability-based. Read context and write artifact draft can be low-risk. Run CLI, modify wiki, modify manuscript, sync, archive, and apply wiki diff require explicit review.

### Tension: Auto Refresh vs Transcript Clutter

Auto-refreshing status after saves improves clarity but can flood the transcript.

**Resolution:** Transcript stores all commands but supports grouping and initiator filters. Auto-refresh commands are marked as `auto-refresh`.

### Tension: Direct File Edits vs CLI Validation

The GUI editor writes files. The CLI validates files. Combining both into one memory state would hide failures.

**Resolution:** Save is a file operation. Validation is a separate CLI command. After save, status and validation are refreshed through the command runner.

### Tension: Operation-Level Wiki Review vs Existing CLI Full Apply

Users need per-operation review, while the original CLI path applies a full wiki-diff Markdown document.

**Resolution:** Full dry-run and full apply use the original change artifact. Operation-level accept/skip/edit must materialize a temporary filtered document in a format the CLI explicitly accepts. That format may be valid wiki-diff Markdown or an additive operation-document JSON contract; it must not be an ad hoc renderer-only shape that the CLI parser cannot consume.

### Tension: Timeline Authority vs Inferred Indexes

Timeline views are derived from progression, mention, manuscript, and wiki indexes.

**Resolution:** Timeline is an inspector/explorer view, not an authority. It links every event to source evidence and flags stale indexes.

### Tension: Cross-Platform Paths vs Project Safety

Electron runs on Windows, macOS, and Linux. OpenAdab project paths may contain spaces and platform separators.

**Resolution:** Main process uses path normalization and boundary checks for every file operation. CLI subprocess args are passed as arrays, not shell-joined strings.

## State Model

Renderer state:

```ts
type DesktopSelection = {
  projectRoot: string | null;
  route: "project" | "manuscript" | "changes" | "timeline" | "wiki" | "schemas" | "agent";
  changeId?: string;
  artifactId?: string;
  wikiPage?: string;
  chapterPath?: string;
};
```

Command event:

```ts
type CommandEvent = {
  id: string;
  command: "openadab";
  args: string[];
  cwd: string;
  startedAt: string;
  endedAt?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  parsedJson?: unknown;
  parseError?: string;
  initiator: "user" | "agent" | "auto-refresh";
};
```

Permission request:

```ts
type PermissionRequest = {
  id: string;
  requestedBy: "agent" | "renderer";
  capability:
    | "read_project_file"
    | "write_artifact_draft"
    | "run_cli"
    | "modify_wiki"
    | "modify_manuscript"
    | "apply_wiki_diff"
    | "sync_change"
    | "archive_change";
  scope: string[];
  commandPreview?: string;
  diffPreview?: unknown;
};
```

## CLI Contract Strategy

Use existing commands first:

- `openadab init --schema <name> --host <name> --json`
- `openadab update --schemas --json`
- `openadab schema list --json`
- `openadab schema show <name> --json`
- `openadab schema validate <path> --json`
- `openadab schema fork <base> <name> --json`
- `openadab new <type> <id> --json`
- `openadab status --change <id> --json`
- `openadab instructions <artifact> --change <id> --json --inline-deps`
- `openadab context pack --change <id> --artifact <id> --json`
- `openadab validate --change <id> --mechanical --json`
- `openadab validate --change <id> --semantic --json`
- `openadab wiki lint --json`
- `openadab wiki index --json`
- `openadab wiki diff --change <id> --json`
- `openadab wiki apply-diff --change <id> --dry-run --json`
- `openadab wiki apply-diff --change <id> --apply --json`
- `openadab sync --change <id> --json`
- `openadab archive <change-id> --json`
- `openadab config get <path> --json`
- `openadab config set <path> <value> --json`
- `openadab log --limit <N> --json`

Additive CLI improvements are acceptable where the current output is too thin for the GUI:

- Context pack item metadata: tokens, bucket, source reason, pin state.
- Wiki diff dry-run operation details: target, operation type, old value, new value, evidence, risk warnings.
- Status details: manifest status, apply readiness, validation issue count, generated file path, optional artifact marker.
- Project status command if repeated dashboard calls become too expensive.

## Failure Handling

- Command failure SHALL be shown in the transcript and relevant panel.
- JSON parse failure SHALL not discard stdout/stderr.
- If a command exits non-zero with partial stdout JSON and stderr error JSON, the command event SHALL keep both.
- Save conflicts SHALL compare buffer base mtime/hash with current file state before write.
- If a project root no longer exists, the UI SHALL enter a recoverable missing-project state.
- If an agent disconnects, the session remains readable and replayable.

## Testing Strategy

- Unit tests for path guards, command runner argument construction, transcript event reducers, permission policy, and UI state selectors.
- Integration tests with temporary OpenAdab projects generated by the CLI.
- Electron/Playwright tests for opening a project, viewing DAG, editing an artifact, saving, refreshing status, running validation, previewing wiki diff, and denying an agent permission.
- Snapshot tests for command event envelopes and context/validation/wikidiff renderer adapters.
- Accessibility checks for keyboard navigation across nav, DAG, editor tabs, inspector, transcript, and modal permission prompts.

## Migration Strategy

This is additive. Existing CLI users continue unchanged. The GUI can be built and shipped as a workspace package without changing CLI behavior, except for additive JSON fields or new commands.
