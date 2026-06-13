# desktop-artifact-editor Specification

## Purpose
TBD - created by archiving change add-electron-desktop-gui. Update Purpose after archive.
## Requirements
### Requirement: Artifact editor shall edit change artifacts as buffered Markdown files
The Artifact Editor SHALL edit artifact files in `adab/changes/<change-id>/` through a buffered save model.

#### Scenario: Open artifact file
- **WHEN** the user selects an artifact node
- **THEN** the editor SHALL resolve the generated file path for that artifact
- **AND** it SHALL read the file if it exists
- **AND** it SHALL show an empty or template-assisted state if the file does not exist

#### Scenario: Dirty buffer
- **WHEN** the user changes editor content
- **THEN** the editor SHALL mark the buffer dirty
- **AND** it SHALL NOT write to disk until the user saves or an approved agent draft write occurs

#### Scenario: Save artifact
- **WHEN** the user saves an artifact buffer
- **THEN** the main process SHALL write the file inside `adab/changes/<change-id>/`
- **AND** the UI SHALL refresh `openadab status --change <id> --json` after successful save
- **AND** validation SHALL remain a separate CLI operation

### Requirement: Artifact editor shall protect against external file conflicts
The editor SHALL detect when a file changed on disk after it was loaded.

#### Scenario: File unchanged since load
- **WHEN** the buffer base mtime or hash matches the current file state
- **THEN** save SHALL proceed without conflict confirmation

#### Scenario: File changed since load
- **WHEN** the current file mtime or hash differs from the buffer base
- **THEN** the editor SHALL show a conflict warning with options to reload, overwrite, or inspect diff
- **AND** overwrite SHALL require explicit confirmation

### Requirement: Artifact editor shall expose frontmatter as both form and source
The editor SHALL support Markdown source editing and structured frontmatter editing.

#### Scenario: Valid frontmatter
- **WHEN** artifact content contains YAML frontmatter
- **THEN** the frontmatter form SHALL display parsed fields
- **AND** changes in the form SHALL update the source buffer in a predictable YAML block

#### Scenario: Invalid frontmatter
- **WHEN** the YAML frontmatter cannot be parsed
- **THEN** the form SHALL show a parse error
- **AND** the source editor SHALL remain usable
- **AND** save SHALL be allowed only if the user confirms saving invalid frontmatter or fixes it, according to validation policy

#### Scenario: Required field hints
- **WHEN** schema validation rules or artifact templates indicate required frontmatter fields
- **THEN** the editor SHALL surface those fields as hints
- **AND** missing fields SHALL be shown before CLI validation where possible without claiming canonical validity

### Requirement: Artifact editor shall show instructions and dependencies
The editor SHALL make artifact instructions and dependencies visible.

#### Scenario: Load instructions
- **WHEN** the user opens the Instructions tab for an artifact
- **THEN** the desktop app SHALL run `openadab instructions <artifact> --change <id> --json --inline-deps`
- **AND** it SHALL display instruction text, template, output path, dependency content or references, rules, and required reads

#### Scenario: Dependency missing
- **WHEN** instructions or status indicate a missing dependency
- **THEN** the editor SHALL show a dependency warning
- **AND** it SHALL link to the dependency artifact node when available

### Requirement: Artifact editor shall provide preview and diff
The editor SHALL provide Markdown preview and diff preview for saved and unsaved content.

#### Scenario: Markdown preview
- **WHEN** the user selects preview mode
- **THEN** the editor SHALL render the Markdown body separately from YAML frontmatter
- **AND** wiki links SHALL be visually identifiable even if not navigated

#### Scenario: Diff preview before save
- **WHEN** the user requests diff preview
- **THEN** the editor SHALL compare the current buffer with the on-disk artifact content
- **AND** it SHALL show additions, deletions, and changed frontmatter fields

