## ADDED Requirements

### Requirement: Changes workbench shall render schema-driven artifact DAGs
The Changes workbench SHALL render artifact workflows from schema/status data instead of hardcoded chapter-draft nodes.

#### Scenario: Load change status
- **WHEN** a change id is selected
- **THEN** the workbench SHALL run `openadab status --change <id> --json`
- **AND** it SHALL render each artifact from the returned artifact list with id, status, generated file, and dependencies

#### Scenario: Linear chapter-draft DAG
- **WHEN** the active schema is `chapter-draft`
- **THEN** the default visual order SHALL show brief, scene-plan, draft, revision, continuity-report, wiki-diff, and apply when apply is ready
- **AND** this order SHALL be derived from schema dependency order or CLI status rather than literal UI constants

#### Scenario: Unknown custom schema
- **WHEN** a custom schema contains artifact ids unknown to the GUI
- **THEN** the workbench SHALL still render nodes, dependencies, status, generated paths, instructions action, context action, and validation action
- **AND** it SHALL not require a schema-specific UI adapter

### Requirement: Changes workbench shall create and select changes
The desktop app SHALL support creating and selecting changes through CLI and project files.

#### Scenario: Create new change
- **WHEN** the user creates a change with type and id
- **THEN** the desktop app SHALL run `openadab new <type> <id> --json`
- **AND** after success it SHALL select that change and load status

#### Scenario: Duplicate change id
- **WHEN** `openadab new` fails because a change already exists
- **THEN** the UI SHALL show the CLI error
- **AND** it SHALL offer to select the existing change when it can be found

### Requirement: Changes workbench shall expose artifact status and blocking issues
The workbench SHALL explain why each artifact is ready, blocked, done, or invalid.

#### Scenario: Blocked artifact
- **WHEN** status JSON reports blockingIssues for an artifact
- **THEN** the node SHALL indicate blocked state
- **AND** the detail panel SHALL show missing dependencies and reason text

#### Scenario: Existing artifact fails validation
- **WHEN** status JSON reports validationIssues for an artifact whose file exists
- **THEN** the node SHALL show a needs-rewrite or invalid-ready visual state
- **AND** it SHALL remain distinct from an artifact that is simply missing and ready

#### Scenario: Optional artifact
- **WHEN** schema/status marks an artifact as optional or a generated file is missing but not required for sync
- **THEN** the UI SHALL distinguish optional missing from blocking missing
- **AND** it SHALL not imply the change is blocked solely due to the optional artifact

### Requirement: Changes workbench shall gate lifecycle mutations
Sync, wiki apply, and archive actions SHALL be explicit lifecycle actions with status and validation feedback.

#### Scenario: Sync action
- **WHEN** the user clicks sync for a change
- **THEN** the UI SHALL show the equivalent CLI command
- **AND** it SHALL run `openadab sync --change <id> --json` only after confirmation because sync may mutate wiki, index, log, and manifest files

#### Scenario: Archive action
- **WHEN** the user clicks archive
- **THEN** the UI SHALL show the target manuscript path if known
- **AND** it SHALL run `openadab archive <change-id> --json` only after confirmation

#### Scenario: Lifecycle command completes
- **WHEN** sync, archive, or wiki apply completes
- **THEN** the workbench SHALL refresh status, transcript, Project health, Inspector data, and affected Manuscript/Wiki views

### Requirement: Changes workbench shall maintain selection consistency
The selected artifact SHALL remain valid across status refreshes.

#### Scenario: Selected artifact still exists
- **WHEN** status refreshes and the selected artifact id is still present
- **THEN** the workbench SHALL keep it selected

#### Scenario: Selected artifact removed by schema change
- **WHEN** status refreshes and the selected artifact id no longer exists
- **THEN** the workbench SHALL select the first ready artifact if any
- **AND** otherwise select the first artifact in topological order
