## MODIFIED Requirement: CLI bridge shall execute OpenAdab through managed child processes
The desktop app SHALL run authoritative OpenAdab operations by resolving an executable OpenAdab CLI entrypoint, spawning it with argument arrays, and setting an explicit cwd for each command.

### MODIFIED Scenario: Resolve CLI executable
- **WHEN** the desktop app starts in development, workspace, packaged, or globally installed mode
- **THEN** the command runner SHALL resolve the CLI from an explicit configured path when present, then from the local workspace/package build output when present, then from bundled app resources (`$INSTDIR/`, `resources/cli/`, `resources/`) when packaged, then from `PATH`
- **AND** on Windows it SHALL search for `.exe`, `.cmd`, and `.bat` variants alongside the bare name
- **AND** it SHALL preserve argument-array spawning for every resolution strategy
- **AND** resolution SHALL work with install paths containing spaces, CJK characters, or other Unicode code points

### ADDED Scenario: Resolve CLI in packaged app
- **WHEN** the app is packaged (electron-builder NSIS install)
- **THEN** the command runner SHALL search `$INSTDIR` (the directory containing `OpenAdab.exe`) for an `openadab` binary before checking `resources/cli/` and `resources/`
- **AND** the full absolute path SHALL be used for spawning, not a bare command name
