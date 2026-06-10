## ADDED Requirements

### Requirement: Instruction loader shall assemble executable AI instructions
The `InstructionLoader` module SHALL assemble a complete instruction payload for an artifact by combining project config rules, schema artifact definition, template content, dependency artifact contents, and context pack reference.

#### Scenario: Basic instruction assembly
- **WHEN** loading instructions for artifact `draft` in change `draft-ch-012`
- **THEN** the output SHALL include:
  - `instruction`: the schema's `instruction` text (or content of `instructionFile`)
  - `template`: the rendered template content (if `template` specified)
  - `outputPath`: the resolved file path where the artifact should be written
  - `contextPack`: reference to the context pack (file list with reasons)
  - `rules`: per-artifact rules from project config
  - `dependencyContent`: content of all dependency artifacts (if `--inline-deps` flag)

#### Scenario: Template rendering with variables
- **WHEN** a template contains `{{chapter}}` and the change context provides `chapter: "012"`
- **THEN** the rendered template SHALL replace `{{chapter}}` with `012`

#### Scenario: Rules injection
- **WHEN** project config has `rules.draft: ["Maintain POV discipline.", "Do not introduce new magic rules."]`
- **THEN** the instruction output's `rules` field SHALL contain both rules

#### Scenario: Dependency content inclusion
- **WHEN** loading instructions with `--inline-deps` flag
- **THEN** the output SHALL include the full text content of each dependency artifact (brief.md, scene-plan.md for draft)

#### Scenario: Dependency content excluded by default
- **WHEN** loading instructions without `--inline-deps`
- **THEN** the output SHALL only reference dependency file paths, not include their content
- **AND** the output SHALL include a `requiredReads` field listing dependency files

### Requirement: Instruction loader shall support JSON output
All instruction output SHALL be available in structured JSON format for machine consumption.

#### Scenario: JSON instruction output
- **WHEN** running `openadab instructions draft --change draft-ch-012 --json`
- **THEN** the output SHALL be valid JSON with fields: `change`, `artifact`, `instruction`, `template`, `outputPath`, `rules`, `requiredReads`, `contextPack`, `dependencyContent` (if applicable)

### Requirement: Instruction loader shall handle missing dependencies gracefully
When a dependency artifact file is missing (should not happen if status checked first), the loader SHALL report it.

#### Scenario: Missing dependency artifact
- **WHEN** loading instructions for `scene-plan` but `brief.md` does not exist
- **THEN** the loader SHALL output a warning in the instruction: "Warning: dependency 'brief' is missing. Write `brief.md` first."
- **AND** SHALL still return the instruction payload (allowing forward planning)
