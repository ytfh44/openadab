## Why

OpenAdab already has a strong local-first CLI core for schema-driven fiction workflows, but the CLI exposes the work as commands and files. That is powerful for agents and terminal users, yet it leaves the writer to mentally assemble the current project state, artifact graph, context pack, validation result, wiki impact, and audit trail.

Long-form fiction work has a specific interaction problem: the writer needs to stay inside the manuscript and change workflow while still seeing what is canon, what is provisional, what the agent can read, what the CLI will mutate, and what must be reviewed before becoming part of the project. A desktop GUI can make those boundaries visible without weakening the CLI as the authority.

This change proposes an Electron desktop application for OpenAdab. The GUI is not a replacement for the CLI and does not embed CLI business logic. It is an orchestration, editing, review, and visibility layer around the existing command surface and project directory.

## What Changes

Add an Electron desktop GUI as a separate application package inside the repository. The desktop app provides:

- A project health dashboard that answers whether the current novel project is ready to continue.
- A schema-driven Changes workbench with an Artifact DAG as the main visual.
- A structured Markdown Artifact Editor with frontmatter editing, preview, dependency awareness, and safe save behavior.
- A right-side Inspector showing Context Pack, Validation, Wiki Impact, and Agent Dock.
- A bottom CLI Transcript that records every command, output stream, parsed JSON payload, error, exit code, and initiator.
- A Wiki Diff review table that supports dry-run, review, and explicit apply gates.
- Manuscript, Wiki, Timeline, Schema, and Agent workspaces that remain local-first and file-backed.
- A permission model that keeps agents subordinate to the UI and CLI. Agents may assist, draft, review, and request actions, but may not bypass review gates for canon mutations.

The GUI SHALL call `openadab` through a managed child process command runner for authoritative operations such as status, context packing, validation, wiki diff preview, sync, and archive. The renderer SHALL NOT import domain modules from `src/modules/*` to decide canonical OpenAdab state. Direct filesystem access from the renderer SHALL be disallowed.

## Capabilities

### New Capabilities

- `desktop-shell`: Electron application shell, window lifecycle, top navigation, project selection, route model, and UI-to-main-process boundaries.
- `desktop-cli-bridge`: Command runner, JSON parsing, subprocess lifecycle, cancellation, cwd management, transcript capture, and error envelopes.
- `desktop-project-workbench`: Project status and health dashboard, project initialization, config display/edit, update, log view, wiki lint and index health.
- `desktop-change-workbench`: Schema-driven artifact DAG, change creation, change status, artifact selection, lifecycle actions, and apply readiness.
- `desktop-artifact-editor`: Markdown artifact editor, frontmatter form, preview, buffered saves, diff preview, schema field hints, validation feedback, and safe file writes.
- `desktop-inspector`: Context Pack, Validation Center, Wiki Impact, and cross-panel state derived from the selected project/change/artifact.
- `desktop-wiki-diff-review`: Review-first wiki-diff preview, dry-run, explicit apply, operation-level accept/skip/edit planning, and post-apply audit.
- `desktop-agent-dock`: ACP client integration, OpenCode default agent support, custom agent command configuration, permission requests, tool-call display, and agent session replay.
- `desktop-manuscript-wiki-timeline`: Manuscript Binder, chapter editor/preview, wiki browser/editor, wikilink graph, mentions/progressions views, and continuity timeline.
- `desktop-schema-workbench`: Schema list/show/validate/fork, schema DAG visualization, YAML editor, schema diff, and template/instruction browsing.

### Modified Capabilities

- CLI JSON contracts SHALL receive additive extensions when the GUI requires richer display data, such as token estimates per context file, command metadata, wiki-diff operation previews, and status details beyond `blocked`, `ready`, and `done`.
- Existing CLI commands SHALL remain backward compatible. GUI-specific enrichments SHALL be additive fields or new commands/flags, not breaking changes to current JSON shapes.

## Impact

- **New app package**: Add `apps/desktop/` or equivalent workspace package for Electron main, preload, and renderer code.
- **No CLI authority loss**: The CLI remains the canonical executor for OpenAdab workflows. GUI state is view/edit/session state, not project truth.
- **Local-first preserved**: All project content remains in the local project directory. The GUI stores only user interface preferences, recent projects, unsaved buffer metadata, and agent session logs.
- **Security boundary**: Renderer uses preload IPC APIs only. Main process validates project roots and path boundaries before reading or writing project files.
- **Agent boundary**: ACP agents are external or child processes under explicit UI supervision. They can propose and draft, but canon writes require user approval and CLI/file gates.
- **Testing scope**: Requires unit tests for command runner/path guards/state reducers, integration tests with fixture OpenAdab projects, and Playwright/Electron UI tests for core workflows.
- **Out of scope for first implementation**: Cloud sync, multi-user collaboration, hosted AI calls, real-time co-editing, mobile app, and automatic unreviewed semantic validation.

## Non-Goals

- Reimplementing OpenAdab CLI modules in the renderer.
- Treating the GUI as a file explorer with a thin command palette.
- Making the Agent Dock the primary workflow.
- Applying wiki or manuscript mutations without a reviewable diff or explicit confirmation.
- Introducing a remote service or database requirement.
- Requiring a specific AI host for non-agent workflows.

## Success Criteria

- A user can open or initialize an OpenAdab project from the desktop app.
- The Project page accurately summarizes project readiness using CLI and filesystem evidence.
- The Changes page renders the active schema artifact DAG and selects artifacts from CLI status.
- The Artifact Editor saves draft artifact files safely and refreshes CLI status after save.
- Context Pack, Mechanical Validation, Semantic Validation, and Wiki Impact are visible for the selected artifact/change.
- Wiki-diff operations can be previewed with dry-run before apply, and apply requires explicit confirmation.
- Every CLI execution appears in the transcript with command, cwd, output, exit code, and initiator.
- Agent actions are gated by permissions and cannot directly mutate canon files.
- The app remains usable without any agent configured.
