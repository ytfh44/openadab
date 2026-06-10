## ADDED Requirements

### Requirement: Continuity linter shall generate semantic validation prompts for LLM execution
The `ContinuityLinter` module SHALL generate structured LLM prompts for semantic validation of story continuity. The CLI does NOT invoke LLMs directly — it outputs prompts for the AI host to execute.

#### Scenario: Character knowledge consistency check
- **WHEN** generating a validation prompt for character knowledge
- **THEN** the prompt SHALL include: each character's knowledge timeline from wiki pages, and the instruction "Verify the character does not act on knowledge they have not yet acquired"
- **AND** the expected output format SHALL be a JSON schema: `{ passed: boolean, issues: [{ character, knownAt: chapter, actedOnAt: chapter, description }] }`
- **AND** the prompt SHALL include the chapter content being validated

#### Scenario: New character with no existing knowledge timeline
- **WHEN** generating a knowledge check for a character that has no wiki page or an empty knowledge timeline
- **THEN** the prompt SHALL note: "Character <name> is newly introduced — no prior knowledge constraints apply"

#### Scenario: Timeline contradiction check
- **WHEN** generating a validation prompt for timeline
- **THEN** the prompt SHALL include: the absolute timeline from wiki timeline pages, and the instruction "Verify events occur in logical temporal order"
- **AND** SHALL instruct the LLM to flag events that reference future events without justification

#### Scenario: POV discipline check
- **WHEN** generating a validation prompt for POV
- **THEN** the prompt SHALL include: the declared POV character (extracted from scene-plan or brief frontmatter), and the instruction "Verify the narrative stays within the declared POV — no head-hopping"
- **AND** if no POV character is declared in scene-plan or brief, SHALL note that and still generate the check

#### Scenario: Foreshadowing integrity check
- **WHEN** generating a validation prompt for foreshadowing
- **THEN** the prompt SHALL include: active promises from wiki threads (with status "open" or "advanced"), and the instruction "Verify no active promise was accidentally resolved without acknowledgment, and no new promise contradicts existing ones"

#### Scenario: Voice blending check
- **WHEN** generating a validation prompt for character voice
- **THEN** the prompt SHALL include: voice examples from wiki style pages, and the instruction "Verify each character's dialogue maintains their established voice"

#### Scenario: World rule violation check
- **WHEN** generating a validation prompt for world rules
- **THEN** the prompt SHALL include: established world rules from wiki locations and factions, and the instruction "Flag any violation of established world rules that lacks a wiki-diff entry explaining the change"

### Requirement: Continuity linter shall provide configurable severity levels
Each semantic check SHALL output issues with severity (error/warning/info).

#### Scenario: Severity classification
- **WHEN** a check finds a likely contradiction with strong evidence
- **THEN** the issue SHALL have severity "error"
- **WHEN** a check finds a minor inconsistency
- **THEN** the issue SHALL have severity "warning"
- **WHEN** a check finds a suggestion for improvement
- **THEN** the issue SHALL have severity "info"

### Requirement: Continuity linter shall respect project rules
Config-based rules SHALL be included in generated validation prompts as top-level constraints.

#### Scenario: Custom rule inclusion
- **WHEN** config has `rules.revision: ["Preserve established character knowledge."]`
- **THEN** the revision validation prompt SHALL include this rule as a top-level constraint under a `## Project Rules` section

### Requirement: Continuity linter shall support per-artifact validation profiles
Different artifacts SHALL have different default check sets.

#### Scenario: Draft validation profile
- **WHEN** validating a `draft` artifact
- **THEN** the linter SHALL by default generate checks for: POV discipline, voice blending, world rule compliance

#### Scenario: Revision validation profile
- **WHEN** validating a `revision` artifact
- **THEN** the linter SHALL by default generate checks for: all draft checks + character knowledge consistency, timeline correctness, foreshadowing integrity

#### Scenario: Wiki-diff validation profile
- **WHEN** validating a `wiki-diff` artifact
- **THEN** the linter SHALL by default generate checks for: source citation validity, contradiction flagging completeness

#### Scenario: Unknown artifact — no checks
- **WHEN** validating an artifact with no defined validation profile
- **THEN** the linter SHALL return an empty check set (noop)
