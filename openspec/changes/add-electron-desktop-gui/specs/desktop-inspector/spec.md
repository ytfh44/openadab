## ADDED Requirements

### Requirement: Inspector shall display context pack transparency
The right-side Inspector SHALL display what context is selected for the current change and artifact.

#### Scenario: Load context pack
- **WHEN** a change and artifact are selected
- **THEN** the Inspector SHALL run `openadab context pack --change <id> --artifact <artifact> --json`
- **AND** it SHALL display must-read, optional-read, excluded, and reasons

#### Scenario: Stale index warning
- **WHEN** the context pack includes a stale-index warning reason or command stderr warning
- **THEN** the Inspector SHALL show the warning in the Context Pack card
- **AND** it SHALL offer an appropriate refresh/index/sync action when available

#### Scenario: Copy context
- **WHEN** the user copies context for prompting
- **THEN** the copied text SHALL include file paths grouped by must-read, optional-read, and excluded or omit excluded based on user choice
- **AND** it SHALL include reasons so agent context remains auditable

#### Scenario: Give context to agent
- **WHEN** the user sends context to an agent
- **THEN** the Agent Dock SHALL receive the same visible context set
- **AND** the action SHALL be logged in the agent session

### Requirement: Inspector shall separate mechanical and semantic validation
The Inspector SHALL present mechanical validation and semantic validation as separate result groups.

#### Scenario: Mechanical validation
- **WHEN** the user runs or refreshes mechanical validation
- **THEN** the app SHALL run `openadab validate --change <id> --mechanical --json`
- **AND** it SHALL show per-artifact pass/fail, errors, warnings, and aggregate result
- **AND** mechanical errors SHALL be visually blocking for sync

#### Scenario: Semantic validation prompt
- **WHEN** the user runs semantic validation
- **THEN** the app SHALL run `openadab validate --change <id> --semantic --json`
- **AND** it SHALL show generated semantic review prompts and warnings
- **AND** it SHALL NOT label semantic validation as passed by an LLM unless an agent or user review result has been recorded

#### Scenario: Validation command fails
- **WHEN** validation exits non-zero
- **THEN** the Validation card SHALL show command failure and parsed validation output if any
- **AND** the transcript SHALL contain raw stdout, stderr, and exit code

### Requirement: Inspector shall display wiki impact for the selected change
The Inspector SHALL summarize wiki-diff impact for the selected change.

#### Scenario: Wiki diff exists
- **WHEN** `openadab wiki diff --change <id> --json` returns operations
- **THEN** the Wiki Impact card SHALL group operations by target page and operation type
- **AND** it SHALL show source citations and risk warnings when available

#### Scenario: Wiki diff missing
- **WHEN** the CLI reports no wiki-diff for the change
- **THEN** the Wiki Impact card SHALL show an empty state
- **AND** it SHALL not treat absence as an error if the selected schema does not require wiki-diff yet

#### Scenario: Open review
- **WHEN** the user clicks review from Wiki Impact
- **THEN** the desktop app SHALL open the Wiki Diff Review view for the selected change

### Requirement: Inspector shall be contextual but not destructive
Inspector cards SHALL provide visibility and safe actions, not hidden mutations.

#### Scenario: Rerun context pack
- **WHEN** the user reruns context pack
- **THEN** only a read-only context command SHALL execute

#### Scenario: Apply wiki diff from Inspector
- **WHEN** the user chooses to apply a wiki diff from the Inspector
- **THEN** the app SHALL route to Wiki Diff Review or show an equivalent dry-run and confirmation flow
- **AND** it SHALL NOT directly execute `--apply` from a compact card without review
