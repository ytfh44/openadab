## ADDED Requirements

### Requirement: Wiki-diff engine shall parse semantic wiki-diff from Markdown
The `WikiDiffEngine` module SHALL parse the semantic wiki-diff Markdown format into structured JSON operations.

#### Scenario: Parse character update operation
- **WHEN** parsing a wiki-diff containing:
  ```markdown
  ### [[characters/mara]]
  Source: manuscript/chapters/ch-012.md
  Add to Current State:
  - Mara now knows the east gate was opened from inside.
  ```
- **THEN** the parser SHALL produce:
  ```json
  { "type": "add_current_state", "target": "characters/mara", "source": "manuscript/chapters/ch-012.md", "content": "Mara now knows the east gate was opened from inside." }
  ```

#### Scenario: Parse knowledge timeline update
- **WHEN** parsing a knowledge timeline section
- **THEN** the parser SHALL produce `add_knowledge_timeline` operation with chapter and knowledge fields

#### Scenario: Parse relationship update
- **WHEN** parsing a relationship section with "Mara and Lin are now allies"
- **THEN** the parser SHALL produce `update_relationship` operation with `relatedEntity`, `relationship`, and `source` fields

#### Scenario: Parse thread status update
- **WHEN** parsing a thread section with `Status: advanced`
- **THEN** the parser SHALL produce `update_thread_status` operation

#### Scenario: Parse evidence addition
- **WHEN** parsing a thread section with `New evidence: ...`
- **THEN** the parser SHALL produce `add_evidence` operation with `evidence` field

#### Scenario: Parse field update
- **WHEN** parsing a wiki-diff section that explicitly updates a frontmatter field
- **THEN** the parser SHALL produce `update_field` operation with `field` and `value` fields

#### Scenario: Parse contradiction flagging
- **WHEN** parsing a "Potential Contradictions" section
- **THEN** the parser SHALL produce `flag_contradiction` operations with source references

#### Scenario: Parse error on malformed diff
- **WHEN** parsing a wiki-diff with unrecognized section headers
- **THEN** the parser SHALL throw `WikiDiffParseError` with the unrecognized section name and line number

#### Scenario: Empty wiki-diff (no operations)
- **WHEN** parsing a wiki-diff.md that exists but contains no operations (all sections empty or no entity updates declared)
- **THEN** the parser SHALL return an empty operations array (not an error)
- **AND** the applier SHALL treat this as a no-op (valid state, nothing to apply)

### Requirement: Wiki-diff engine shall validate operations before application
Each operation SHALL be validated before application.

#### Scenario: Target page exists validation
- **WHEN** an operation targets `characters/nonexistent`
- **THEN** the engine SHALL throw `TargetNotFoundError` with the target page path

#### Scenario: Source citation validation
- **WHEN** an operation lacks a `source` field
- **THEN** the engine SHALL throw `MissingSourceError`: "Every wiki-diff operation must cite a manuscript or raw source path"

#### Scenario: Idempotency check
- **WHEN** applying a diff where the target page's `last_updated` is newer than the diff's chapter
- **THEN** the engine SHALL warn: "Target page was updated by a later chapter — diff may be stale"

### Requirement: Wiki-diff engine shall apply operations to wiki pages
The engine SHALL modify wiki pages according to the parsed operations.

#### Scenario: Apply add_current_state to character page
- **WHEN** applying an `add_current_state` operation to `characters/mara`
- **THEN** the engine SHALL read the page, locate the "## Current State" section, append the new state entry, and write back
- **AND** the page's frontmatter `last_updated` field SHALL be updated to the source chapter

#### Scenario: Apply add_knowledge_timeline to character page
- **WHEN** applying an `add_knowledge_timeline` operation
- **THEN** the engine SHALL append a row to the "Knowledge Timeline" table: `| ch-012 | <knowledge> |`

#### Scenario: Apply update_relationship to character page
- **WHEN** applying an `update_relationship` operation
- **THEN** the engine SHALL locate the "Relationships" section and append or update the relationship entry
- **AND** the entry SHALL include the related entity name and relationship description

#### Scenario: Apply update_thread_status
- **WHEN** applying an `update_thread_status` operation changing thread to "advanced"
- **THEN** the engine SHALL update the thread page's status field (frontmatter or section header)

#### Scenario: Apply add_evidence to thread page
- **WHEN** applying an `add_evidence` operation
- **THEN** the engine SHALL append the evidence item to the thread page's evidence list

#### Scenario: Apply update_field to page frontmatter
- **WHEN** applying an `update_field` operation
- **THEN** the engine SHALL update the specified frontmatter field with the provided value
- **AND** SHALL preserve all other frontmatter fields unchanged

#### Scenario: Apply flag_contradiction
- **WHEN** applying a `flag_contradiction` operation
- **THEN** the engine SHALL append the contradiction entry to `contradictions.md`
- **AND** the entry SHALL include source references and status "unresolved"

### Requirement: Wiki-diff engine shall support --dry-run mode
The `--dry-run` flag SHALL preview changes without writing.

#### Scenario: Dry-run shows changes
- **WHEN** running `wiki apply-diff <path> --dry-run`
- **THEN** the engine SHALL parse and validate all operations
- **AND** SHALL output a summary: "Would modify 3 pages: characters/mara (+2 entries), threads/east-gate-betrayal (status: open→advanced), contradictions.md (+1 entry)"
- **AND** SHALL NOT write any files

### Requirement: Wiki-diff engine shall support --apply mode
The `--apply` flag SHALL execute all validated operations.

#### Scenario: Apply all operations
- **WHEN** running `wiki apply-diff <path> --apply`
- **THEN** the engine SHALL execute all validated operations
- **AND** SHALL output a summary of pages modified
- **AND** SHALL return exit code 0 on success

#### Scenario: Apply with validation failures
- **WHEN** running `--apply` and some operations fail validation
- **THEN** the engine SHALL abort before any writes
- **AND** SHALL output all validation errors
- **AND** SHALL return exit code 1

### Requirement: Wiki-diff engine shall support --change convenience flag
For convenience, the engine SHALL accept `--change <id>` as an alternative to specifying the full path.

#### Scenario: Apply via change ID
- **WHEN** running `wiki apply-diff --change draft-ch-012 --dry-run`
- **THEN** the engine SHALL resolve the wiki-diff path to `adab/changes/draft-ch-012/wiki-diff.md`
- **AND** SHALL proceed with normal dry-run behavior
