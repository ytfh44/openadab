## ADDED Requirements

### Requirement: Project config shall be validated against zod schema
The `ProjectConfig` module SHALL load, validate, and manage `adab/config.yaml` using zod schema validation.

#### Scenario: Valid config loading
- **WHEN** loading a config.yaml with all required fields (schema, project.title, project.language, context.maxTokens)
- **THEN** the config SHALL be parsed into a typed object
- **AND** default values SHALL be applied for optional fields per the zod schema
- **AND** SHALL warn about unknown top-level and nested fields (forward compatibility) via `console.warn`

#### Scenario: Invalid config rejection
- **WHEN** loading a config.yaml missing required field `project.title`
- **THEN** the module SHALL throw `ConfigValidationError` with the missing field path
- **AND** the error message SHALL suggest the correct field name and location

#### Scenario: Config with unknown fields
- **WHEN** config has unrecognized top-level or nested fields (e.g., `customSettings: {...}`)
- **THEN** the module SHALL warn about unknown fields (not fail)
- **AND** SHALL recursively check nested objects for unknown fields

### Requirement: Project config shall provide typed access
The module SHALL expose typed getters for all config sections.

#### Scenario: Get active schema name
- **WHEN** calling `config.getActiveSchema()`
- **AND** config has `schema: chapter-draft`
- **THEN** it SHALL return `"chapter-draft"`
- **AND** SHALL throw `ConfigValidationError` if `load()` has not been called first

#### Scenario: Get rules for artifact
- **WHEN** calling `config.getRules("draft")`
- **AND** config has `rules.draft: ["Maintain POV discipline."]`
- **THEN** it SHALL return `["Maintain POV discipline."]`
- **AND** SHALL return empty array if no rules defined for the artifact

#### Scenario: Get context budget and settings
- **WHEN** calling `config.getMaxTokens()`, `config.getAlwaysInclude()`, `config.getLanguage()`, `config.getTokenHeuristic()`
- **THEN** each SHALL return the configured value from the loaded config

### Requirement: Project config shall merge with schema-level config
Schema context variables SHALL be resolved against project config.

#### Scenario: Template variable from config
- **WHEN** a schema uses `{{config.project.pov}}`
- **AND** config has `project.pov: limited-third`
- **THEN** the resolved value SHALL be `"limited-third"`

#### Scenario: Nested config access
- **WHEN** a schema uses `{{config.project.genre}}`
- **AND** config has `project.genre: fantasy`
- **THEN** the resolved value SHALL be `"fantasy"`
- **AND** SHALL throw `ConfigValidationError` for unresolvable config paths

### Requirement: Project config shall support get and set via CLI
The CLI SHALL provide `config get` and `config set` subcommands.

#### Scenario: Get config value
- **WHEN** running `openadab config get project.title`
- **THEN** the output SHALL be the current value (e.g., `"Untitled Novel"`)

#### Scenario: Set config value
- **WHEN** running `openadab config set project.title "The Black Library"`
- **THEN** the config.yaml SHALL be updated with the new title
- **AND** the change SHALL be logged to `adab/log.md` with an `update` operation entry
- **AND** the new value SHALL be validated against the zod schema (including enum constraints) before writing

#### Scenario: Set invalid config value
- **WHEN** running `openadab config set project.pov "omniscient-god"`
- **THEN** the CLI SHALL validate against allowed enum values and reject if invalid
- **AND** SHALL suggest valid values (e.g., "Valid POV modes: first-person, limited-third, omniscient-third")
- **AND** for language: "Valid values: zh-CN, en-US, ja-JP"
- **AND** for tense: "Valid values: past, present"

### Requirement: Project config zod schema
The config SHALL follow this zod schema structure. The `version` field tracks the config file format version (not the workflow schema version — schema version is tracked per-change in `.openadab.yaml`).

```typescript
const ProjectConfig = z.object({
  schema: z.string().default("chapter-draft"),
  version: z.number().default(1),
  project: z.object({
    title: z.string().default("Untitled Novel"),
    language: z.enum(["zh-CN", "en-US", "ja-JP"]).default("zh-CN"),
    genre: z.string().default("fantasy"),
    tense: z.enum(["past", "present"]).default("past"),
    pov: z.enum(["first-person", "limited-third", "omniscient-third"]).default("limited-third"),
  }),
  context: z.object({
    maxTokens: z.number().min(1000).max(200000).default(18000),
    alwaysInclude: z.array(z.string()).default([]),
    tokenHeuristic: z.enum(["chars-per-token"]).default("chars-per-token"),
    excludePatterns: z.array(z.string()).default([]),
  }),
  rules: z.record(z.array(z.string())).default({}),
  archive: z.object({
    backupOnOverwrite: z.boolean().default(false),
  }).default({}),
});
```

#### Scenario: Default values applied
- **WHEN** loading a minimal config with only `schema` and `project.title`
- **THEN** all other fields SHALL be filled with schema defaults

#### Scenario: Config path set with array notation
- **WHEN** running `openadab config set context.alwaysInclude[0] "adab/wiki/index.md"`
- **THEN** the CLI SHALL support bracket-index notation in dot-paths for nested array navigation
