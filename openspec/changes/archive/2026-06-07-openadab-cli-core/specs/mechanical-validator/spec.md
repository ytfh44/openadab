## ADDED Requirements

### Requirement: Mechanical validator shall check artifact files against schema
The `MechanicalValidator` module SHALL run deterministic, non-LLM validation checks on artifact files.

#### Scenario: File existence check
- **WHEN** validating artifact `draft` in change `draft-ch-012`
- **THEN** the validator SHALL check that `adab/changes/draft-ch-012/draft.md` exists
- **AND** SHALL report `exists: false` with severity "error" if missing

#### Scenario: Schema compliance check
- **WHEN** validating an artifact
- **THEN** the validator SHALL verify the artifact's frontmatter contains all required fields per the schema's `validation.mechanical` rules
- **AND** SHALL report each missing field with severity "error"

#### Scenario: Word count check
- **WHEN** the schema specifies word count range `{ min: 1000, max: 5000 }` for artifact `draft`
- **THEN** the validator SHALL count words in the draft file
- **AND** SHALL report `wordCount` with actual count and pass/fail
- **AND** SHALL use severity "warning" (not error) for out-of-range

#### Scenario: Wiki link validity check
- **WHEN** validating a `wiki-diff` artifact containing `[[locations/east-gate]]`
- **THEN** the validator SHALL verify that `adab/wiki/locations/east-gate.md` exists via the wiki engine
- **AND** SHALL report broken links with severity "error"

#### Scenario: Chapter sequence check
- **WHEN** validating the project's manuscript
- **THEN** the validator SHALL check that `adab/manuscript/chapters/` contains consecutive chapter files (ch-001, ch-002, ...)
- **AND** SHALL report gaps with severity "warning"

### Requirement: Mechanical validator shall support per-change and per-artifact validation
The validator SHALL work at multiple granularities.

#### Scenario: Validate single artifact
- **WHEN** calling `validateArtifact(changeDir, "draft")`
- **THEN** the validator SHALL run only checks applicable to the "draft" artifact type
- **AND** SHALL return a `ValidationResult` with per-check pass/fail status

#### Scenario: Validate entire change
- **WHEN** calling `validateChange(changeDir)`
- **THEN** the validator SHALL run checks on all artifacts defined in the change's schema
- **AND** SHALL aggregate results with overall pass/fail based on error severity (warnings don't fail)

### Requirement: Mechanical validator shall validate config on startup
Every CLI command that operates within an existing project SHALL validate `adab/config.yaml` before execution.

#### Scenario: Config validation on any command
- **WHEN** any CLI command is invoked within an existing project directory (i.e., `adab/` directory exists)
- **THEN** the mechanical validator SHALL load and validate `adab/config.yaml` against the `ProjectConfig` zod schema
- **AND** SHALL abort the command with error output if validation fails

#### Scenario: Init command exempt from config validation
- **WHEN** `openadab init` is invoked and `adab/config.yaml` does not yet exist
- **THEN** the mechanical validator SHALL NOT attempt to load config (the project is being created)
- **AND** `openadab init` SHALL proceed to scaffold the project directory including a valid default config
