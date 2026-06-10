## ADDED Requirements

### Requirement: Schema engine shall load and validate YAML schemas
The `SchemaEngine` module SHALL load YAML schema files from a given path, validate them against a zod schema definition, and return a typed schema object.

#### Scenario: Load valid schema
- **WHEN** the engine loads a valid `chapter-draft/schema.yaml` file
- **THEN** it SHALL return a typed `SchemaDef` object with all fields populated
- **AND** the `artifacts` array SHALL be in the order defined in the YAML
- **AND** the `apply` section SHALL be parsed if present

#### Scenario: Reject invalid schema
- **WHEN** the engine loads a schema YAML missing required field `name`
- **THEN** it SHALL throw a `SchemaValidationError` with message indicating the missing field
- **AND** the error SHALL include the file path that failed validation

#### Scenario: Detect cyclic dependency
- **WHEN** the engine loads a schema where artifact A requires B, B requires C, and C requires A
- **THEN** it SHALL throw a `CycleDetectedError` listing the cycle path (A → B → C → A)

#### Scenario: Duplicate artifact IDs
- **WHEN** the engine loads a schema with two artifacts having the same `id` field
- **THEN** it SHALL throw a `SchemaValidationError` indicating the duplicate ID

### Requirement: Schema engine shall resolve templates relative to schema directory
Template paths in schemas SHALL be resolved relative to the schema file's directory.

#### Scenario: Template in schema subdirectory
- **WHEN** a schema at `schemas/chapter-draft/schema.yaml` references `template: templates/brief.md`
- **THEN** the engine SHALL resolve the template path to `schemas/chapter-draft/templates/brief.md`

#### Scenario: Template not found
- **WHEN** a schema references a template file that does not exist
- **THEN** the engine SHALL throw a `TemplateNotFoundError` with the resolved path

### Requirement: Schema engine shall support schema forking
The `schema fork <base> <name>` command SHALL copy a built-in schema (with its templates) to the project's `adab/schemas/<name>/` directory.

#### Scenario: Fork built-in schema
- **WHEN** user runs `openadab schema fork chapter-draft my-custom-draft`
- **THEN** the CLI SHALL copy `chapter-draft/schema.yaml` to `adab/schemas/my-custom-draft/schema.yaml`
- **AND** SHALL copy all template files from `chapter-draft/templates/` to `adab/schemas/my-custom-draft/templates/`
- **AND** SHALL add metadata `forked_from: chapter-draft` and `forked_version: <current-cli-version>` to the copied schema

#### Scenario: Fork non-existent base schema
- **WHEN** user runs `openadab schema fork nonexistent my-copy`
- **THEN** the CLI SHALL error with "Schema 'nonexistent' not found. Available: chapter-draft, chapter-revision, wiki-ingest"

#### Scenario: Schema listing
- **WHEN** user runs `openadab schema list`
- **THEN** the CLI SHALL output a list of all available schemas (built-in + project forks)
- **AND** the active schema (from config.yaml) SHALL be marked with `[active]`

### Requirement: Schema engine shall support variable interpolation
Schema fields containing `{{variable}}` syntax SHALL be interpolated with values from the schema context and project config.

#### Scenario: Chapter variable interpolation
- **WHEN** a schema's `apply.target` is `manuscript/chapters/{{chapter}}.md` and context provides `chapter: "012"`
- **THEN** the resolved target SHALL be `manuscript/chapters/ch-012.md`

#### Scenario: Config variable interpolation
- **WHEN** a schema's `instruction` contains `POV: {{config.project.pov}}` and config has `pov: limited-third`
- **THEN** the resolved instruction SHALL contain `POV: limited-third`

#### Scenario: Missing variable throws error
- **WHEN** a schema references `{{unknown_var}}` with no matching context value
- **THEN** the engine SHALL throw an `UnresolvedVariableError`
