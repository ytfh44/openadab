## MODIFIED Requirement: Agent Dock shall support ACP sessions
The Agent Dock SHALL connect to the bundled opencode CLI in packaged builds, falling back to the configured command or PATH.

### MODIFIED Scenario: Start default agent
- **WHEN** the user starts the default agent
- **THEN** the main process SHALL resolve the opencode CLI from bundled app resources (`$INSTDIR/`, `resources/cli/`, `resources/`) when the app is packaged and a bundled binary exists
- **AND** it SHALL fall back to the configured `agentCommand` or PATH when no bundled binary is found
- **AND** the session SHALL be listed with id, mode, status, and transcript

### MODIFIED Scenario: Agent command fails to spawn
- **WHEN** no bundled binary exists and the configured agent executable is missing or cannot be launched from PATH
- **THEN** the main process SHALL return or emit an error state before the renderer treats the session as active
- **AND** exactly one failure event SHALL be logged for the attempted session

### ADDED Scenario: Bundled opencode in packaged app
- **WHEN** the app is packaged and `opencode.exe` exists in `$INSTDIR` (downloaded by NSIS installer)
- **THEN** the agent supervisor SHALL use the absolute path to `$INSTDIR/opencode.exe` as the agent command
- **AND** this SHALL take precedence over the configured `agentCommand` default of `"opencode"`
