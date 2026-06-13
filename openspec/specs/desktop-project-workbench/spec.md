# desktop-project-workbench Specification

## Purpose
TBD - created by archiving change add-electron-desktop-gui. Update Purpose after archive.
## Requirements
### Requirement: Project workbench shall summarize project readiness
The Project workbench SHALL answer whether the current OpenAdab project is ready for continued writing.

#### Scenario: Valid project loaded
- **WHEN** a valid project is active
- **THEN** the Project workbench SHALL display project title, project root, active schema, language, genre, tense, POV, context budget, and archive backup setting when available
- **AND** it SHALL show a readiness summary derived from config validation, recent logs, active change state, wiki lint state, and index freshness if available

#### Scenario: Invalid config
- **WHEN** config validation fails through CLI or config parsing
- **THEN** the Project workbench SHALL show the config error as a blocking health issue
- **AND** project-scoped mutating actions other than config repair SHALL be disabled

#### Scenario: No active change detected
- **WHEN** no non-archived change is detected under `adab/changes/`
- **THEN** the Project workbench SHALL show a neutral "no active change" state
- **AND** it SHALL offer a new-change action

### Requirement: Project workbench shall initialize projects through CLI
Project initialization SHALL be performed by `openadab init`.

#### Scenario: Initialize empty directory
- **WHEN** the user chooses to initialize a selected non-project directory
- **THEN** the desktop app SHALL run `openadab init` with selected schema and host arguments
- **AND** it SHALL set cwd to the selected directory
- **AND** it SHALL refresh project health after success

#### Scenario: Init fails
- **WHEN** `openadab init` exits non-zero
- **THEN** the UI SHALL show the error and transcript event
- **AND** it SHALL NOT mark the directory as an active valid project unless `adab/config.yaml` exists and validates afterward

### Requirement: Project workbench shall expose safe config viewing and editing
The Project workbench SHALL support reading and updating project configuration through CLI.

#### Scenario: Read config path
- **WHEN** the UI needs a config value
- **THEN** it SHALL use `openadab config get <path> --json` or a safe bounded read of `adab/config.yaml`

#### Scenario: Set config path
- **WHEN** the user updates a config field
- **THEN** the UI SHALL run `openadab config set <path> <value>` with correct JSON/raw mode
- **AND** it SHALL refresh affected project health data after success

#### Scenario: Set raw string config value
- **WHEN** the user enters a plain string such as `My Novel`
- **THEN** the UI SHALL omit `--json` and pass the value as a raw CLI argument
- **AND** the displayed result SHALL not ask the user to add JSON quotes for ordinary strings

#### Scenario: Set structured config value
- **WHEN** the user explicitly chooses JSON mode for a number, boolean, object, array, or quoted JSON string
- **THEN** the UI SHALL pass `--json`
- **AND** invalid JSON SHALL be reported before or from the CLI without mutating config

#### Scenario: Sensitive config value
- **WHEN** a config path appears sensitive by name, including token, password, secret, or apiKey
- **THEN** the UI SHALL mask the value by default
- **AND** transcript details SHALL not reveal plaintext values if CLI redaction is available

### Requirement: Project workbench shall expose logs and maintenance actions
The Project workbench SHALL provide recent logs and maintenance actions without acting like a file explorer.

#### Scenario: Recent logs
- **WHEN** the Project workbench loads
- **THEN** it SHALL request recent log entries using `openadab log --limit <N> --json`
- **AND** it SHALL show operation, timestamp, change id, result, and details summary

#### Scenario: Update schemas and adapters
- **WHEN** the user runs update from the Project workbench
- **THEN** the app SHALL run `openadab update --schemas --json` or the selected update variant
- **AND** it SHALL record the command in the transcript

#### Scenario: Wiki lint health
- **WHEN** the Project workbench checks wiki health
- **THEN** it SHALL use `openadab wiki lint --json`
- **AND** lint errors SHALL appear as health issues, while warnings SHALL appear as review items

