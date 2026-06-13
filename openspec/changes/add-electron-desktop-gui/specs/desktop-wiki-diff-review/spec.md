## ADDED Requirements

### Requirement: Wiki Diff Review shall be the gate for wiki canon mutations
The desktop app SHALL require review before applying wiki-diff operations to canon wiki pages.

#### Scenario: Open wiki diff review
- **WHEN** the user opens review for a change
- **THEN** the app SHALL load `openadab wiki diff --change <id> --json`
- **AND** it SHALL display change id, operation count, target pages, operation types, and source citations

#### Scenario: No operations
- **WHEN** the wiki-diff parses successfully with zero operations
- **THEN** the review view SHALL show a no-op state
- **AND** apply SHALL be disabled

#### Scenario: Malformed diff
- **WHEN** wiki diff parsing fails
- **THEN** the review view SHALL show parse errors
- **AND** dry-run and apply SHALL be disabled until the diff is fixed

### Requirement: Wiki Diff Review shall run dry-run before apply
The desktop app SHALL run dry-run and show its result before applying a wiki diff.

#### Scenario: Dry-run succeeds
- **WHEN** `openadab wiki apply-diff --change <id> --dry-run --json` succeeds
- **THEN** the review view SHALL show pages that would be modified, operation counts, contradictions flagged, warnings, and summary
- **AND** the apply button SHALL become available only after user review of the dry-run result

#### Scenario: Dry-run fails
- **WHEN** dry-run exits non-zero
- **THEN** apply SHALL remain disabled
- **AND** the view SHALL show all validation errors and raw transcript details

#### Scenario: Apply requires confirmation
- **WHEN** the user clicks apply after dry-run success
- **THEN** the app SHALL show a confirmation that names the change id and affected wiki pages
- **AND** it SHALL run `openadab wiki apply-diff --change <id> --apply --json` only after confirmation

### Requirement: Wiki Diff Review shall support operation-level planning
The review UI SHALL support accept, skip, and edit states for individual operations.

#### Scenario: Identify individual operations
- **WHEN** a wiki-diff contains multiple operations for the same target page
- **THEN** each operation SHALL have a stable UI identity that includes its position or equivalent unique discriminator
- **AND** selecting, skipping, or editing one operation SHALL NOT implicitly select, skip, or edit other operations for the same target

#### Scenario: Accept all operations
- **WHEN** all operations are accepted
- **THEN** the app SHALL apply the original wiki-diff through the CLI

#### Scenario: Skip one operation
- **WHEN** the user skips one or more operations
- **THEN** the app SHALL materialize a temporary filtered wiki-diff containing only accepted operations in a format the CLI explicitly accepts
- **AND** dry-run/apply SHALL target that filtered diff rather than the original file
- **AND** the original wiki-diff SHALL remain unchanged unless the user explicitly saves edits

#### Scenario: Edit operation
- **WHEN** the user edits an operation payload
- **THEN** the edited operation SHALL be validated by dry-run before apply
- **AND** the UI SHALL show that the applied diff differs from the original change artifact

#### Scenario: Temporary filtered diff format
- **WHEN** operation-level review creates a temporary file
- **THEN** the file SHALL either be valid wiki-diff Markdown or an operation-document JSON shape supported by `openadab wiki apply-diff`
- **AND** the CLI SHALL reject unsupported temporary formats with a clear error before applying any mutation

### Requirement: Wiki Diff Review shall refresh dependent views after apply
The desktop app SHALL refresh affected state after applying a wiki diff.

#### Scenario: Apply succeeds
- **WHEN** wiki apply exits successfully
- **THEN** the app SHALL refresh Wiki Impact, Wiki workbench pages, Project health, Change status, and Transcript
- **AND** it SHALL show the apply summary

#### Scenario: Apply fails
- **WHEN** wiki apply exits non-zero
- **THEN** the app SHALL show failure details
- **AND** it SHALL NOT mark operations as applied in UI state unless the CLI output proves application success
