## ADDED Requirements

### Requirement: Context packer shall select files based on priority algorithm
The `ContextPacker` module SHALL apply a deterministic greedy algorithm to select context files within a token budget, producing `mustRead`, `optionalRead`, and `excluded` lists with per-file reasons.

#### Scenario: Always-include config files
- **WHEN** config has `context.alwaysInclude: [adab/wiki/style/voice.md, adab/wiki/index.md]`
- **THEN** both files SHALL appear in `mustRead` with reason "config.alwaysInclude"

#### Scenario: Artifact dependency files included
- **WHEN** packing context for artifact `draft` which requires `[brief, scene-plan]`
- **THEN** both `brief.md` and `scene-plan.md` SHALL appear in `mustRead` with reason "artifact dependency"

#### Scenario: Entity-linked wiki pages from mention index
- **WHEN** the scene-plan.md mentions entity "Mara" (character) and "East Gate" (location)
- **AND** the mention index has entries for these entities
- **THEN** `adab/wiki/characters/mara.md` and `adab/wiki/locations/east-gate.md` SHALL appear in `mustRead` with reason "entity: Mara (POV character)" and "entity: East Gate (location)"

#### Scenario: Active thread wiki pages
- **WHEN** the continuity-report identifies active threads "east-gate-betrayal" and "missing-heir"
- **THEN** `adab/wiki/threads/open-threads.md` and related thread pages SHALL appear in `mustRead` with reason "thread: <name>"

#### Scenario: POV character wiki page always included
- **WHEN** the scene-plan specifies a POV character
- **THEN** that character's wiki page SHALL appear in `mustRead` with reason "POV character"

#### Scenario: Previous chapter in optional read
- **WHEN** packing context for chapter ch-012
- **THEN** `adab/manuscript/chapters/ch-011.md` SHALL appear in `optionalRead` with reason "previous chapter"

#### Scenario: First chapter has no previous chapter
- **WHEN** packing context for chapter ch-001
- **THEN** no previous chapter SHALL be included
- **AND** the context packer SHALL NOT error due to missing ch-000

#### Scenario: Gapped chapter sequence
- **WHEN** packing context for chapter ch-008 but the highest existing chapter is ch-005
- **THEN** ch-005 SHALL be treated as the "previous chapter" (last written, not necessarily sequential)
- **AND** the reason SHALL indicate "previous chapter (last written: ch-005)"

#### Scenario: Stale mention index warning
- **WHEN** the mention index's `.last-indexed` timestamp is older than the most recent manuscript chapter modification
- **THEN** the context packer SHALL emit a warning: "Mention index may be stale. Run `openadab sync` to regenerate."
- **AND** SHALL still use the available index data (best-effort)

#### Scenario: Related entity pages from wiki link graph
- **WHEN** the scene-plan mentions entity "Mara" who is linked (via `[[...]]` wikilinks) to "factions/priesthood" and "locations/east-gate"
- **THEN** the linked but not directly mentioned entities SHALL be included at priority 40 with reason "related entity: priesthood (via Mara)" 
- **AND** these entries SHALL be placed in `optionalRead` or `excluded` based on budget availability

### Requirement: Context packer shall respect token budget
Files SHALL be packed greedily by priority score until the estimated token budget is exhausted.

#### Scenario: Budget exceeded drops low-priority files
- **WHEN** total estimated tokens of all candidates exceed `maxTokens`
- **THEN** files with priority < 60 SHALL be moved to `excluded` list
- **AND** files with priority 60-79 MAY be moved to `optionalRead` if budget insufficient for `mustRead`
- **AND** files with priority >= 80 SHALL remain in `mustRead` (config overrides)

#### Scenario: Token estimation per file
- **WHEN** estimating tokens for a file
- **THEN** Chinese-language projects SHALL use `chars / 1.5` heuristic
- **AND** English-language projects SHALL use `chars / 4` heuristic
- **AND** the heuristic SHALL be configurable via `context.tokenHeuristic`

### Requirement: Context packer shall produce explainable output
The output SHALL include a `reasons` map explaining why each file was included.

#### Scenario: Reasons for each mustRead file
- **WHEN** a file is in `mustRead`
- **THEN** there SHALL be a corresponding entry in `reasons` explaining the selection logic

#### Scenario: Excluded files with reasons
- **WHEN** a file is in `excluded`
- **THEN** the reason SHALL indicate why it was dropped (e.g., "budget exceeded, priority 40 vs threshold 60")

### Requirement: Context packer shall support per-artifact budgets
When a schema artifact defines `contextBudget`, it SHALL override the global `maxTokens`.

#### Scenario: Artifact-specific budget
- **WHEN** schema artifact `draft` defines `contextBudget: 12000`
- **AND** global config has `maxTokens: 18000`
- **THEN** the context packer SHALL use a budget of 12000 tokens

#### Scenario: Fallback to global budget
- **WHEN** artifact has no `contextBudget` defined
- **THEN** the global `context.maxTokens` SHALL be used
