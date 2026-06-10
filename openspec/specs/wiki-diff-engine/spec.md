## ADDED Requirements

### Requirement: Wiki-diff engine shall parse semantic wiki-diff from Markdown
The `WikiDiffEngine` module SHALL parse the semantic wiki-diff Markdown format into structured JSON operations.

#### Scenario: Parse character update operation
- **WHEN** parsing a wiki-diff containing:
  ```markdown
  ### [[characters/mara]]
  Source: manuscript/chapters/ch-012.md
  #### Add to Current State
  - Mara now knows the east gate was opened from inside.
  ```
- **THEN** the parser SHALL produce:
  ```json
  { "type": "add_current_state", "target": "characters/mara.md", "source": "manuscript/chapters/ch-012.md", "content": "Mara now knows the east gate was opened from inside." }
  ```

#### Scenario: Parse knowledge timeline update
- **WHEN** parsing a knowledge timeline section with table rows `| ch-012 | Knowledge text |`
- **THEN** the parser SHALL produce `add_knowledge_timeline` operation with `chapter` and `knowledge` fields
- **AND** SHALL skip header row (`Chapter`) and separator row (`---`)

#### Scenario: Parse relationship update
- **WHEN** parsing a relationship section with "Mara and Lin are now allies"
- **THEN** the parser SHALL produce `update_relationship` operation with `relatedEntity`, `relationship`, and `source` fields

#### Scenario: Parse thread status update
- **WHEN** parsing a thread section with `Status: advanced`
- **THEN** the parser SHALL produce `update_thread_status` operation
- **AND** SHALL reject invalid status values (only `open`, `advanced`, `resolved` are valid)

#### Scenario: Parse evidence addition
- **WHEN** parsing a section with `New evidence: ...`
- **THEN** the parser SHALL produce `add_evidence` or `update_thread_status` operation with `evidence` array

#### Scenario: Parse field update
- **WHEN** parsing a wiki-diff section with `Update Field` heading containing `field_name: value`
- **THEN** the parser SHALL produce `update_field` operation with `field` and `value` fields
- **AND** SHALL auto-detect value type: numbers (if `^-?\d+(\.\d+)?$`), booleans (`true`/`false`), otherwise string

#### Scenario: Parse contradiction flagging
- **WHEN** parsing a "Flag Contradiction" section with Description and source references
- **THEN** the parser SHALL produce `flag_contradiction` operation with `description`, `sources` array, and `status: "unresolved"`

#### Scenario: Parse error on malformed diff
- **WHEN** parsing a wiki-diff with unrecognized `####` section headers
- **THEN** the parser SHALL throw `WikiDiffParseError` with the unrecognized section name and line number

#### Scenario: Duplicate operation detection
- **WHEN** two operations within the same target have identical type, target, and content
- **THEN** the parser SHALL throw `WikiDiffParseError` indicating a duplicate operation

#### Scenario: Empty wiki-diff (no operations)
- **WHEN** parsing a wiki-diff.md that exists but contains no operations (all sections empty or no entity updates declared)
- **THEN** the parser SHALL return a `WikiDiffDocument` with `changeId` (extracted from YAML frontmatter or regex fallback) and an empty `operations` array

#### Scenario: Change ID extraction
- **WHEN** parsing a wiki-diff
- **THEN** the parser SHALL extract `changeId` from YAML frontmatter first
- **AND** SHALL fall back to regex match on raw Markdown if frontmatter extraction fails
- **AND** SHALL default to `"unknown"` if no change ID is found

### Requirement: Wiki-diff engine shall validate operations before application
Each operation SHALL be validated before application.

#### Scenario: Target page exists validation
- **WHEN** an operation targets `characters/nonexistent.md`
- **THEN** the engine SHALL throw `TargetNotFoundError` with the target page path
- **AND** target paths SHALL be resolved within the wiki directory boundary via `resolveWithinBoundary()`

#### Scenario: Source citation validation
- **WHEN** an operation lacks a `source` field or has an empty source
- **THEN** the engine SHALL throw `MissingSourceError`: "Every wiki-diff operation must cite a manuscript or raw source path"

#### Scenario: Idempotency check
- **WHEN** applying a diff where the target page's `last_updated` is newer than the diff's source chapter (by numeric chapter comparison)
- **THEN** the engine SHALL warn: "Target page <path> was updated by a later chapter — diff may be stale"
- **AND** `flag_contradiction` operations SHALL skip the idempotency check

### Requirement: Wiki-diff engine shall apply operations to wiki pages
The engine SHALL modify wiki pages according to the parsed operations.

#### Scenario: Apply add_current_state to character page
- **WHEN** applying an `add_current_state` operation to `characters/mara.md`
- **THEN** the engine SHALL read the page, locate the "## Current State" section, append the new state entry, and write back
- **AND** if no "Current State" section exists, SHALL create one and append
- **AND** the page's frontmatter `last_updated` field SHALL be updated to the source value

#### Scenario: Apply add_knowledge_timeline to character page
- **WHEN** applying an `add_knowledge_timeline` operation
- **THEN** the engine SHALL append a row to the "## Knowledge Timeline" table: `| <chapter> | <knowledge> |`
- **AND** if no "Knowledge Timeline" section exists, SHALL create one with header row

#### Scenario: Apply update_relationship to character page
- **WHEN** applying an `update_relationship` operation
- **THEN** the engine SHALL locate the "## Relationships" section and append or update the relationship entry
- **AND** SHALL also update the related entity's page with a reciprocal relationship entry (bidirectional update), or warn if the related entity is not found in wiki

#### Scenario: Apply update_thread_status
- **WHEN** applying an `update_thread_status` operation changing thread to "advanced"
- **THEN** the engine SHALL update the thread page's frontmatter `status` field
- **AND** SHALL append any new evidence items to the "## Evidence" section

#### Scenario: Apply add_evidence to thread page
- **WHEN** applying an `add_evidence` operation
- **THEN** the engine SHALL append the evidence item to the thread page's "## Evidence" list

#### Scenario: Apply update_field to page frontmatter
- **WHEN** applying an `update_field` operation
- **THEN** the engine SHALL update the specified frontmatter field with the provided value
- **AND** SHALL preserve all other frontmatter fields unchanged
- **AND** SHALL throw `AdabError` with code `WIKI_DIFF_TYPE_MISMATCH` if the existing field type differs from the new value's type

#### Scenario: Apply flag_contradiction
- **WHEN** applying a `flag_contradiction` operation
- **THEN** the engine SHALL append the contradiction entry to `contradictions.md` with: `## <description>` heading, source reference bullets, and `- Status: unresolved`
- **AND** SHALL use the `upateContradictions` helper on the WikiEngine for resolved contradictions (explained/retconned)

### Requirement: Wiki-diff engine shall support --dry-run mode
The `--dry-run` flag SHALL preview changes without writing.

#### Scenario: Dry-run shows changes
- **WHEN** running `wiki apply-diff <path> --dry-run`
- **THEN** the engine SHALL parse and validate all operations
- **AND** SHALL output a summary: "Would modify N page(s): <pages> (+N entries), contradictions.md (+N entries)"
- **AND** SHALL reveal current thread status for `update_thread_status` operations
- **AND** SHALL NOT write any files

### Requirement: Wiki-diff engine shall support --apply mode
The `--apply` flag SHALL execute all validated operations.

#### Scenario: Apply all operations
- **WHEN** running `wiki apply-diff <path> --apply`
- **THEN** the engine SHALL execute all validated operations within a batch (`beginBatch()` / `endBatch()`)
- **AND** SHALL output a summary of pages modified
- **AND** SHALL return success result with exit code 0

#### Scenario: Apply with validation failures
- **WHEN** running `--apply` and some operations fail validation
- **THEN** the engine SHALL abort before any writes
- **AND** SHALL output all validation errors
- **AND** SHALL return failure result (success: false)

### Requirement: Wiki-diff engine shall support --change convenience flag
For convenience, the engine SHALL accept `--change <id>` as an alternative to specifying the full path.

#### Scenario: Apply via change ID
- **WHEN** running `wiki apply-diff --change draft-ch-012 --dry-run`
- **THEN** the engine SHALL resolve the wiki-diff path to `adab/changes/draft-ch-012/wiki-diff.md`
- **AND** SHALL proceed with normal dry-run behavior
