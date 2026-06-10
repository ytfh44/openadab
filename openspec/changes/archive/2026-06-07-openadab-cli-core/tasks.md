## 1. Project Setup & Tooling

- [x] 1.1 Initialize npm project with `package.json` (name: `openadab`, bin: `openadab`, type: module)
- [x] 1.2 Create `tsconfig.json` with strict mode, ES2022 target, Node16 module resolution, path aliases (`@/` → `src/`)
- [x] 1.3 Install production dependencies: zod, yaml, commander, ora, chalk, unified, remark-parse, remark-frontmatter, gray-matter, fast-glob, chokidar
- [x] 1.4 Install dev dependencies: typescript, vitest, tsx, @types/node, @types/yaml
- [x] 1.5 Configure vitest with `vitest.config.ts` (include `src/**/*.test.ts`, use tsx transform)
- [x] 1.6 Create `src/index.ts` as CLI entry point exporting main `run()` function
- [x] 1.7 Configure `pnpm` scripts: `dev` (tsx watch), `build` (tsc), `test` (vitest), `test:watch` (vitest watch), `lint` (placeholder)

## 2. Core Data Types & Zod Schemas

- [x] 2.1 Define `src/schemas/types.ts` — foundational TypeScript interfaces: `SchemaDef`, `ArtifactDef`, `ArtifactStatus`, `ChangeManifest`, `WikiPage`, `ContextPack`, `WikiDiffDocument`, `WikiDiffOperation`, `ValidationResult`, `ProjectConfig`, `LogEntry`
- [x] 2.2 Define `src/schemas/project-config.ts` — zod schema for `ProjectConfig` (adab/config.yaml validation) with all fields and defaults from `specs/project-config/spec.md`
- [x] 2.3 Define `src/schemas/schema-def.ts` — zod schema for `SchemaDef` (workflow schema YAML validation) with artifact array, apply section, context interpolation support
- [x] 2.4 Define `src/schemas/change-manifest.ts` — zod schema for `.openadab.yaml` with changeId, schema, version, status, artifacts
- [x] 2.5 Define `src/schemas/wiki-diff.ts` — zod discriminated union for all 7 wiki-diff operation types
- [x] 2.6 Define `src/schemas/context-pack.ts` — zod schema for ContextPack output (mustRead, optionalRead, excluded, reasons)
- [x] 2.7 Define `src/schemas/command-def.ts` — zod schema for core command definitions (used by host-adapters)
- [x] 2.8 Write unit tests for all zod schemas — valid input, invalid input (missing fields, wrong types), edge cases

## 3. Project Config Module (`src/modules/project-config/`)

- [x] 3.1 Implement `ConfigLoader` class — loads `adab/config.yaml` from project root, parses YAML, validates with zod `ProjectConfig` schema, applies defaults
- [x] 3.2 Implement `ConfigLoader.getActiveSchema()` — returns active schema name
- [x] 3.3 Implement `ConfigLoader.getRules(artifactId)` — returns per-artifact rules array
- [x] 3.4 Implement `ConfigLoader.getMaxTokens()` — returns global token budget
- [x] 3.5 Implement `ConfigLoader.getAlwaysInclude()` — returns always-include file list
- [x] 3.6 Implement `ConfigWriter` class — writes validated config back to YAML preserving comments and structure
- [x] 3.7 Implement `ConfigWriter.set(path, value)` — dot-path setter (e.g., `project.title` → updates nested field)
- [x] 3.8 Implement context variable resolution — `resolveVariable("{{config.project.pov}}", config)` → config value
- [x] 3.9 Write unit tests: load valid config, load invalid config (throws), defaults applied, dot-path get/set, variable resolution

## 4. Project Init Module (`src/modules/project-init/`)

- [x] 4.1 Implement `ProjectInitializer` class — takes target directory path
- [x] 4.2 Implement directory scaffolding — creates all `adab/` subdirectories (manuscript, wiki, raw, changes, schemas, index) with empty `.gitkeep` files where needed
- [x] 4.3 Implement default wiki template generation — creates `adab/wiki/index.md`, `overview.md`, `contradictions.md` with placeholder content and frontmatter
- [x] 4.4 Implement default config generation — writes `adab/config.yaml` with sensible defaults
- [x] 4.5 Implement built-in schema copying — copies `chapter-draft/`, `chapter-revision/`, `wiki-ingest/` from CLI source (`src/schemas/built-in/`) to project `adab/schemas/`
- [x] 4.6 Implement `.gitignore` creation — adds `adab/index/*.json` to project `.gitignore`
- [x] 4.7 Implement `log.md` initialization — creates with initial `init` log entry
- [x] 4.8 Implement empty index JSON creation — creates `mentions.json`, `wikilinks.json`, `progressions.json`, `context-map.json` with empty structures
- [x] 4.9 Implement re-init detection — throws error if `adab/` already exists, suggests `openadab update`
- [x] 4.10 Implement host adapter generation during init — after directory scaffolding, invokes the host-adapters module to generate host-specific command files based on detected environment
- [x] 4.11 Write unit tests: fresh init creates all directories, re-init throws, schema copying includes all files, host adapters generated for detected host

## 5. Schema Engine (`src/modules/schema-engine/`)

- [x] 5.1 Implement `SchemaLoader` class — loads YAML from schema directory path, validates with `SchemaDef` zod schema
- [x] 5.2 Implement cycle detection — traverses artifact `requires` graph using DFS, detects back-edges (cycles)
- [x] 5.3 Implement template resolution — resolves relative `template` paths to absolute filesystem paths, validates existence
- [x] 5.4 Implement variable interpolation — replaces `{{variable}}` patterns in schema fields using provided context object
- [x] 5.5 Implement config variable interpolation — resolves `{{config.*}}` patterns against project config
- [x] 5.6 Implement built-in schema enumeration — `listBuiltInSchemas()` returns available schemas from `src/schemas/built-in/`
- [x] 5.7 Implement schema forking — `forkSchema(baseName, newName)` copies schema + templates to project schemas dir, adds `forked_from` metadata
- [x] 5.8 Implement `SchemaValidator` — validates: required fields, artifact ID uniqueness, `apply.requires` referencing valid artifact IDs, template file existence
- [x] 5.9 Write unit tests: load valid schema, cycle detection (3-node cycle), missing template, duplicate IDs, variable interpolation, fork copies all files

## 6. Artifact Graph (`src/modules/artifact-graph/`)

- [x] 6.1 Implement `ArtifactGraph` class — constructor takes `SchemaDef`, builds DAG nodes and edges
- [x] 6.2 Implement topological sort — Kahn's algorithm for linear ordering of artifacts
- [x] 6.3 Implement `getStatus(changeDir)` — for each artifact, checks: file exists → done (if valid), file missing + deps done → ready, file missing + deps not done → blocked
- [x] 6.4 Implement `getReadyArtifacts(changeDir)` — returns array of artifact IDs that are ready for work
- [x] 6.5 Implement `getNextStep(changeDir)` — returns suggested next action(s): write artifact or apply change
- [x] 6.6 Implement `getBlockingIssues(changeDir)` — returns reasons why artifacts are blocked (which dependencies are missing)
- [x] 6.7 Implement mechanical validation integration — when checking if artifact is `done`, also runs mechanical validation (file content non-empty, frontmatter present, word count in range)
- [x] 6.8 Implement JSON status output — formats full status object per design spec (changeName, schemaName, artifacts[], nextStep, blockingIssues)
- [x] 6.9 Write unit tests: linear chain states (all blocked → one ready → done → next ready), parallel artifacts, validation failure sets status to ready, JSON output format

## 7. Wiki Engine (`src/modules/wiki-engine/`)

- [x] 7.1 Implement `WikiEngine` class — constructor takes project root path
- [x] 7.2 Implement `readPage(path)` — reads wiki Markdown file, parses frontmatter with gray-matter, validates frontmatter with zod schema per type
- [x] 7.3 Implement `writePage(path, frontmatter, body)` — writes wiki page with YAML frontmatter + body, auto-updates `last_updated`, validates frontmatter
- [x] 7.4 Implement `listPages(type?)` — lists all wiki pages, optionally filtered by type (character/location/faction/etc.), using fast-glob
- [x] 7.5 Implement `deletePage(path)` — deletes wiki page file
- [x] 7.6 Implement `generateIndex()` — generates `adab/wiki/index.md` with TOC grouped by type, each entry as `[[type/name]]` link with summary
- [x] 7.7 Implement `generateOverview()` — generates `adab/wiki/overview.md` synopsis from wiki pages (setting, characters, conflict, current state)
- [x] 7.8 Implement `generateWikilinks()` — scans all wiki pages for `[[...]]` syntax, builds link graph (`wikilinks.json`) with forward links and backlinks, flags broken links
- [x] 7.9 Implement `updateContradictions(diff)` — appends contradiction entries to `contradictions.md` from wiki-diff operations
- [x] 7.10 Implement frontmatter validation per type — character requires name/status, location requires name/type, thread requires status
- [x] 7.11 Write unit tests: read page with frontmatter, write page updates last_updated, list by type, wikilinks extraction, broken link detection, index generation

## 8. Mention Indexer (`src/modules/mention-indexer/`)

- [x] 8.1 Implement `MentionIndexer` class — constructor takes project root, wiki engine reference
- [x] 8.2 Implement entity name extraction from wiki — loads all wiki pages, extracts `name` and `aliases` from frontmatter, builds entity registry
- [x] 8.3 Implement regex pattern building — for each entity, builds word-boundary regex from name + all aliases, handles special characters escaping
- [x] 8.4 Implement file scanning — scans target files (chapters, drafts, wiki pages) line-by-line with compiled regex patterns
- [x] 8.5 Implement context extraction — for each match, captures 50 chars before + 50 chars after (or to paragraph boundary)
- [x] 8.6 Implement `generateMentionsJson()` — generates `adab/index/mentions.json`: entity → { type, aliases, appearances: [{ file, line, context }] }
- [x] 8.7 Implement `generateContextMap()` — generates `adab/index/context-map.json`: file → [entity names] (inverse index for context packer)
- [x] 8.8 Implement incremental indexing — only re-scans files modified since last index (check file mtime vs index timestamp)
- [x] 8.9 Implement `indexAll()` — full re-index: clears all index data, scans all manuscript + wiki + draft files
- [x] 8.10 Write unit tests: exact name match, alias match, word-boundary enforcement, multi-entity per file, incremental update, context-map inversion

## 9. Progression Tracker (`src/modules/progression-tracker/`)

- [x] 9.1 Implement `ProgressionTracker` class — constructor takes project root path
- [x] 9.2 Implement continuity-report parsing — reads continuity-report Markdown, extracts entity changes (character knowledge, relationships, thread status, location state)
- [x] 9.3 Implement wiki-diff parsing — reads wiki-diff, extracts progression-relevant operations (knowledge timeline adds, thread status updates, relationship changes)
- [x] 9.4 Implement event recording — formats progression events: `{ chapter, entity, type, change, timestamp }`
- [x] 9.5 Implement `generateProgressionsJson()` — generates `adab/index/progressions.json`: chapter-ordered array of events
- [x] 9.6 Implement entity-centric query — `getProgression(entity)` filters events for a specific entity across all chapters
- [x] 9.7 Implement contradiction detection — compares new events against existing progression events, flags contradictory state changes
- [x] 9.8 Implement incremental updates — appends new events to existing `progressions.json`, updates modified chapters
- [x] 9.9 Write unit tests: parse continuity-report, parse wiki-diff knowledge entry, thread status change detection, contradiction flagging, entity query

## 10. Context Packer (`src/modules/context-packer/`)

- [x] 10.1 Implement `ContextPacker` class — constructor takes project root, wiki engine, mention indexer, progression tracker, project config
- [x] 10.2 Implement candidate building — builds candidate file list with priority scores per design algorithm: alwaysInclude (100) → artifact deps (90) → entity-linked wiki pages (80) → active threads (70) → POV characters (60) → adjacent chapter (50) → related entities (40)
- [x] 10.3 Implement entity linking from scene-plan — reads scene-plan.md, uses mention indexer context-map to identify entities, links to wiki pages
- [x] 10.4 Implement thread awareness from continuity-report — reads continuity-report.md for active thread references, links to thread wiki pages
- [x] 10.5 Implement POV character detection — extracts POV character from scene-plan/brief frontmatter, includes their wiki page
- [x] 10.6 Implement token estimation — heuristic: chars / 1.5 (Chinese) or chars / 4 (English) based on config `project.language`
- [x] 10.7 Implement greedy packing — sorts candidates by priority desc, packs into mustRead until budget exhausted, remainder to optionalRead (<60) or excluded
- [x] 10.8 Implement `packContext(changeDir, artifactId)` — main entry point returning `ContextPack` object (mustRead, optionalRead, excluded, reasons)
- [x] 10.9 Implement per-artifact budget — uses schema artifact's `contextBudget` if defined, else global `maxTokens`
- [x] 10.10 Implement deduplication — ensures same file not listed twice across different priority categories
- [x] 10.11 Write unit tests: always-include in mustRead, entity-linked pages, budget exceeded drops low-priority, per-artifact budget, Chinese vs English token estimation

## 11. Instruction Loader (`src/modules/instruction-loader/`)

- [x] 11.1 Implement `InstructionLoader` class — constructor takes schema engine, project config, context packer, change directory
- [x] 11.2 Implement template loading — reads schema artifact's template file, resolves variable interpolation
- [x] 11.3 Implement rules injection — loads per-artifact rules from config, includes in instruction output
- [x] 11.4 Implement dependency content loading — when `--inline-deps` flag, reads content of all dependency artifacts and includes in instruction
- [x] 11.5 Implement context pack integration — includes context pack reference (file list with reasons) in instruction output
- [x] 11.6 Implement `loadInstructions(artifactId)` — main entry point returning `InstructionPayload` with: instruction, template, outputPath, rules, requiredReads, contextPack, dependencyContent (if inlined)
- [x] 11.7 Implement JSON serialization — formats instruction payload as JSON for CLI `--json` output
- [x] 11.8 Implement missing dependency handling — warns if dependency file missing but still returns payload (allows forward planning)
- [x] 11.9 Write unit tests: basic instruction assembly, template with variables, rules injection, dependency content (inline vs reference), JSON output format, missing dep warning

## 12. Wiki Diff Engine (`src/modules/wiki-diff-engine/`)

- [x] 12.1 Implement `WikiDiffParser` class — parses wiki-diff Markdown format into structured operations
- [x] 12.2 Implement Markdown parser — uses unified + remark-parse to parse wiki-diff sections, extracts operation type from headings and content
- [x] 12.3 Implement operation validation — validates: target wiki page exists, source citation present, operation syntax correct, no duplicate operations
- [x] 12.4 Implement `WikiDiffApplier` class — applies parsed operations to wiki pages
- [x] 12.5 Implement `apply_add_current_state` — locates "## Current State" section, appends entry, updates `last_updated`
- [x] 12.6 Implement `apply_add_knowledge_timeline` — appends row to knowledge timeline table
- [x] 12.7 Implement `apply_update_relationship` — updates relationships section with new relationship entry
- [x] 12.8 Implement `apply_update_thread_status` — updates thread page status field and evidence list
- [x] 12.9 Implement `apply_flag_contradiction` — appends contradiction entry to `contradictions.md`
- [x] 12.10 Implement `apply_update_field` — updates frontmatter field value
- [x] 12.11 Implement dry-run mode — parses + validates all operations, outputs summary of what WOULD change, does not write files
- [x] 12.12 Implement apply mode — executes all validated operations, outputs summary of changes, writes files
- [x] 12.13 Implement idempotency detection — checks target page `last_updated` before apply, warns if stale
- [x] 12.14 Write unit tests: parse each operation type, validation (missing source, non-existent target), dry-run output, apply writes correctly, idempotency warning

## 13. Sync Engine (`src/modules/sync-engine/`)

- [x] 13.1 Implement `SyncEngine` class — constructor takes project root, wiki-diff engine, wiki engine, mention indexer, progression tracker, context packer
- [x] 13.2 Implement `sync(changeDir)` — orchestrates full sync workflow: validate → apply wiki-diff → regenerate mentions → regenerate wikilinks → regenerate progressions → regenerate context-map → update wiki index → append log → update change manifest
- [x] 13.3 Implement pre-sync validation — runs mechanical validation before any writes, aborts if errors
- [x] 13.4 Implement skip-empty-diff handling — if wiki-diff is empty (no operations), skips apply step but still regenerates indexes
- [x] 13.5 Implement log entry generation — creates structured log entry describing all sync operations
- [x] 13.6 Implement change manifest update — updates `.openadab.yaml` status to "synced" after successful sync
- [x] 13.7 Implement sync report — returns structured report: changeId, wikiPagesModified, contradictionsFlagged, indexesRegenerated, logEntry
- [x] 13.8 Write unit tests: full sync workflow (mocked components), validation failure aborts, empty diff skips apply, sync report content

## 14. Archive Engine (`src/modules/archive-engine/`)

- [x] 14.1 Implement `ArchiveEngine` class — constructor takes project root
- [x] 14.2 Implement `archive(changeDir)` — verifies change is synced, copies revision to manuscript, moves change to archive, updates manifest, appends log
- [x] 14.3 Implement pre-archive validation — verifies change status is "synced" (not "in_progress"), aborts if not
- [x] 14.4 Implement manuscript chapter copy — copies revision artifact to `manuscript/chapters/ch-XXX.md`, handles existing chapter (overwrite with optional backup)
- [x] 14.5 Implement change directory move — moves `adab/changes/<change>/` to `adab/changes/archive/<change>/`
- [x] 14.6 Implement backup on overwrite — when `config.archive.backupOnOverwrite: true`, creates `.bak.<timestamp>` before overwriting
- [x] 14.7 Implement log entry — appends archive log entry with chapter and timestamp
- [x] 14.8 Write unit tests: archive synced change, reject unsynced change, chapter overwrite with backup, non-existent change error

## 15. Continuity Linter (`src/modules/continuity-linter/`)

- [x] 15.1 Implement `ContinuityLinter` class — constructor takes project config, wiki engine
- [x] 15.2 Implement validate prompt generation framework — base class that builds structured LLM prompts with context, rules, and expected output format
- [x] 15.3 Implement character knowledge consistency prompt — includes character knowledge timeline, manuscript chapter, instruction text
- [x] 15.4 Implement timeline contradiction prompt — includes absolute timeline, narrative order, manuscript chapter
- [x] 15.5 Implement POV discipline prompt — includes declared POV, manuscript chapter, detection rules
- [x] 15.6 Implement foreshadowing integrity prompt — includes active promises from threads, manuscript chapter
- [x] 15.7 Implement voice blending check prompt — includes character voice examples from wiki style, dialogue sections
- [x] 15.8 Implement world rule compliance prompt — includes world rules from wiki, manuscript chapter
- [x] 15.9 Implement per-artifact validation profiles — draft: POV + voice + world rules; revision: all checks; wiki-diff: source + contradiction completeness
- [x] 15.10 Implement `generateValidationPrompt(changeDir, artifactId)` — main entry point, returns full validation prompt string + expected JSON output schema
- [x] 15.11 Write unit tests: each check type produces valid prompt structure, per-artifact profiles select correct checks, rules from config appear in prompt

## 16. Host Adapters (`src/modules/host-adapters/`)

- [x] 16.1 Implement `CommandDefLoader` — loads core command definitions from `src/commands/*.yaml`
- [x] 16.2 Implement `AdapterBase` abstract class — defines `generate(files: CommandDef[]): GeneratedFile[]` interface
- [x] 16.3 Implement `OpencodeAdapter` — generates `.agents/skills/adab-<name>/SKILL.md` files with slash command definitions, step-by-step CLI invocation instructions, parameter documentation
- [x] 16.4 Implement `CursorAdapter` — generates `.cursor/rules/adab.mdc` with `@` command references
- [x] 16.5 Implement `CopilotAdapter` — generates `.github/copilot-instructions.md` with all OpenAdab commands documented
- [x] 16.6 Implement `GenericAdapter` — generates `AGENTS.md` with complete workflow documentation
- [x] 16.7 Implement `MonolithicPromptAdapter` — for non-tool-use hosts, generates single comprehensive prompt with all context inlined (budget-limited)
- [x] 16.8 Implement host detection — checks environment markers (`.opencode/`, `.cursor/`, `.github/`, etc.) to auto-detect host
- [x] 16.9 Implement content hash comparison — for `update` command, computes hash of previously generated files, compares with would-be output, and only overwrites unchanged files (preserves user modifications)
- [x] 16.10 Implement parameter interpolation in generated files — replaces `{{change}}`, `{{artifact}}` with usage placeholders for the AI
- [x] 16.11 Write unit tests: Opencode generates valid SKILL.md, Cursor generates `.mdc` format, parameter interpolation, host detection, content hash preserves user edits

## 17. Built-in Schemas & Templates

- [x] 17.1 Create `src/schemas/built-in/chapter-draft/schema.yaml` — full YAML schema with all 6 artifacts (brief, scene-plan, draft, revision, continuity-report, wiki-diff), each with instruction text, contextBudget, and validation rules
- [x] 17.2 Create `src/schemas/built-in/chapter-draft/templates/` — Markdown templates for brief.md, scene-plan.md, draft.md, revision.md, continuity-report.md, wiki-diff.md
- [x] 17.3 Create `src/schemas/built-in/chapter-revision/schema.yaml` — revision workflow: revision-brief → revision-plan → revision → continuity-report → wiki-diff, with apply targeting existing chapter
- [x] 17.4 Create `src/schemas/built-in/chapter-revision/templates/` — corresponding Markdown templates
- [x] 17.5 Create `src/schemas/built-in/wiki-ingest/schema.yaml` — lightweight schema: extract → wiki-diff, no apply target (wiki-diff applied via `wiki apply-diff`)
- [x] 17.6 Create `src/schemas/built-in/wiki-ingest/templates/` — templates for wiki-diff from raw sources
- [x] 17.7 Create `src/schemas/built-in/character-development/schema.yaml` — placeholder schema for future character arc tracking
- [x] 17.8 Create `src/schemas/built-in/worldbuilding/schema.yaml` — placeholder schema for future worldbuilding workflow
- [x] 17.9 Create `src/schemas/built-in/series-planning/schema.yaml` — placeholder schema for future series outline workflow
- [x] 17.10 Validate all built-in schemas against `SchemaDef` zod schema (unit test)

## 18. Core Command Definitions (`src/commands/`)

- [x] 18.1 Create `src/commands/explore.yaml` — `/adab:explore` definition: explore story state, wiki, manuscript
- [x] 18.2 Create `src/commands/new.yaml` — `/adab:new` definition: create new chapter change
- [x] 18.3 Create `src/commands/continue.yaml` — `/adab:continue` definition: detect current change, next artifact, run appropriate workflow
- [x] 18.4 Create `src/commands/plan.yaml` — `/adab:plan` definition: check status, generate instructions for next artifact
- [x] 18.5 Create `src/commands/draft.yaml` — `/adab:draft` definition: context pack → instructions → write → validate flow
- [x] 18.6 Create `src/commands/revise.yaml` — `/adab:revise` definition: instructions → write revision → validate
- [x] 18.7 Create `src/commands/lint.yaml` — `/adab:lint` definition: run semantic validation, report issues
- [x] 18.8 Create `src/commands/extract-wiki.yaml` — `/adab:extract-wiki` definition: generate wiki-diff from continuity-report
- [x] 18.9 Create `src/commands/sync-wiki.yaml` — `/adab:sync-wiki` definition: apply wiki-diff, sync indexes
- [x] 18.10 Create `src/commands/archive.yaml` — `/adab:archive` definition: sync + archive change
- [x] 18.11 Validate all command definitions against `CommandDef` zod schema (unit test)

## 19. CLI Wrapper (`src/cli/`)

- [x] 19.1 Implement `src/cli/index.ts` — Commander program setup with `openadab` root command, version flag
- [x] 19.2 Implement `init` command — parses `--schema`, `--host` flags, instantiates `ProjectInitializer`, runs init
- [x] 19.3 Implement `update` command — parses `--schemas` flag, runs host adapter regeneration + schema refresh
- [x] 19.4 Implement `schema` subcommands — `list`, `validate <path>`, `fork <base> <name>`, `show <name>`
- [x] 19.5 Implement `new` command — `new chapter <id>`, creates change directory with `.openadab.yaml` manifest
- [x] 19.6 Implement `status` command — `status --change <id> [--json]`, outputs artifact graph status
- [x] 19.7 Implement `instructions` command — `instructions <artifact> --change <id> [--json] [--inline-deps]`, outputs instruction payload
- [x] 19.8 Implement `context` command — `context pack --change <id> --artifact <id> [--json]`, outputs context pack
- [x] 19.9 Implement `validate` command — `validate --change <id> [--mechanical] [--semantic]`, runs validators
- [x] 19.10 Implement `wiki` subcommands — `index` (regenerate `adab/wiki/index.md` TOC), `lint` (validate wiki page structure), `diff --change <id>` (parse + preview wiki-diff), `diff --from <manuscript-path>` (generate wiki-diff from manuscript), `apply-diff <path> [--dry-run] [--apply] [--change <id>]` (apply semantic wiki-diff operations). Note: mention index regeneration is triggered by `sync` or via internal `indexAll()`, NOT by `wiki index`.
- [x] 19.11 Implement `sync` command — `sync --change <id>`, orchestrates full sync
- [x] 19.12 Implement `archive` command — `archive <change-id>`, archives completed change
- [x] 19.13 Implement `config` subcommands — `get <path>`, `set <path> <value>`
- [x] 19.14 Implement `log` command — `log [--limit N] [--change <id>]`, displays log.md entries
- [x] 19.15 Implement JSON output helper — consistent `--json` flag across all commands, formatted with indentation
- [x] 19.16 Implement error handling — consistent error codes, JSON error output for AI consumption, human-readable for terminal
- [x] 19.17 Implement spinner/progress — ora integration for long-running operations (sync, index, archive)
- [x] 19.18 Implement color output — chalk integration for warnings (yellow), errors (red), success (green), info (blue)

## 20. Change Manifest Management

- [x] 20.1 Implement `ManifestManager` class — reads/writes `.openadab.yaml` change manifests
- [x] 20.2 Implement manifest creation — `new chapter ch-012` creates manifest with changeId, schema (from config), timestamp, initial artifact statuses (all blocked, first ready)
- [x] 20.3 Implement manifest update — after artifact write, updates artifact status in manifest
- [x] 20.4 Implement manifest status transitions — enforces valid state transitions (in_progress → synced → archived)
- [x] 20.5 Write unit tests: manifest creation, status updates, invalid transition rejection

## 21. Log System (`src/modules/log/`)

- [x] 21.1 Implement `LogWriter` class — appends structured log entries to `adab/log.md`
- [x] 21.2 Implement Markdown + JSON comment hybrid format — human-readable Markdown line + machine-parseable JSON comment
- [x] 21.3 Implement `LogReader` class — reads and parses log entries with filtering (by change, operation, date range)
- [x] 21.4 Implement log entry types — init, new, write, validate, sync, archive, update, error
- [x] 21.5 Write unit tests: append entry, read with filter, parse JSON comment, date range query

## 22. Mechanical Validator (`src/modules/mechanical-validator/`)

- [x] 22.1 Implement `MechanicalValidator` class — constructor takes schema engine, project config
- [x] 22.2 Implement per-artifact validation functions — fileExists, schemaCompliance, frontmatterPresent, wordCount, wikiLinkValidity, chapterSequence
- [x] 22.3 Implement `validateArtifact(changeDir, artifactId)` — runs all applicable mechanical checks, returns `ValidationResult`
- [x] 22.4 Implement `validateChange(changeDir)` — runs validation on all artifacts in change, returns aggregated results
- [x] 22.5 Implement wiki link validation — parses `[[...]]` links in wiki-diff, verifies target pages exist via wiki engine
- [x] 22.6 Implement chapter sequence validation — checks `manuscript/chapters/` for consecutive numbering (ch-001, ch-002, ...)
- [x] 22.7 Implement config file validation — validates `adab/config.yaml` on every CLI command startup
- [x] 22.8 Write unit tests: valid artifact passes, missing file fails, word count out of range, broken wiki link, non-consecutive chapters

## 23. Filesystem Utilities (`src/utils/`)

- [x] 23.1 Create `src/utils/fs.ts` — safe file read/write with error handling, atomic writes (write to temp → rename)
- [x] 23.2 Create `src/utils/path.ts` — path resolution utilities: resolve from project root, resolve schema template, resolve change artifact
- [x] 23.3 Create `src/utils/token-counter.ts` — token estimation: chars/4 (English), chars/1.5 (Chinese), configurable
- [x] 23.4 Create `src/utils/markdown.ts` — Markdown parsing helpers: extract frontmatter (gray-matter), extract `[[links]]`, extract sections by heading
- [x] 23.5 Create `src/utils/errors.ts` — custom error classes: `AdabError` base, `ConfigValidationError`, `SchemaValidationError`, `CycleDetectedError`, `WikiDiffParseError`, `TargetNotFoundError`, `ChangeStatusError`
- [x] 23.6 Write unit tests for each utility

## 24. Integration Tests

- [x] 24.1 Create test fixture: minimal project with `adab/` directory, test config, test wiki pages, test manuscript chapter
- [x] 24.2 Integration test: full `chapter-draft` workflow — init → new chapter → write brief → status → write scene-plan → ... → archive (mock file operations)
- [x] 24.3 Integration test: context packer with real wiki pages — creates wiki entities, writes scene-plan with mentions, verifies context pack includes correct wiki pages
- [x] 24.4 Integration test: wiki-diff round-trip — parse Markdown → apply → verify wiki pages updated → verify no data loss
- [x] 24.5 Integration test: mention indexer with real manuscript — writes chapter with entity mentions, runs indexer, verifies mentions.json
- [x] 24.6 Integration test: sync → archive pipeline — full change completion, verifies manuscript updated, change archived, log entries complete
- [x] 24.7 Integration test: CLI commands end-to-end — spawns CLI process, runs commands, checks exit codes and JSON output

## 25. Documentation & Polish

- [x] 25.1 Create `README.md` — project overview, installation, quick start, command reference, architecture diagram
- [x] 25.2 Create `CONTRIBUTING.md` — development setup, code style, PR process, testing
- [x] 25.3 Add `--help` text for every CLI command and subcommand with examples
- [x] 25.4 Add colored CLI output — spinner during sync/index, color-coded validation results, progress indicators
- [x] 25.5 Verify all commands return consistent exit codes (0 = success, 1 = error, 2 = usage error)
- [x] 25.6 Verify all `--json` outputs are valid JSON with consistent field naming
