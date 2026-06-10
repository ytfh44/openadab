## ADDED Requirements

### Requirement: CLI shall scaffold project directory with `init`
The `openadab init` command SHALL create a complete `adab/` directory structure containing all required subdirectories, default configuration, built-in schema copies, empty wiki templates, host adapter files, and a `.gitignore`.

#### Scenario: Fresh project initialization
- **WHEN** user runs `openadab init` in an empty directory
- **THEN** the CLI creates `adab/config.yaml` with default values (schema: chapter-draft, language: zh-CN, genre: fantasy, maxTokens: 18000)
- **AND** creates `adab/manuscript/chapters/` (empty)
- **AND** creates `adab/manuscript/scenes/` (empty)
- **AND** creates `adab/wiki/` with subdirectories: characters/, locations/, factions/, objects/, timeline/, threads/, motifs/, style/
- **AND** creates `adab/wiki/index.md` (empty TOC template)
- **AND** creates `adab/wiki/overview.md` (empty synopsis template)
- **AND** creates `adab/wiki/contradictions.md` (empty, with header)
- **AND** creates `adab/raw/` with subdirectories: notes/, research/, imported-drafts/, references/
- **AND** creates `adab/changes/` with empty `archive/` subdirectory
- **AND** creates `adab/schemas/` with copies of built-in schemas (chapter-draft/, chapter-revision/, wiki-ingest/)
- **AND** creates `adab/index/` with empty JSON files: mentions.json, wikilinks.json, progressions.json, context-map.json
- **AND** creates `adab/log.md` with an initial `init` entry
- **AND** creates `.gitignore` excluding `adab/index/*.json`
- **AND** generates host adapter files for the detected host environment

#### Scenario: Re-initialization of existing project
- **WHEN** user runs `openadab init` in a directory that already contains `adab/`
- **THEN** the CLI SHALL warn the user and abort without overwriting
- **AND** suggest using `openadab update` instead

#### Scenario: Init with custom schema selection
- **WHEN** user runs `openadab init --schema chapter-revision`
- **THEN** the generated `adab/config.yaml` SHALL have `schema: chapter-revision`
- **AND** only the selected schema's templates SHALL be active

### Requirement: CLI shall update host adapters and built-in schemas with `update`
The `openadab update` command SHALL regenerate host adapter files from core command definitions and refresh built-in schemas from the CLI's built-in copies.

#### Scenario: Regenerate host adapters
- **WHEN** user runs `openadab update`
- **THEN** the CLI SHALL regenerate all host adapter files (skills, slash commands, AGENTS.md) from current core command definitions
- **AND** SHALL NOT overwrite user modifications to generated files (detected via content hash comparison)

#### Scenario: Refresh built-in schemas
- **WHEN** user runs `openadab update --schemas`
- **THEN** the CLI SHALL copy updated built-in schemas to `adab/schemas/`
- **AND** SHALL NOT overwrite user-forked schemas (identified by absence of `forked_from` metadata)

#### Scenario: Update outside a project directory
- **WHEN** user runs `openadab update` in a directory without `adab/`
- **THEN** the CLI SHALL error with "Not an OpenAdab project directory"
