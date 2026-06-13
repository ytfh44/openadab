## ADDED Requirements

### Requirement: Schema workbench shall expose installed and active schemas
The Schema workbench SHALL display schemas installed in the active OpenAdab project.

#### Scenario: List schemas
- **WHEN** the Schema workbench loads
- **THEN** it SHALL run `openadab schema list --json`
- **AND** it SHALL show installed schemas and the active schema when reported

#### Scenario: Show schema
- **WHEN** the user selects a schema
- **THEN** the workbench SHALL run `openadab schema show <name> --json`
- **AND** it SHALL display schema name, version, description, context variables, artifacts, apply target, templates, instructions, and validation rules

### Requirement: Schema workbench shall visualize artifact DAGs
The Schema workbench SHALL visualize the selected schema's artifact dependency graph.

#### Scenario: Render schema DAG
- **WHEN** a schema with artifacts and `requires` dependencies is selected
- **THEN** the workbench SHALL render nodes for every artifact
- **AND** edges SHALL represent dependencies
- **AND** apply target SHALL be shown as a terminal action when present

#### Scenario: Invalid schema DAG
- **WHEN** schema validation reports unknown dependencies, duplicate ids, missing templates, or cycles
- **THEN** the visualization SHALL show the validation issue
- **AND** it SHALL not imply the schema can drive a change until validation passes

### Requirement: Schema workbench shall support validation and fork flows
Schema changes SHALL be validated through CLI commands.

#### Scenario: Validate schema
- **WHEN** the user validates a schema directory
- **THEN** the app SHALL run `openadab schema validate <path> --json`
- **AND** it SHALL show pass/fail results and errors

#### Scenario: Fork schema
- **WHEN** the user forks a built-in schema
- **THEN** the app SHALL run `openadab schema fork <base> <name> --json`
- **AND** it SHALL refresh installed schema list after success

### Requirement: Schema workbench shall provide advanced YAML editing safely
The Schema workbench SHALL allow advanced YAML editing for project schemas.

#### Scenario: Edit project schema YAML
- **WHEN** the user edits a schema YAML file under `adab/schemas/`
- **THEN** save SHALL use path-bounded file writes
- **AND** the UI SHALL run schema validation after save

#### Scenario: Edit built-in packaged schema
- **WHEN** the selected schema is a packaged built-in source outside the project directory
- **THEN** direct editing SHALL be disabled
- **AND** the UI SHALL offer schema fork instead

#### Scenario: Schema diff
- **WHEN** a project schema declares it was forked from a built-in schema
- **THEN** the workbench SHALL show a diff between the project fork and the built-in base when both are available
