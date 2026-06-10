## ADDED Requirements

### Requirement: Mention indexer shall extract entity mentions from source files
The `MentionIndexer` module SHALL scan manuscript chapters, change drafts/revisions, wiki pages, and raw notes for mentions of known entities using exact name and alias matching.

#### Scenario: Exact name matching
- **WHEN** scanning a chapter for entity "Mara" (from `adab/wiki/characters/mara.md`)
- **THEN** the indexer SHALL find all occurrences of "Mara" as a word-boundary-delimited match (for ASCII names) or as a substring match (for CJK names)
- **AND** SHALL record each occurrence with file path, line number, and surrounding context (limited to 100 chars: ~50 before + ~50 after, stopped at paragraph boundaries)

#### Scenario: Alias matching
- **WHEN** entity "Mara" has frontmatter `aliases: ["the courtier", "Lady Mara"]`
- **THEN** the indexer SHALL also match "the courtier" and "Lady Mara" as references to the same entity

#### Scenario: Case sensitivity
- **WHEN** matching entity names
- **THEN** the indexer SHALL be case-sensitive by default (configurable via constructor)
- **AND** SHALL treat "mara" and "Mara" as different entities unless configured otherwise

#### Scenario: Multi-entity scanning
- **WHEN** scanning a file that mentions 5 different wiki entities
- **THEN** the indexer SHALL record all 5 entity mentions independently
- **AND** each entity's mention list SHALL be ordered by line number
- **AND** duplicate mentions on the same line SHALL be deduplicated (one appearance per entity per line)

### Requirement: Mention indexer shall generate mentions.json
The output SHALL be a structured JSON file mapping entities to their appearances.

#### Scenario: mentions.json format
- **WHEN** generating `adab/index/mentions.json`
- **THEN** the output SHALL have the structure:
  ```json
  {
    "Mara": {
      "type": "character",
      "aliases": ["the courtier"],
      "appearances": [
        { "file": "manuscript/chapters/ch-003.md", "line": 42, "context": "...Mara entered the hall..." }
      ]
    }
  }
  ```

### Requirement: Mention indexer shall generate context-map.json
The module SHALL create a fast-lookup map for the context packer.

#### Scenario: context-map.json format
- **WHEN** generating `adab/index/context-map.json`
- **THEN** the output SHALL be a JSON object mapping normalized (OS-native) file paths to the canonical names of entities mentioned in that file
- **AND** SHALL be the inverse index of `mentions.json`
- **AND** the context packer SHALL use this for O(1) "which entities appear in scene-plan?" queries with path normalization

### Requirement: Mention indexer shall support incremental updates
The indexer SHALL support re-indexing only changed files. Source files are collected from four directories: `adab/manuscript/`, `adab/wiki/`, `adab/changes/`, and `adab/raw/`.

#### Scenario: Incremental re-index
- **WHEN** only `manuscript/chapters/ch-012.md` changed since last index (mtime > `.last-mention-indexed`)
- **THEN** the indexer SHALL build the entity registry fresh from wiki pages
- **AND** SHALL restore existing appearances from the last `mentions.json` for unchanged files
- **AND** SHALL remove stale appearances from modified files, then re-scan them
- **AND** SHALL generate both `mentions.json` and `context-map.json`, then write `.last-mention-indexed`

#### Scenario: Full re-index on request
- **WHEN** the indexer is invoked via `indexAll()` (e.g., first run or `--full` flag)
- **THEN** the indexer SHALL clear and regenerate all index files from scratch
- **AND** SHALL use a temporary results map to avoid mutating shared registry entries during scanning (race condition safety)
- **AND** the indexer SHALL record the re-index timestamp in `adab/index/.last-mention-indexed`

#### Scenario: No last-indexed timestamp falls back to full index
- **WHEN** `incrementalIndex()` is called but `.last-mention-indexed` does not exist or is not parseable
- **THEN** the indexer SHALL fall back to `indexAll()`

#### Scenario: Data safety — no changes detected
- **WHEN** `incrementalIndex()` finds no modified source files
- **THEN** the indexer SHALL return early without rewriting any files
