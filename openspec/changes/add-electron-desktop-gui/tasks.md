## 1. Desktop App Scaffold

- [x] 1.1 Add an Electron workspace package under `apps/desktop/` with TypeScript, Vite, React, and build scripts.
- [x] 1.2 Create Electron main, preload, and renderer entry points.
- [x] 1.3 Configure secure BrowserWindow defaults: context isolation on, node integration off, sandbox where compatible.
- [x] 1.4 Define the typed preload API surface for project, CLI, file, transcript, and agent operations.
- [x] 1.5 Add desktop package lint, typecheck, unit test, and dev scripts.

## 2. Project Root and Path Safety

- [x] 2.1 Implement project directory picker and recent projects list.
- [x] 2.2 Implement OpenAdab project detection by checking for `adab/config.yaml`.
- [x] 2.3 Implement path boundary guards for all project reads and writes.
- [x] 2.4 Reject renderer requests that target paths outside the selected project root.
- [x] 2.5 Add tests for Windows, POSIX, relative path, symlink, traversal, and space-containing paths.

## 3. CLI Command Runner and Transcript

- [x] 3.1 Implement `openadab` subprocess runner using argument arrays and explicit cwd.
- [x] 3.2 Capture stdout, stderr, start/end timestamps, exit code, parsed JSON, parse errors, initiator, and cancellation state.
- [x] 3.3 Add command allow-listing for renderer-triggered commands.
- [x] 3.4 Implement command cancellation for long-running sync/index/archive operations.
- [x] 3.5 Persist transcript events per project and support grouping/filtering by initiator.
- [x] 3.6 Render CLI Transcript bottom panel with command details, logs, errors, and JSON payload view.
- [x] 3.7 Add unit and integration tests for success, non-zero exit, invalid JSON, cancellation, and concurrent command queuing.

## 4. Project Workbench

- [x] 4.1 Build Project dashboard route and top status bar.
- [x] 4.2 Display project title, language, active schema, host, project root, and config summary.
- [x] 4.3 Add project initialization flow using `openadab init --json`.
- [x] 4.4 Add update flow using `openadab update --schemas --json`.
- [x] 4.5 Add config get/set UI for safe project fields.
- [x] 4.6 Add recent log panel using `openadab log --limit <N> --json`.
- [x] 4.7 Add wiki lint/index health cards using `openadab wiki lint --json` and `openadab wiki index --json`.
- [x] 4.8 Add recoverable empty, loading, missing project, invalid config, and command failure states.

## 5. Changes Workbench

- [x] 5.1 Build Changes route with artifact DAG, selected artifact header, and lifecycle actions.
- [x] 5.2 Load change status from `openadab status --change <id> --json`.
- [x] 5.3 Render DAG nodes from schema/status data without hardcoding chapter-draft artifacts.
- [x] 5.4 Show artifact status, generated file name, dependencies, blocking issues, and validation issue indicators.
- [x] 5.5 Add new change flow using `openadab new <type> <id> --json`.
- [x] 5.6 Add sync and archive actions gated by validation and confirmation.
- [x] 5.7 Add apply-ready state when CLI next step reports an apply target.
- [x] 5.8 Refresh status after artifact save, validation, sync, archive, and wiki apply.
- [x] 5.9 Add tests for linear DAGs, parallel DAGs, optional artifacts, failed status command, and schema changes.

## 6. Artifact Editor

- [x] 6.1 Add Markdown editor and preview panes for selected artifacts.
- [x] 6.2 Resolve artifact file paths from CLI/schema status instead of hardcoded file names.
- [x] 6.3 Parse and edit YAML frontmatter through a form while preserving Markdown source editability.
- [x] 6.4 Track dirty buffers, base file mtime/hash, unsaved changes, and conflict warnings.
- [x] 6.5 Save artifact drafts only inside `adab/changes/<change-id>/`.
- [x] 6.6 Provide diff preview before overwriting externally changed files.
- [x] 6.7 Load artifact instructions using `openadab instructions <artifact> --change <id> --json --inline-deps`.
- [x] 6.8 Display schema validation hints, required fields, dependencies, equivalent CLI commands, and context budget.
- [x] 6.9 Add editor tests for save, conflict, missing file, frontmatter parse error, and validation refresh.

## 7. Inspector

- [x] 7.1 Build right-side Inspector layout with Context Pack, Validation Center, Wiki Impact, and Agent Dock slots.
- [x] 7.2 Load context packs with `openadab context pack --change <id> --artifact <id> --json`.
- [x] 7.3 Render must-read, optional, excluded, reasons, estimated size, stale-index warnings, and copy-to-prompt action.
- [x] 7.4 Load mechanical validation with `openadab validate --change <id> --mechanical --json`.
- [x] 7.5 Load semantic validation prompt output with `openadab validate --change <id> --semantic --json`.
- [x] 7.6 Label semantic validation as review prompt/manual review unless an agent actually executes it.
- [x] 7.7 Load wiki impact from `openadab wiki diff --change <id> --json` and dry-run output when a wiki-diff exists.
- [x] 7.8 Add panel empty/loading/error states and compact/expanded modes.

## 8. Wiki Diff Review

- [x] 8.1 Build a Wiki Diff review route or modal opened from Changes/Inspector.
- [x] 8.2 Parse and display wiki-diff operations by target page, type, source, payload, and warnings.
- [x] 8.3 Run `openadab wiki apply-diff --change <id> --dry-run --json` before enabling apply.
- [x] 8.4 Require explicit confirmation before `--apply`.
- [x] 8.5 Record apply command and result in transcript.
- [x] 8.6 Implement operation-level accept/skip/edit by creating a temporary filtered wiki-diff file and dry-running it.
- [x] 8.7 Add tests for no wiki-diff, malformed wiki-diff, dry-run failure, apply confirmation denial, and successful apply refresh.

## 9. Manuscript, Wiki, and Timeline Workspaces

- [x] 9.1 Build Manuscript route with chapter Binder, chapter preview, frontmatter display, word count, and chapter status.
- [x] 9.2 Allow safe chapter editing only through explicit manuscript edit mode and diff confirmation.
- [x] 9.3 Build Wiki route with typed page browser, Markdown/frontmatter editor, backlinks, mentions, and lint warnings.
- [x] 9.4 Build Timeline route from progressions, mentions, manuscript order, story time fields where available, and wiki evidence.
- [x] 9.5 Link timeline events back to manuscript or wiki source evidence.
- [x] 9.6 Add stale-index warnings when timeline/wiki views depend on outdated index files.

## 10. Schema Workbench

- [x] 10.1 Build Schemas route with installed schema list and active schema display.
- [x] 10.2 Add schema show and validation views using `openadab schema show` and `openadab schema validate`.
- [x] 10.3 Visualize artifact DAGs for any schema.
- [x] 10.4 Provide schema fork flow using `openadab schema fork <base> <name> --json`.
- [x] 10.5 Add YAML advanced editor with validation before save.
- [x] 10.6 Add schema diff view for forks versus built-in schemas.

## 11. Agent Dock and ACP Integration

- [x] 11.1 Implement Agent Dock UI with session list, active session, mode selector, and capability buttons.
- [x] 11.2 Implement default OpenCode ACP configuration and custom agent command settings.
- [x] 11.3 Implement ACP process/session supervisor in Electron main process.
- [x] 11.4 Implement permission request modal for read files, write artifact drafts, run CLI, modify wiki, modify manuscript, apply wiki diff, sync, and archive.
- [x] 11.5 Log agent tool calls, command requests, file diffs, approvals, denials, failures, and replay data.
- [x] 11.6 Ensure the app remains fully usable when no agent is configured or when the agent process fails.
- [x] 11.7 Add tests for permission denial, draft write approval, CLI run approval, and forbidden canon mutation attempts.

## 12. UX, Accessibility, and Visual Verification

- [x] 12.1 Implement the three-column-plus-bottom-panel layout matching the planned information architecture.
- [x] 12.2 Add responsive behavior for narrow windows without overlap or clipped controls.
- [x] 12.3 Add keyboard navigation for nav, DAG nodes, editor tabs, inspector cards, transcript, and modals.
- [x] 12.4 Add empty, loading, error, dirty, blocked, ready, done, synced, archived, and permission-pending visual states.
- [x] 12.5 Add Playwright/Electron screenshots for Project, Changes, Artifact Editor, Inspector, Wiki Diff Review, and Agent Dock.
- [x] 12.6 Verify visual layout on Windows paths and Chinese project text.

## 13. Documentation

- [x] 13.1 Document desktop architecture and process boundaries.
- [x] 13.2 Document CLI command contracts consumed by the GUI.
- [x] 13.3 Document permission model and agent safety rules.
- [x] 13.4 Add contributor instructions for running and testing the desktop app.
- [x] 13.5 Add user-facing overview for opening a project, editing artifacts, reviewing wiki diff, and using Agent Dock.

## Correctness Hardening

- [ ] Refine project-open IPC so non-project directories are not active projects and the renderer can show initialization recovery.
- [ ] Resolve the OpenAdab CLI entrypoint in development and packaged modes, and emit only one transcript completion when spawning fails.
- [ ] Parse JSON command output from stdout or stderr while preserving raw streams and parse errors.
- [ ] Classify mutating commands by flags, including `wiki index` as mutating and `wiki apply-diff --dry-run` as read-only.
- [ ] Enforce file API subdirectory scopes for reads, writes, directory listing, and temporary review artifacts.
- [ ] Fix config editing so raw string values do not use CLI JSON mode unless the user explicitly selects it.
- [ ] Make operation-level wiki-diff selection use per-operation identities and a CLI-accepted temporary diff format.
- [ ] Replace timeline stale-index refresh commands that lack required CLI arguments with valid sync/index actions and visible errors.
- [ ] Make Agent Dock startup avoid renderer Node globals and surface spawn failures without marking sessions active.
- [ ] Add regression tests for each hardening item before implementing the corresponding fix.
