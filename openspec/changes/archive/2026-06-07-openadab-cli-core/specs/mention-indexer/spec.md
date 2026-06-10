## ADDED Requirements

### Requirement: Mention indexer shall extract entity mentions from source files
The `MentionIndexer` module SHALL scan manuscript chapters, change drafts/revisions, and wiki pages for mentions of known entities using exact name and alias matching.

#### Scenario: Exact name matching
- **WHEN** scanning a chapter for entity "Mara" (from `adab/wiki/characters/mara.md`)
- **THEN** the indexer SHALL find all occurrences of "Mara" as a word-boundary-delimited match
- **AND** SHALL record each occurrence with file path, line number, and surrounding context (50 chars before/after)

#### Scenario: Alias matching
- **WHEN** entity "Mara" has frontmatter `aliases: ["the courtier", "Lady Mara"]`
- **THEN** the indexer SHALL also match "the courtier" and "Lady Mara" as references to the same entity

#### Scenario: Case sensitivity
- **WHEN** matching entity names
- **THEN** the indexer SHALL be case-sensitive by default (configurable)
- **AND** SHALL treat "mara" and "Mara" as different entities unless configured otherwise

#### Scenario: Multi-entity scanning
- **WHEN** scanning a file that mentions 5 different wiki entities
- **THEN** the indexer SHALL record all 5 entity mentions independently
- **AND** each entity's mention list SHALL be ordered by line number

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

#### Scenario: Appearance context limitation
- **WHEN** recording context around a mention
- **THEN** the context SHALL be limited to 100 characters total (50 before + 50 after)
- **AND** SHALL not cross paragraph boundaries

### Requirement: Mention indexer shall generate context-map.json
The module SHALL create a fast-lookup map for the context packer.

#### Scenario: context-map.json format
- **WHEN** generating `adab/index/context-map.json`
- **THEN** the output SHALL be a JSON object mapping each source file to the entities mentioned in it
- **AND** SHALL be the inverse index of `mentions.json`
- **AND** the context packer SHALL use this for O(1) "which entities appear in scene-plan?" queries

### Requirement: Mention indexer shall support incremental updates
The indexer SHALL support re-indexing only changed files.

#### Scenario: Incremental re-index
- **WHEN** only `manuscript/chapters/ch-012.md` changed since last index
- **THEN** the indexer SHALL only re-scan that file
- **AND** SHALL merge new mentions with existing data from unchanged files

#### Scenario: Full re-index on request
- **WHEN** the indexer is invoked with the `full` flag (e.g., via `openadab sync --change <id> --full` or explicit internal call)
- **THEN** the indexer SHALL clear and regenerate all index files from scratch
- **AND** the indexer SHALL record the re-index timestamp in `adab/index/.last-indexed` for staleness detection
