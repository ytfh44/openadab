## ADDED Requirements

### Requirement: Continuity linter shall generate semantic validation prompts for LLM execution
The `ContinuityLinter` module SHALL generate structured LLM prompts for semantic validation of story continuity. The CLI does NOT invoke LLMs directly — it outputs prompts for the AI host to execute.

#### Scenario: Character knowledge consistency check
- **WHEN** generating a validation prompt for character knowledge
- **THEN** the prompt SHALL include: the character's knowledge timeline from wiki, the manuscript chapter content, and the instruction "Verify the character does not act on knowledge they have not yet acquired"
- **AND** the expected output format SHALL be: `{ passed: boolean, issues: [{ character, knownAt: chapter, actedOnAt: chapter, description }] }`

#### Scenario: New character with no existing knowledge timeline
- **WHEN** generating a knowledge check for a character that has no wiki page or an empty knowledge timeline (first appearance in this chapter)
- **THEN** the prompt SHALL note: "Character X is newly introduced — no prior knowledge constraints apply"
- **AND** the check SHALL pass by default (no prior state to contradict)

#### Scenario: Timeline contradiction check
- **WHEN** generating a validation prompt for timeline
- **THEN** the prompt SHALL include: the absolute timeline from wiki, the narrative order, and the instruction "Verify events occur in logical temporal order"
- **AND** the prompt SHALL flag events that reference future events without justification

#### Scenario: POV discipline check
- **WHEN** generating a validation prompt for POV
- **THEN** the prompt SHALL include: the declared POV character from scene-plan, the manuscript chapter, and the instruction "Verify the narrative stays within the declared POV — no head-hopping"
- **AND** the prompt SHALL detect paragraphs that reveal non-POV character internal states

#### Scenario: Foreshadowing integrity check
- **WHEN** generating a validation prompt for foreshadowing
- **THEN** the prompt SHALL include: the active promises from wiki threads, the new chapter content, and the instruction "Verify no active promise was accidentally resolved without acknowledgment, and no new promise contradicts existing ones"

#### Scenario: Voice blending check
- **WHEN** generating a validation prompt for character voice
- **THEN** the prompt SHALL include: voice examples for each dialogue character (from wiki style pages), the dialogue sections, and the instruction "Verify each character's dialogue maintains their established voice"

#### Scenario: World rule violation check
- **WHEN** generating a validation prompt for world rules
- **THEN** the prompt SHALL include: established world rules from wiki (locations, factions, style), the new content, and the instruction "Flag any violation of established world rules that lacks a wiki-diff entry explaining the change"

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
Config-based rules SHALL be included in generated validation prompts.

#### Scenario: Custom rule inclusion
- **WHEN** config has `rules.revision: ["Preserve established character knowledge."]`
- **THEN** the revision validation prompt SHALL include this rule as a top-level constraint
- **AND** the LLM SHALL be instructed to check specifically against this rule

### Requirement: Continuity linter shall support per-artifact validation profiles
Different artifacts SHALL have different default check sets.

#### Scenario: Draft validation profile
- **WHEN** validating a `draft` artifact
- **THEN** the linter SHALL by default check: POV discipline, voice consistency, world rule compliance

#### Scenario: Revision validation profile
- **WHEN** validating a `revision` artifact
- **THEN** the linter SHALL by default check: all draft checks + character knowledge consistency, timeline correctness, improvement over draft

#### Scenario: Wiki-diff validation profile
- **WHEN** validating a `wiki-diff` artifact
- **THEN** the linter SHALL by default check: source citation validity, contradiction flagging completeness, operation target existence
