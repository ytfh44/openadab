# desktop-manuscript-wiki-timeline Specification

## Purpose
TBD - created by archiving change add-electron-desktop-gui. Update Purpose after archive.
## Requirements
### Requirement: Manuscript workspace shall organize chapters without becoming a generic file explorer
The Manuscript workspace SHALL present manuscript chapters as story units backed by Markdown files.

#### Scenario: List chapters
- **WHEN** the Manuscript workspace loads
- **THEN** it SHALL list chapter Markdown files under `adab/manuscript/chapters/`
- **AND** it SHALL show chapter id, title if available, word count, status if available, and source change if known

#### Scenario: Preview chapter
- **WHEN** the user selects a chapter
- **THEN** the workspace SHALL show Markdown preview, frontmatter, linked wiki pages, and related change if known

#### Scenario: Edit chapter
- **WHEN** the user enters manuscript edit mode
- **THEN** direct writes to `adab/manuscript/chapters/` SHALL require a diff preview and explicit confirmation
- **AND** the UI SHALL explain that normal chapter production should flow through a change and archive

### Requirement: Wiki workspace shall manage canon pages with evidence visibility
The Wiki workspace SHALL browse and edit wiki pages while making canon evidence visible.

#### Scenario: Browse by type
- **WHEN** the Wiki workspace loads
- **THEN** it SHALL group pages by type such as characters, locations, threads, world rules, objects, organizations, and uncategorized pages

#### Scenario: Open wiki page
- **WHEN** the user selects a wiki page
- **THEN** the workspace SHALL show Markdown body, frontmatter, backlinks, outgoing wikilinks, mentions, progressions, and source evidence when available

#### Scenario: Edit wiki page
- **WHEN** the user edits a wiki page directly
- **THEN** save SHALL require confirmation
- **AND** the UI SHALL prefer wiki-diff review for changes derived from manuscript or continuity reports

#### Scenario: Wiki lint
- **WHEN** the user runs wiki lint
- **THEN** the app SHALL run `openadab wiki lint --json`
- **AND** lint errors and warnings SHALL be displayed by page

### Requirement: Timeline workspace shall visualize continuity from indexed evidence
The Timeline workspace SHALL display continuity views derived from manuscript, wiki, mentions, and progression indexes.

#### Scenario: Narrative order timeline
- **WHEN** chapters and progression events exist
- **THEN** the Timeline workspace SHALL show events in manuscript chapter order
- **AND** each event SHALL link to its source chapter, artifact, or wiki page where known

#### Scenario: Story-time timeline
- **WHEN** events include story-time metadata in frontmatter or progression data
- **THEN** the Timeline workspace SHALL allow ordering by story time
- **AND** events without story-time metadata SHALL remain visible in an unknown-time lane

#### Scenario: Character knowledge timeline
- **WHEN** a character has knowledge timeline entries
- **THEN** the Timeline workspace SHALL show what the character knows at each chapter
- **AND** it SHALL flag possible knowledge contradictions reported by validation or progression data

#### Scenario: Location movement and thread status
- **WHEN** location state changes or thread status changes exist
- **THEN** the Timeline workspace SHALL show location movement lanes and thread status lanes
- **AND** resolved, advanced, open, and contradiction states SHALL be visually distinct

#### Scenario: Stale index data
- **WHEN** timeline data depends on stale or missing index files
- **THEN** the workspace SHALL show a stale-index warning
- **AND** it SHALL offer sync/index actions when appropriate

#### Scenario: Missing change context for sync
- **WHEN** the Timeline workspace has stale progression data but no selected change id
- **THEN** it SHALL NOT run `openadab sync` without `--change`
- **AND** it SHALL route the user to choose a change or run only a command that does not require a change id

#### Scenario: Wiki index refresh
- **WHEN** the stale data is limited to wiki links or wiki page index state
- **THEN** the workspace SHALL run `openadab wiki index --json`
- **AND** it SHALL display command failure instead of silently swallowing it

