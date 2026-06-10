## Why

Long-form fiction creation with LLMs fails at scale. By chapter 30, no AI host reliably tracks character knowledge, unresolved plot threads, canon status, or continuity across hundreds of pages. Existing tools (Novelcrafter, NovelAI) are SaaS-locked with no local protocol for systematic writing workflows. OpenSpec/OPSX demonstrates that schema-driven artifact graphs with CLI state detection make structured creative work tractable. Karpathy's LLM Wiki proves that LLMs can maintain a curated knowledge layer (wiki) alongside source material (raw) through explicit ingest/lint/index operations. OpenAdab combines these patterns into a local-first, host-neutral operating layer for fiction that transforms writing from "one prompt, one chapter" into artifact-driven workflows with reviewable canon gates, audit trails, and regenerable context packing — ensuring a 300,000-word novel still answers the critical questions: who knows what, which promises remain unfulfilled, and what has become canon.

## What Changes

This change builds the complete OpenAdab CLI core — a TypeScript CLI application implementing the full architecture designed through extensive analysis (openspec-explore session). It creates a local-first, host-neutral fiction workflow engine that:

- **Project lifecycle**: `init` scaffolds a project directory with `adab/` structure (manuscript, wiki, raw, changes, schemas, index), default schemas, empty wiki templates, and config.yaml. `update` regenerates host adapter files without overwriting user forks.
- **Schema-driven workflow engine**: YAML schemas define writing workflows as artifact DAGs (brief → scene-plan → draft → revision → continuity-report → wiki-diff → apply). The engine resolves artifact states (blocked/ready/done) via file existence and schema compliance, generates rich instructions from project config, artifact rules, templates, and dependency context, and supports schema forking for custom workflows.
- **Three data chains**: Manuscript Chain (chapters, scenes — immutable once archived), Wiki Chain (LLM-maintained structured story state: characters, locations, factions, timeline, threads, motifs, style, contradictions), and Log Chain (append-only audit trail). The wiki-diff gate ensures canon updates flow through proposed → reviewed → applied, never direct LLM mutation.
- **Context packer**: Token-budget-aware context selection per artifact type. Outputs `mustRead`, `optionalRead`, and `excluded` file lists with auditable reasons (POV character linkage, active thread advancement, scene-plan entity mentions). Supports `alwaysInclude` config and per-artifact token budgets.
- **Wiki engine**: CRUD for Markdown wiki pages with YAML frontmatter (type, name, status, sources, tags). Generates `index.md`, `overview.md`, `wikilinks.json`. Extracts and validates `[[wiki/link]]` references, timeline entries, and contradiction entries.
- **Mention indexer**: Scans manuscript chapters, drafts, and wiki pages for entity mentions (characters, locations, factions, objects) using exact wiki entity name matching plus declared aliases. Builds `mentions.json` and appearance maps per entity-chapter.
- **Progression tracker**: Tracks entity state changes across chapters — character knowledge timelines, relationship changes, location rule evolution, political landscape shifts — from continuity-report and wiki-diff sources. Outputs `progressions.json`.
- **Wiki diff & canon sync**: Semantic diff format (not line-diff) with defined operation vocabulary: `add_current_state`, `add_knowledge_timeline`, `update_relationship`, `update_thread_status`, `add_evidence`, `flag_contradiction`, `update_field`. Two application modes: `--dry-run` (preview changes without writing) and `--apply` (execute all validated operations). Every operation requires source citation to manuscript or raw source.
- **Continuity linter**: Generates LLM-executable validation prompts for semantic checks — character knowledge consistency, timeline contradiction, POV drift, foreshadowing preservation, voice blending, world rule violations. Mechanical validation (file existence, frontmatter, word count, chapter numbering, schema compliance) runs deterministically by CLI.
- **Host adapters**: Core command definitions (YAML) stored in CLI source — transformed into host-specific instruction files for Opencode (slash commands + skills), Cursor (rules), GitHub Copilot (instructions), and AGENTS.md (generic). Commands include `/adab:explore`, `/adab:new`, `/adab:continue`, `/adab:draft`, `/adab:revise`, `/adab:lint`, `/adab:extract-wiki`, `/adab:sync-wiki`, `/adab:archive`.
- **Sync & archive**: `sync` applies wiki-diff from the change directory, regenerates all indexes, appends log entries, and updates the change manifest to "synced". `archive` moves completed change to `changes/archive/`, copies final revision (per the schema's `apply` target) to `manuscript/chapters/`, and preserves the full audit trail including original artifacts.
- **Validation**: Two-tier — mechanical (CLI deterministic: file existence, schema compliance, frontmatter fields, word count, wiki link validity, chapter sequence) and semantic (LLM-executed: prompts for continuity, POV, timeline, contradictions).

The implementation stack is TypeScript with zod (schema validation), yaml (parsing), commander (CLI framework), ora + chalk (TUI), unified/remark + gray-matter (Markdown processing), fast-glob + chokidar (filesystem), and vitest (testing). All 16 core modules are pure TypeScript libraries with no CLI coupling — the CLI is a thin wrapper — ensuring testability, reusability, and potential future consumers (VS Code extension, web UI).

## Capabilities

### New Capabilities

- `project-init`: Project scaffolding — `adab/` directory structure creation, default config.yaml generation, built-in schema copying, default wiki templates, host adapter file generation, `.gitignore` creation. Supports `init` (new project) and `update` (regenerate adapters, refresh built-in schemas without touching user forks).

- `schema-engine`: YAML schema loading, validation (required fields, DAG acyclicity, artifact ID uniqueness, apply target resolution), template resolution. Schema forking (`fork <base> <name>` copies schema + templates to project). Supports per-artifact `validation` rules, `contextBudget` declarations, variable interpolation (`{{chapter}}`, `{{config.*}}`), and `instructionFile` as alternative to inline `instruction`.

- `artifact-graph`: DAG construction from schema artifacts, state detection per change directory (blocked/ready/done via file existence + validation), next-ready-artifact suggestion, blocking issue enumeration. Reads `.openadab.yaml` change manifests for metadata.

- `instruction-loader`: Assembles executable AI instructions from project config, artifact rules, template content, dependency artifact contents, context pack reference, schema-level context variables, and project-level `rules` (per-artifact). Output structured JSON with instruction text, output path, required reads, and context budget.

- `context-packer`: Token-budget-aware context selection. Algorithm: (1) config.alwaysInclude, (2) artifact dependencies (schema `requires`), (3) entity-linked wiki pages (from mention index + scene-plan entity references), (4) active thread wiki pages (from continuity-report), (5) related artifacts from adjacent chapters. Uses greedy priority packing with `maxTokens` budget. Outputs `mustRead`/`optionalRead`/`excluded` lists with per-file reasons. Supports per-artifact `contextBudget` from schema.

- `wiki-engine`: CRUD for wiki pages (Markdown + YAML frontmatter via gray-matter). Maintains `index.md` (TOC with summaries), `overview.md` (generated synopsis), `wikilinks.json` (link graph), and `contradictions.md` (derived from continuity reports). Frontmatter schema enforcement (type, name, status, first_seen, last_updated, sources, tags). Supports `[[wiki/link]]` syntax parsing and cross-reference validation.

- `mention-indexer`: Scans manuscript `chapters/*.md`, change `draft.md`/`revision.md`, and wiki pages for entity mentions. Uses exact wiki entity name matching (from wiki pages) plus declared aliases (from entity frontmatter `aliases` field). Outputs `mentions.json` with entity→appearance map (chapter/file + context snippet). Supports per-entity-type indexing (character, location, faction, object). Generates `context-map.json` for context packer fast lookup.

- `progression-tracker`: Reads continuity-report artifacts and wiki-diffs to extract entity state changes. Tracks: character knowledge additions (per chapter), relationship changes (character pairs + status), location state evolution, faction political shifts, world rule revelations. Outputs `progressions.json` with timeline-ordered events per entity. Integrates with context packer for "what changed since last chapter" awareness.

- `continuity-linter`: Generates structured LLM validation prompts for semantic checks. Checks: character knowledge consistency (does character X know Y at time Z?), timeline consistency (event ordering), POV discipline (no unauthorized POV shifts), foreshadowing integrity (promise made → promise kept), voice consistency (character voice blending detection), world rule compliance (no rule violations without wiki-diff). Outputs validation report JSON for LLM execution; CLI does not invoke LLM directly.

- `wiki-diff-engine`: Parses semantic wiki-diff format (Markdown + JSON). Operation vocabulary: `add_current_state`, `add_knowledge_timeline`, `update_relationship`, `update_thread_status`, `add_evidence`, `flag_contradiction`, `update_field`. Validates operations (target page exists, source cited, operation syntax). Applies operations to wiki pages (reads page, modifies per operation, writes back, updates frontmatter `last_updated`). Supports `--dry-run` (preview changes), `--apply` (execute). Idempotency detection (check `last_updated` before apply).

- `sync-engine`: Orchestration layer. Executes: (1) validate change (mechanical), (2) apply wiki-diff, (3) regenerate mention/progression/wikilink indexes, (4) append log entries for all operations, (5) update wiki page frontmatter `last_updated`. Returns sync report with all changes made.

- `archive-engine`: Moves completed change directory to `changes/archive/`, copies final revision artifact to `manuscript/chapters/ch-XXX.md`, preserves change artifacts for audit trail. Validates archive preconditions (wiki-diff applied, sync completed). Appends archive log entry.

- `host-adapters`: Core command definitions in YAML (stored in CLI source at `src/commands/`). Adapter implementations for: Opencode (slash commands + skills with `SKILL.md`), Cursor (`.cursor/rules/*.mdc`), GitHub Copilot (`.github/copilot-instructions.md`), and generic AGENTS.md. Each adapter renders command definitions (name, description, parameters, steps — CLI invocations, file reads, file writes, status checks) into host-native format. Supports parameter interpolation (`{{change}}`, `{{artifact}}`). Generated on `init` and `update`.

- `project-config`: Config.yaml management (zod-validated schema). Sections: `schema` (active schema name), `project` (title, language, genre, tense, pov), `context` (maxTokens, alwaysInclude, tokenHeuristic), `rules` (per-artifact natural language rules). Config validation on every CLI command. Supports `config get`/`set` subcommands.

- `mechanical-validator`: Deterministic validation of artifact files. Checks: file existence, schema compliance (required frontmatter fields), word count ranges, wiki link validity (`[[...]]` targets exist), chapter sequence continuity. Returns structured `ValidationResult` with per-check pass/fail. Runs on every CLI command for config validation, on-demand for artifact validation.

- `change-manifest`: `.openadab.yaml` file management per change directory. Tracks changeId, schema, version, created timestamp, status (`in_progress` | `synced` | `archived`), per-artifact status (`blocked` | `ready` | `done`), and chapter number. Enforces valid status transitions. Used by artifact-graph for state detection and sync/archive for lifecycle management.

### Modified Capabilities

*(None — this is a greenfield project with no existing specs.)*

## Impact

- **New codebase**: Full TypeScript CLI application at this repository root (`C:\Users\YBY\Desktop\openadab\`). No existing source files to modify — this is a greenfield project.
- **Dependencies**: zod, yaml, commander, ora, chalk, unified, remark-parse, remark-frontmatter, gray-matter, fast-glob, chokidar, vitest, tsx (dev), typescript (dev).
- **File structure**: `src/` directory with 16 core modules as pure libraries, `src/cli/` as thin Commander wrapper, `src/schemas/` as YAML schema definitions, `src/commands/` as core command definitions, `src/adapters/` as host-specific adapters, `src/templates/` as default outputs, `test/` with vitest suites.
- **No external services**: Fully local-first. No API calls, no database, no network. All state lives in filesystem.
- **No breaking changes**: Greenfield — nothing to break.
