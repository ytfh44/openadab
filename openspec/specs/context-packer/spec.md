## ADDED Requirements

### Requirement: Context packer shall select files based on priority algorithm
The `ContextPacker` module SHALL apply a deterministic greedy algorithm to select context files within a token budget, producing `mustRead`, `optionalRead`, and `excluded` lists with per-file reasons.

#### Scenario: Always-include config files
- **WHEN** config has `context.alwaysInclude: [adab/wiki/style/voice.md, adab/wiki/index.md]`
- **THEN** both files SHALL appear in `mustRead` with reason "config.alwaysInclude"
- **AND** always-include files bypass the token budget check entirely

#### Scenario: Artifact dependency files included
- **WHEN** packing context for artifact `draft` which requires `[brief, scene-plan]`
- **THEN** both `brief.md` and `scene-plan.md` SHALL appear in `mustRead` with reason "artifact dependency"

#### Scenario: Entity-linked wiki pages from mention index
- **WHEN** the scene-plan.md mentions entity "Mara" (character) and "East Gate" (location)
- **AND** the context-map has entries for these entities
- **THEN** `adab/wiki/characters/mara.md` and `adab/wiki/locations/docks.md` SHALL appear in `mustRead` with reason "entity: <name> (<type>)"
- **AND** entity lookup resolves names and aliases from wiki page frontmatter

#### Scenario: Active thread wiki pages
- **WHEN** the continuity-report references active threads named in the report
- **AND** those threads have `status: open` or `active: true` in their frontmatter
- **THEN** those thread wiki pages SHALL appear in `mustRead` with reason "thread: <name>"

#### Scenario: POV character wiki page always included
- **WHEN** the scene-plan or brief specifies a POV character via `pov` frontmatter
- **THEN** that character's wiki page SHALL appear in `mustRead` with priority 85 and reason "POV character"

#### Scenario: Previous chapter in optional read
- **WHEN** packing context for chapter ch-012
- **THEN** `adab/manuscript/chapters/ch-011.md` SHALL appear in `optionalRead` at priority 50 with reason "previous chapter (last written: ch-011)"

#### Scenario: First chapter has no previous chapter
- **WHEN** packing context for chapter ch-001
- **THEN** no previous chapter SHALL be included
- **AND** the context packer SHALL NOT error due to missing ch-000

#### Scenario: Gapped chapter sequence
- **WHEN** packing context for chapter ch-008 but the highest existing chapter is ch-005
- **THEN** ch-005 SHALL be treated as the "previous chapter" (last written, not necessarily sequential)
- **AND** the reason SHALL indicate "previous chapter (last written: ch-005)"

#### Scenario: Stale mention index warning
- **WHEN** the mention index's `.last-mention-indexed` timestamp is older than the most recent modification time across ALL source directories (manuscript, wiki, changes, raw)
- **THEN** the context packer SHALL emit a warning with the last-indexed and latest-modification timestamps
- **AND** SHALL still use the available index data (best-effort)
- **AND** if `.last-mention-indexed` has never been written, SHALL warn: "Mention index has never been built."
- **AND** if `.last-mention-indexed` is corrupt (NaN), SHALL warn: "Mention index timestamp is corrupt. Rebuild recommended."

#### Scenario: Related entity pages from wiki link graph
- **WHEN** the scene-plan mentions entity "Mara" who is linked (via `[[...]]` wikilinks) to "factions/priesthood" and "locations/east-gate"
- **THEN** the linked but not directly mentioned entities SHALL be included at priority 40 with reason "related entity: <name> (via <source>)"
- **AND** only entities of type character, location, or faction SHALL be included
- **AND** these entries SHALL be placed in `optionalRead` or `excluded` based on budget availability

### Requirement: Context packer shall respect token budget
Files SHALL be packed greedily by priority score until the estimated token budget is exhausted.

#### Scenario: Budget exceeded drops low-priority files
- **WHEN** total estimated tokens of all candidates exceed `maxTokens`
- **THEN** files with priority < 60 SHALL be moved to `excluded` list with reason "budget exceeded, priority <N> vs threshold 60"
- **AND** files with priority 60-79 SHALL be placed in `optionalRead` if budget insufficient for `mustRead`
- **AND** files with priority >= 80 SHALL remain in `mustRead` regardless of budget (config overrides)

#### Scenario: Token estimation per file
- **WHEN** estimating tokens for a file
- **THEN** Chinese-language projects (language starts with `zh`) SHALL use `chars / 1.5` heuristic
- **AND** English-language projects SHALL use `chars / 4` heuristic
- **AND** the heuristic SHALL be configurable via `context.tokenHeuristic` (currently `chars-per-token`)
- **AND** when the heuristic is not set to `chars-per-token`, the default English divisor is used regardless of language

### Requirement: Context packer shall produce explainable output
The output SHALL include a `reasons` map explaining why each file was included.

#### Scenario: Reasons for each mustRead file
- **WHEN** a file is in `mustRead`
- **THEN** there SHALL be a corresponding entry in `reasons` explaining the selection logic

#### Scenario: Excluded files with reasons
- **WHEN** a file is in `excluded`
- **THEN** the reason SHALL indicate why it was dropped (e.g., "budget exceeded, priority 40 vs threshold 60")

### Requirement: Context packer shall support per-artifact budgets
When a schema artifact defines `contextBudget`, it SHALL override the global `maxTokens`. The schema for the change is resolved first from the change manifest, falling back to the active config schema.

#### Scenario: Artifact-specific budget
- **WHEN** schema artifact `draft` defines `contextBudget: 12000`
- **AND** global config has `maxTokens: 18000`
- **THEN** the context packer SHALL use a budget of 12000 tokens

#### Scenario: Fallback to global budget
- **WHEN** artifact has no `contextBudget` defined
- **THEN** the global `context.maxTokens` SHALL be used
