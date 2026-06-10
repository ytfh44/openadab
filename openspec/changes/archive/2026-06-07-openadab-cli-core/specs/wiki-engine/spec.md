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
- **AND** SHALL update `last_updated` in frontmatter to current timestamp
- **AND** SHALL preserve any existing frontmatter fields not explicitly changed

#### Scenario: List wiki pages by type
- **WHEN** listing wiki pages with filter `type: character`
- **THEN** the engine SHALL return all pages under `adab/wiki/characters/` and any other directories where pages have `type: character` in frontmatter

#### Scenario: Validate frontmatter schema
- **WHEN** writing a wiki page
- **THEN** the engine SHALL validate frontmatter against the required schema for its `type`
- **AND** SHALL reject writes with missing required fields (e.g., character requires `name`, `status`)

### Requirement: Wiki engine shall generate index.md
The engine SHALL generate a comprehensive table of contents at `adab/wiki/index.md`.

#### Scenario: Index generation
- **WHEN** running `wiki index`
- **THEN** the generated `index.md` SHALL list all wiki pages grouped by type (Characters, Locations, Factions, Timeline, Threads, Style, Motifs)
- **AND** each entry SHALL include the page name, type, status, and a brief summary (first heading after frontmatter)
- **AND** entries SHALL be Markdown links (`[[type/name]]` format)

#### Scenario: Index updates on page change
- **WHEN** a wiki page is written or deleted (via `writePage` or `deletePage`)
- **THEN** the engine SHALL update `index.md` to reflect the change
- **AND** SHALL log the index update to `log.md`
- **NOTE**: For batch operations (e.g., wiki-diff apply modifying multiple pages), the engine SHALL defer index regeneration until all writes complete, then regenerate once. Single-page writes update the index immediately.

### Requirement: Wiki engine shall generate wikilinks.json
The engine SHALL build a link graph of inter-page references.

#### Scenario: Wikilink extraction
- **WHEN** generating `wikilinks.json`
- **THEN** the output SHALL be a JSON object mapping each page to an array of pages it links to (via `[[...]]` syntax)
- **AND** SHALL include backlinks (pages that link to each page)
- **AND** SHALL flag broken links (target page does not exist)

### Requirement: Wiki engine shall manage contradictions.md
The contradictions page SHALL be a derived artifact from continuity reports and wiki-diffs.

#### Scenario: Contradiction entry format
- **WHEN** a wiki-diff flags a contradiction
- **THEN** the entry in `contradictions.md` SHALL include: description, source A (page + claim), source B (page + claim), status (unresolved | explained | retconned), and resolution (if resolved)

#### Scenario: Contradiction status update
- **WHEN** a follow-up change explains or retcons a contradiction
- **THEN** the contradiction entry's status SHALL be updated
- **AND** the resolution field SHALL cite the explaining source

### Requirement: Wiki engine shall support overview.md generation
The engine SHALL generate a high-level story synopsis from wiki pages.

#### Scenario: Overview generation
- **WHEN** generating `overview.md`
- **THEN** it SHALL summarize: setting (from locations), main characters (from characters with `status: canon`), central conflict (from threads), and current state (from timeline)
- **AND** the output SHALL be Markdown suitable as a starting context for LLM sessions
