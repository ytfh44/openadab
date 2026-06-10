## ADDED Requirements

### Requirement: Wiki engine shall provide CRUD operations for wiki pages
The `WikiEngine` module SHALL read, write, list, and delete wiki pages in the `adab/wiki/` directory structure.

#### Scenario: Read wiki page with frontmatter
- **WHEN** reading `adab/wiki/characters/mara.md`
- **THEN** the engine SHALL parse YAML frontmatter into a typed object
- **AND** SHALL return the Markdown body after the frontmatter
- **AND** the frontmatter object SHALL include `type`, `name`, `status`, `first_seen`, `last_updated`, `sources`, `tags`

#### Scenario: Write wiki page preserving structure
- **WHEN** writing a character page with updated frontmatter and body
- **THEN** the engine SHALL write YAML frontmatter first, followed by a blank line, then the Markdown body
- **AND** SHALL update `last_updated` in frontmatter to current ISO timestamp
- **AND** SHALL preserve any existing frontmatter fields not explicitly changed
- **AND** SHALL validate frontmatter against the per-type zod schema before writing

#### Scenario: List wiki pages by type
- **WHEN** listing wiki pages with filter `type: character`
- **THEN** the engine SHALL return all pages whose frontmatter `type` field matches `character`, regardless of subdirectory

#### Scenario: Validate frontmatter schema
- **WHEN** writing a wiki page
- **THEN** the engine SHALL validate frontmatter against the required schema for its `type`
- **AND** SHALL reject writes with missing required fields (e.g., character requires `name`, `status`)

### Requirement: Wiki engine shall generate index.md
The engine SHALL generate a comprehensive table of contents at `adab/wiki/index.md`.

#### Scenario: Index generation
- **WHEN** running `wiki index`
- **THEN** the generated `index.md` SHALL list all wiki pages grouped by type (Characters, Locations, Factions, Timeline, Threads, Style, Motifs)
- **AND** each entry SHALL include the page name, status, and a brief summary (first heading after frontmatter)
- **AND** entries SHALL be Markdown wikilinks using the page's file path (e.g., `[[characters/mara]]`, `[[locations/east-gate]]`)
- **AND** the index SHALL exclude derived pages: `index.md`, `overview.md`, `contradictions.md`

#### Scenario: Index updates on page change
- **WHEN** a wiki page is written or deleted (via `writePage` or `deletePage`)
- **THEN** the engine SHALL update `index.md` to reflect the change
- **AND** SHALL regenerate `wikilinks.json` alongside the index
- **NOTE**: For batch operations (e.g., wiki-diff apply modifying multiple pages), the engine SHALL defer index and wikilinks regeneration via `beginBatch()` / `endBatch()` until all writes complete, then regenerate once. Single-page writes trigger immediate regeneration.
- **NOTE**: `generateIndex` is guarded against re-entrant calls — if already generating, subsequent triggers are no-ops.

### Requirement: Wiki engine shall generate wikilinks.json
The engine SHALL build a link graph of inter-page references.

#### Scenario: Wikilink extraction
- **WHEN** generating `adab/index/wikilinks.json`
- **THEN** the output SHALL be a JSON object mapping each page (path without `.md`) to its link graph:
  - `links`: array of pages this page links to (via `[[...]]` syntax, normalized without `.md`)
  - `backlinks`: array of pages that link to this page
  - `broken`: boolean — `true` if any forward link targets a non-existent wiki page

#### Scenario: Broken link detection
- **WHEN** a page contains `[[characters/nonexistent]]` and `adab/wiki/characters/nonexistent.md` does not exist
- **THEN** the entry's `broken` field SHALL be `true`

### Requirement: Wiki engine shall manage contradictions.md
The contradictions page SHALL be a derived artifact from continuity reports and wiki-diffs.

#### Scenario: Contradiction entry format
- **WHEN** a wiki-diff flags a contradiction
- **THEN** the entry in `contradictions.md` SHALL include: description (as `##` heading), source references (as bullet items), status (`unresolved` | `explained` | `retconned`), and resolution (if resolved)

#### Scenario: Contradiction status update
- **WHEN** a follow-up change explains or retcons a contradiction (status `explained` or `retconned`)
- **THEN** the engine SHALL locate the existing unresolved entry by description and update its status in-place
- **AND** SHALL add a `Resolution` field citing the explaining source
- **AND** if no existing unresolved entry matches, SHALL treat the resolved operation as a new entry

### Requirement: Wiki engine shall support overview.md generation
The engine SHALL generate a high-level story synopsis from wiki pages.

#### Scenario: Overview generation
- **WHEN** generating `overview.md`
- **THEN** it SHALL summarize: setting (from locations), main characters (from characters with `status: canon`), central conflict (from threads with `status: open` or `advanced`), and current state (summary statistics)
- **AND** the output SHALL be Markdown suitable as a starting context for LLM sessions
- **AND** SHALL include fallback messages for empty sections (e.g., "No locations recorded.")
