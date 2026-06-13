# desktop-agent-dock Specification

## Purpose
Defines the Agent Dock for managing agent sessions via ACP, including bundled opencode CLI resolution in packaged builds.
## Requirements
### Requirement: Agent Dock shall be optional and subordinate to the GUI workflow
The desktop app SHALL remain fully usable without an agent configured or running.

#### Scenario: No agent configured
- **WHEN** no agent command is configured
- **THEN** the Agent Dock SHALL show setup actions
- **AND** Project, Manuscript, Changes, Timeline, Wiki, Schemas, Artifact Editor, Validation, and Wiki Diff Review SHALL remain usable

#### Scenario: Agent disconnected
- **WHEN** an agent process disconnects or fails
- **THEN** the Agent Dock SHALL show failure state and replayable session log
- **AND** it SHALL NOT block non-agent workflows

#### Scenario: Renderer starts agent without Node globals
- **WHEN** the renderer starts an agent session and no project is active
- **THEN** it SHALL use a configured cwd or ask for setup
- **AND** it SHALL NOT read `process.cwd()` or any other Node global from the renderer

### Requirement: Agent Dock shall support ACP sessions
The Agent Dock SHALL connect to OpenCode ACP by default where available and allow custom agent commands.

#### Scenario: Start default agent
- **WHEN** the user starts the default agent
- **THEN** the main process SHALL resolve the opencode CLI from bundled app resources (`$INSTDIR/`, `resources/cli/`, `resources/`) when the app is packaged and a bundled binary exists, falling back to the configured `agentCommand` or PATH
- **AND** the session SHALL be listed with id, mode, status, and transcript

#### Scenario: Agent command fails to spawn
- **WHEN** no bundled binary exists and the configured agent executable is missing or cannot be launched from PATH
- **THEN** the main process SHALL return or emit an error state before the renderer treats the session as active
- **AND** exactly one failure event SHALL be logged for the attempted session

#### Scenario: Bundled opencode in packaged app
- **WHEN** the app is packaged and `opencode.exe` exists in `$INSTDIR` (downloaded by NSIS installer)
- **THEN** the agent supervisor SHALL use the absolute path to `$INSTDIR/opencode.exe` as the agent command
- **AND** this SHALL take precedence over the configured `agentCommand` default of `"opencode"`
#### Scenario: Custom agent command
- **WHEN** the user configures a custom agent command
- **THEN** the command SHALL be stored as desktop app preference
- **AND** it SHALL NOT be written into the OpenAdab project unless the user explicitly exports configuration

### Requirement: Agent Dock shall expose constrained modes
Agent sessions SHALL operate in explicit modes: Ask, Plan, Draft, Review, and Apply Request.

#### Scenario: Ask mode
- **WHEN** the session is in Ask mode
- **THEN** the agent SHALL be allowed to receive selected context and answer questions
- **AND** it SHALL NOT write files or run CLI commands without a permission request

#### Scenario: Draft mode
- **WHEN** the session is in Draft mode
- **THEN** the agent SHALL be allowed to request permission to write artifact drafts under `adab/changes/<change-id>/`
- **AND** it SHALL NOT write manuscript or wiki files

#### Scenario: Apply Request mode
- **WHEN** the agent proposes applying wiki diff, sync, archive, or manuscript changes
- **THEN** it SHALL create a permission request with command or diff preview
- **AND** the user SHALL approve before the action runs

### Requirement: Agent Dock shall enforce capability-based permissions
Every agent tool action SHALL be checked against explicit capabilities.

#### Scenario: Read context pack
- **WHEN** the agent requests the visible context pack for the selected artifact
- **THEN** the permission prompt SHALL allow the user to grant read access to only those listed files
- **AND** the granted file list SHALL be logged in the session

#### Scenario: Write artifact draft
- **WHEN** the agent requests to write an artifact draft
- **THEN** the request SHALL show target change, artifact, path, and diff
- **AND** approval SHALL permit only that draft write

#### Scenario: Run CLI command
- **WHEN** the agent requests a CLI command
- **THEN** the permission prompt SHALL show exact command, args, cwd, mutation classification, and expected target
- **AND** denial SHALL prevent process execution

#### Scenario: Forbidden direct canon mutation
- **WHEN** the agent attempts to write `adab/wiki/**` or `adab/manuscript/**` directly
- **THEN** the main process SHALL reject the action
- **AND** the Agent Dock SHALL direct the user to Wiki Diff Review, sync, archive, or manuscript diff flow

### Requirement: Agent Dock shall make tool calls auditable
The Agent Dock SHALL display and persist agent tool calls, permission decisions, diffs, command outputs, and failures.

#### Scenario: Tool call displayed
- **WHEN** an agent makes a tool call
- **THEN** the session log SHALL show tool name, arguments summary, requested capability, result, and timestamp

#### Scenario: Permission denied
- **WHEN** the user denies a permission request
- **THEN** the denial SHALL be logged
- **AND** the agent SHALL receive a denial result rather than silent failure

#### Scenario: Replay session
- **WHEN** the user opens a previous session
- **THEN** the dock SHALL display messages, tool calls, permission decisions, command transcript links, and produced drafts where still available

