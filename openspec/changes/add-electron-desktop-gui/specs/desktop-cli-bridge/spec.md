## ADDED Requirements

### Requirement: CLI bridge shall execute OpenAdab through managed child processes
The desktop app SHALL run authoritative OpenAdab operations by resolving an executable OpenAdab CLI entrypoint, spawning it with argument arrays, and setting an explicit cwd for each command.

#### Scenario: Resolve CLI executable
- **WHEN** the desktop app starts in development, workspace, packaged, or globally installed mode
- **THEN** the command runner SHALL resolve the CLI from an explicit configured path when present, then from the local workspace/package build output when present, then from `PATH`
- **AND** it SHALL preserve argument-array spawning for every resolution strategy

#### Scenario: CLI executable missing
- **WHEN** no executable OpenAdab CLI can be resolved
- **THEN** a renderer command request SHALL produce one failed transcript event with stdout, stderr, timestamps, initiator, and a clear executable-resolution error
- **AND** it SHALL NOT emit duplicate completion events for the same command id

#### Scenario: Run status command
- **WHEN** the renderer requests status for change `ch-001`
- **THEN** the main process SHALL spawn the resolved OpenAdab CLI with args `["status", "--change", "ch-001", "--json"]`
- **AND** the cwd SHALL be the selected project root
- **AND** the command SHALL be recorded in the transcript

#### Scenario: Arguments are not shell-joined
- **WHEN** command arguments contain spaces, quotes, or Windows path separators
- **THEN** the command runner SHALL pass arguments as an array to the child process
- **AND** it SHALL NOT construct a shell command string for normal CLI execution

#### Scenario: Command not allowed from renderer
- **WHEN** the renderer requests a command outside the desktop allow-list
- **THEN** the main process SHALL reject the request before spawning a process
- **AND** the rejection SHALL be recorded as a transcript event with no child process pid

### Requirement: CLI bridge shall capture a complete transcript event
Every CLI execution SHALL produce a structured transcript event.

#### Scenario: Successful JSON command
- **WHEN** a CLI command exits with code 0 and stdout contains valid JSON
- **THEN** the transcript event SHALL include command, args, cwd, startedAt, endedAt, exitCode 0, stdout, stderr, parsedJson, and initiator

#### Scenario: Non-zero JSON command
- **WHEN** a CLI command exits non-zero
- **THEN** the transcript event SHALL include stdout and stderr exactly as captured
- **AND** it SHALL include the non-zero exitCode
- **AND** any parseable JSON from stdout or stderr SHALL be preserved without hiding raw output

#### Scenario: Invalid JSON output
- **WHEN** a command requested JSON but neither stdout nor stderr contains parseable JSON
- **THEN** the transcript event SHALL include `parseError`
- **AND** the UI SHALL still render raw stdout and stderr

#### Scenario: Auto-refresh command
- **WHEN** the UI runs a command automatically after a save or lifecycle action
- **THEN** the transcript event SHALL set `initiator` to `auto-refresh`
- **AND** the transcript UI SHALL allow filtering or grouping auto-refresh events

### Requirement: CLI bridge shall support cancellation and concurrency control
The command runner SHALL support safe cancellation and avoid conflicting mutations.

#### Scenario: Cancel long-running command
- **WHEN** the user cancels a running sync, index, validation, or archive command
- **THEN** the command runner SHALL signal the child process to terminate
- **AND** the transcript event SHALL record cancellation state and final exit details if available

#### Scenario: Concurrent read commands
- **WHEN** multiple non-mutating commands are requested for the same project
- **THEN** the command runner SHALL allow concurrent execution unless a project-level command limit has been configured
- **AND** each command SHALL retain its own transcript event

#### Scenario: Concurrent mutating commands
- **WHEN** a mutating command is already running for a project
- **THEN** the command runner SHALL queue or reject another mutating command for that same project
- **AND** it SHALL explain the queue or rejection in the UI

### Requirement: CLI bridge shall classify command mutation risk
The desktop app SHALL classify CLI commands by mutation risk for permission and queuing.

#### Scenario: Read-only command
- **WHEN** running status, instructions, context pack, validate, schema list/show, wiki diff preview, config get, or log
- **THEN** the command SHALL be treated as read-only for queuing
- **AND** it SHALL NOT require a canon mutation confirmation

#### Scenario: Project mutation command
- **WHEN** running init, update, config set, wiki index, wiki apply-diff --apply, sync, archive, schema fork, or artifact save
- **THEN** the command SHALL be treated as mutating
- **AND** it SHALL be subject to confirmation or permission policy based on initiator and target

#### Scenario: Dry-run command
- **WHEN** running wiki apply-diff with `--dry-run` and without `--apply`
- **THEN** the command SHALL be treated as read-only for queuing
- **AND** it SHALL still be recorded in the transcript with its dry-run result

### Requirement: CLI bridge shall preserve project boundary on file APIs
All file reads and writes exposed to the renderer SHALL be resolved within the selected project root and a permitted subdirectory for the requested operation.

#### Scenario: Read project metadata and indexes
- **WHEN** the renderer reads project metadata, logs, generated indexes, schemas, changes, wiki pages, or manuscript chapters
- **THEN** the target SHALL resolve under a known OpenAdab project path such as `adab/config.yaml`, `adab/log.md`, `adab/index/`, `adab/schemas/`, `adab/changes/`, `adab/wiki/`, or `adab/manuscript/chapters/`
- **AND** other project-root files such as package manifests, source code, environment files, or arbitrary user files SHALL be rejected

#### Scenario: Save artifact draft
- **WHEN** the renderer saves an artifact for change `ch-001`
- **THEN** the target path SHALL resolve under `adab/changes/ch-001/`
- **AND** paths outside that directory SHALL be rejected

#### Scenario: Read wiki page
- **WHEN** the renderer reads a wiki page
- **THEN** the target path SHALL resolve under `adab/wiki/`
- **AND** path traversal such as `../` SHALL be rejected after normalization

#### Scenario: Write temporary review artifact
- **WHEN** the renderer creates a temporary wiki-diff review artifact
- **THEN** the write SHALL resolve under `adab/.temp/`
- **AND** the temporary file format SHALL be accepted by the CLI command that will consume it

#### Scenario: Write schema or canon document
- **WHEN** the renderer writes a project schema, wiki page, or manuscript chapter
- **THEN** the target SHALL resolve under `adab/schemas/`, `adab/wiki/`, or `adab/manuscript/chapters/` respectively
- **AND** the initiating UI flow SHALL require validation, diff preview, or explicit confirmation according to the owning workbench requirement

### Requirement: CLI bridge shall normalize existing CLI JSON without breaking compatibility
The desktop app SHALL consume current CLI JSON shapes and add GUI-only normalized view models without requiring breaking CLI changes.

#### Scenario: Current context pack shape
- **WHEN** `openadab context pack --json` returns `mustRead`, `optionalRead`, `excluded`, and `reasons`
- **THEN** the desktop adapter SHALL render those fields directly
- **AND** missing richer fields such as tokens or source category SHALL be displayed as unavailable rather than guessed as authoritative

#### Scenario: Additive CLI fields appear
- **WHEN** a future CLI version returns additional JSON fields
- **THEN** the desktop adapter SHALL preserve and use recognized additive fields
- **AND** it SHALL ignore unrecognized additive fields without failing the command
