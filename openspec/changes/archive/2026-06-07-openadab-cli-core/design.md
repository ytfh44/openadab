## Context

OpenAdab CLI is a greenfield TypeScript project that implements a local-first, host-neutral fiction workflow engine. It provides a command-line interface for managing long-form fiction creation with LLMs, organized around schema-defined artifact workflows, an LLM-maintained story wiki, and reviewable canon synchronization.

The design is informed by three proven patterns:
1. **OpenSpec/OPSX schema-driven workflows** — artifacts as DAG nodes with file-existence state detection and rich instruction generation
2. **Karpathy's LLM Wiki** — three-layer knowledge structure (raw sources → wiki → schema) with ingest/lint/index operations
3. **Novelcrafter Codex** — automatic mention tracking, aliases, progressions, and custom metadata for story entities

The target user is a fiction writer using any LLM host (Claude/Opencode, ChatGPT, Cursor, Gemini, Kimi) who needs systematic continuity management across long-form projects.

## Goals / Non-Goals

**Goals:**
- Provide a complete CLI for `init → new chapter → status → instructions → context pack → draft → revise → continuity-report → wiki-diff → sync → archive`
- 16 pure library modules decoupled from CLI for testability and reuse
- Full YAML schema engine with DAG state detection, template resolution, and schema forking
- Token-budget-aware context packer with auditable file selection reasons
- Semantic wiki-diff format with human-reviewable canon sync (dry-run, review, apply modes)
- Host-neutral prompt adapter generation (Opencode skills, Cursor rules, Copilot instructions, AGENTS.md)
- Two-tier validation: mechanical (CLI deterministic) and semantic (LLM prompt generation)
- Full test coverage via vitest

**Non-Goals:**
- GUI or web interface
- Cloud sync / SaaS features / multi-user collaboration
- Automatic LLM invocation (CLI generates instructions for AI, never calls LLM APIs)
- Vector search or BM25 retrieval (optional retrieval layer deferred)
- TUI-based interactive `--review` for wiki-diff (MVP uses `--dry-run` + `--apply`)
- Series planning, character development, worldbuilding schemas beyond their YAML definitions
- Non-chapter writing workflows (poetry, screenplays, game scripts)
- Real-time collaboration or git integration (user manages git separately)

## Decisions

### 1. Module Architecture: Pure Libraries + Thin CLI

**Decision**: All 16 modules are pure TypeScript libraries with zero CLI dependencies. The CLI is a thin Commander wrapper that parses args, loads config, instantiates modules, and formats output.

**Rationale**: Testability (unit test each module independently), reusability (future VS Code extension or web UI can reuse all modules), and separation of concerns (CLI is an I/O concern, modules are domain logic).

**Alternatives considered**:
- **Monolithic CLI with inlined logic**: Simpler to start but untestable and unreusable. Rejected.
- **Each module as separate npm package**: Overkill for MVP. Internal packages via workspace monorepo if needed later.

**Module dependency graph**:
```
project-init
  │
  ▼
project-config ◀────────────────────────────────────────┐
  │                                                      │
  ▼                                                      │
schema-engine ◀── built-in schemas (src/schemas/)         │
  │                                                      │
  ├──▶ artifact-graph ◀── .openadab.yaml                  │
  │        │                                              │
  │        ▼                                              │
  ├──▶ instruction-loader                                 │
  │        │                                              │
  │        ├──▶ context-packer                             │
  │        │        │                                      │
  │        │        ├──▶ wiki-engine                       │
  │        │        │        │                              │
  │        │        │        ├──▶ mention-indexer           │
  │        │        │        │                                │
  │        │        │        └──▶ progression-tracker        │
  │        │        │                                         │
  │        │        └──▶ wiki-diff-engine                    │
  │        │                                                   │
  │        └──▶ (uses instruction from context-packer output)  │
  │                                                             │
  ├──▶ wiki-engine (standalone read/write/index)                │
  │        │                                                     │
  │        ├──▶ mention-indexer                                  │
  │        │        │                                            │
  │        │        └──▶ (uses wiki-engine for entity lookup)    │
  │        │                                                     │
  │        └──▶ progression-tracker                              │
  │                 │                                            │
  │                 └──▶ (reads continuity-reports, wiki-diffs)  │
  │                                                              │
  ├──▶ continuity-linter (LLM prompt generation)                 │
  │                                                              │
  ├──▶ wiki-diff-engine (parse, validate, apply operations)      │
  │                                                              │
  ├──▶ sync-engine (orchestrates apply-diff + index + log)       │
  │                                                              │
  ├──▶ archive-engine (file move + audit)                        │
  │                                                              │
  ├──▶ mechanical-validator (file checks, word count, links)     │
  │                                                              │
  ├──▶ change-manifest (.openadab.yaml read/write/state)         │
  │                                                              │
  └──▶ host-adapters ◀── core command definitions (src/commands/)│
           │                                                     │
           └─────────────────────────────────────────────────────┘
```

### 2. State Model: File-Existence + Schema Validation

**Decision**: Artifact state is determined by file existence (blocked/ready/done transition) plus mechanical validation (done requires passing validation). The `.openadab.yaml` change manifest caches computed state and metadata.

**Rationale**: OPSX model is proven, simple, and deterministic. File existence is universally queryable without a database. Cached state in manifest prevents repeated validation.

**State machine per change**:
```
CREATED (directory exists, .openadab.yaml present)
    │
    ▼
BRIEF_READY → brief.md written + valid → SCENE_PLAN_READY → ... → WIKI_DIFF_READY
    │                                                                     │
    └──────────────────── (delete artifact to reset) ◀────────────────────┘
                                                                          │
                                                                          ▼
                                                              SYNCED → ARCHIVED
```

**`.openadab.yaml` schema** (zod):
```typescript
const ChangeManifest = z.object({
  changeId: z.string(),
  schema: z.string(),
  version: z.number(),
  created: z.string(),
  status: z.enum(["in_progress", "synced", "archived"]),
  currentArtifact: z.string().optional(),
  artifacts: z.record(z.enum(["blocked", "ready", "done"])),
  chapter: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
```

### 3. Schema Format: Extended OPSX with Context Budgets and Validation

**Decision**: YAML schemas extend the OPSX artifact model with `instructionFile`, `contextBudget`, `validation` (mechanical + semantic), and variable interpolation (`{{variable}}` syntax).

**Schema YAML** (zod-validated):
```typescript
const SchemaDef = z.object({
  name: z.string(),
  version: z.number(),
  description: z.string().optional(),
  context: z.record(z.string()).optional(),
  artifacts: z.array(z.object({
    id: z.string(),
    generates: z.string(),
    requires: z.array(z.string()),
    template: z.string().optional(),
    instruction: z.string().optional(),
    instructionFile: z.string().optional(),
    contextBudget: z.number().optional(),
    validation: z.object({
      mechanical: z.array(z.string()).optional(),
      semantic: z.array(z.string()).optional(),
    }).optional(),
  })),
  apply: z.object({
    requires: z.array(z.string()),
    target: z.string(),
    action: z.enum(["copy", "move"]).default("copy"),
  }).optional(),
});
```

### 4. Wiki-Diff Format: Semantic Operations (JSON + Markdown)

**Decision**: Wiki updates are expressed as *semantic operations* (not line diffs). Two representations: Markdown (human-readable, LLM-generated) and JSON (machine-parseable, CLI-applied). The CLI parses Markdown → JSON for application.

**Operation vocabulary** (JSON schema):
```typescript
const WikiDiffOperation = z.discriminatedUnion("type", [
  z.object({ type: z.literal("add_current_state"), target: z.string(), source: z.string(), content: z.string() }),
  z.object({ type: z.literal("add_knowledge_timeline"), target: z.string(), source: z.string(), chapter: z.string(), knowledge: z.string() }),
  z.object({ type: z.literal("update_relationship"), target: z.string(), source: z.string(), relatedEntity: z.string(), relationship: z.string() }),
  z.object({ type: z.literal("update_thread_status"), target: z.string(), source: z.string(), status: z.enum(["open", "advanced", "resolved"]), evidence: z.array(z.string()).optional() }),
  z.object({ type: z.literal("add_evidence"), target: z.string(), source: z.string(), evidence: z.string() }),
  z.object({ type: z.literal("flag_contradiction"), target: z.string(), source: z.string(), description: z.string(), sources: z.array(z.object({ page: z.string(), claim: z.string() })), status: z.enum(["unresolved", "explained", "retconned"]) }),
  z.object({ type: z.literal("update_field"), target: z.string(), field: z.string(), value: z.unknown() }),
]);
```

**Markdown format** (LLM output):
```markdown
# Wiki Diff: draft-ch-012

## Proposed Character Updates
### [[characters/mara]]
Source: manuscript/chapters/ch-012.md

Add to Current State:
- Mara knows the east gate was opened from inside.
```

The CLI's `wiki-diff-engine` parses this Markdown structure into JSON operations for application.

### 5. Context Packer Algorithm: Greedy Priority

**Decision**: Deterministic greedy algorithm based on priority scores. No ML/LLM involvement for MVP — pure rule-based with entity linking via mention index.

**Algorithm** (pseudocode):
```
function packContext(params):
  budget = artifactDef.contextBudget || config.context.maxTokens
  candidates = []

  // Priority 100: config.alwaysInclude
  candidates += config.alwaysInclude with reason "config.alwaysInclude"

  // Priority 90: artifact schema dependencies
  candidates += artifactDef.requires files with reason "artifact dependency"

  // Priority 80: scene-plan entities → wiki pages (mention index)
  candidates += wikiPagesForEntities(scenePlanEntities) with reason "entity: <name>"

  // Priority 70: active threads (from continuity-report or wiki)
  candidates += wikiPagesForActiveThreads() with reason "thread: <name>"

  // Priority 60: POV character wiki page
  candidates += wikiPagesForPOVCharacters() with reason "POV character"

  // Priority 50: adjacent chapter (previous)
  candidates += previousChapter with reason "previous chapter"

  // Priority 40: related factions/locations from entity graph
  candidates += relatedEntityPages() with reason "related entity"

  // Greedy pack
  sort candidates by priority desc
  currentTokens = 0
  mustRead = []; optionalRead = []; excluded = []

  for each candidate:
    estimatedTokens = estimateTokens(candidate.path)
    if currentTokens + estimatedTokens <= budget:
      mustRead.push(candidate)
      currentTokens += estimatedTokens
    else if candidate.priority >= 60:
      optionalRead.push(candidate)
    else:
      excluded.push(candidate)

  return { mustRead, optionalRead, excluded, reasons }
```

### 6. Token Estimation: Heuristic for MVP

**Decision**: Use heuristic estimation (chars / 4 for English, chars / 1.5 for Chinese) based on project config `language` field. Not tiktoken.

**Rationale**: Heuristic is fast, zero-dependency, and accurate enough (±20%) for budget management. Precise tokenization (tiktoken) is a v2 optimization.

### 7. Mention Indexer: Exact Entity Name + Aliases

**Decision**: Regex-based mention extraction using exact wiki entity names and declared aliases (from frontmatter). No NLP/ML.

**Algorithm**:
1. Load all wiki entities (characters, locations, factions, objects) with their names + aliases
2. Build regex pattern from entity names/aliases (word-boundary delimited)
3. Scan target files line-by-line for matches
4. Output `mentions.json`: `{ entityName: { entityType, alias?: string, appearances: [{ file, line, context }] } }`

### 8. Host Adapters: YAML Core Definitions → Per-Host Files

**Decision**: Core command definitions stored as YAML in CLI source (`src/commands/`). Each adapter reads these and generates host-native files. The adapter is a **build-time** concern — generated on `init`/`update`, not at CLI runtime.

**Core command definition format**:
```yaml
name: draft
description: "Write chapter draft using context pack and scene plan"
category: writing
parameters:
  - name: change
    type: string
    required: true
  - name: artifact
    type: string
    default: "draft"
steps:
  - action: cli
    command: "openadab context pack --change {{change}} --artifact {{artifact}} --json"
    capture: context_pack
  - action: cli
    command: "openadab instructions {{artifact}} --change {{change}} --json"
    capture: instructions
  - action: read
    paths: "{{context_pack.mustRead}}"
  - action: read_optional
    paths: "{{context_pack.optionalRead}}"
  - action: write
    path: "{{instructions.outputPath}}"
    content: "{{llm_output}}"
  - action: cli
    command: "openadab validate --change {{change}}"
```

**Adapter outputs**:
- **Opencode**: Creates `.agents/skills/adab-draft/SKILL.md` with slash command definition
- **Cursor**: Creates `.cursor/rules/adab.mdc` with `@draft` command
- **Copilot**: Creates `.github/copilot-instructions.md` with draft instructions
- **Generic**: Creates `AGENTS.md` with all commands documented

### 9. Log Format: Markdown-Comment Annotations

**Decision**: `log.md` is append-only with structured Markdown entries using HTML comments for machine parsing.

```markdown
<!-- log-entry {"ts":"2026-06-06T10:30:00Z","op":"init","change":null,"result":"ok"} -->
- **2026-06-06T10:30:00Z** `init` project "Untitled Novel" (schema: chapter-draft)
<!-- log-entry {"ts":"2026-06-06T10:31:00Z","op":"new","change":"draft-ch-012","result":"ok"} -->
- **2026-06-06T10:31:00Z** `new` change `draft-ch-012` (schema: chapter-draft, chapter: 012)
```

This allows human reading of the Markdown while providing machine-parseable JSON in comments.

### 10. Technology Stack

| Component | Library | Rationale |
|-----------|---------|-----------|
| Language | TypeScript 5.x | Type safety, ecosystem |
| Runtime | Node.js 20+ (tsx for dev) | Universal, fast startup |
| CLI framework | commander | Most popular, well-typed |
| TUI spinners | ora | Simple, works everywhere |
| TUI colors | chalk | De facto standard |
| YAML parsing | yaml (npm) | Parse and stringify with comments |
| Schema validation | zod | TypeScript-first, composable |
| Markdown parsing | unified + remark-parse + remark-frontmatter | AST-based, extensible |
| Frontmatter | gray-matter | Battle-tested, YAML + JSON frontmatter |
| File globbing | fast-glob | High performance |
| File watching | chokidar | Cross-platform, reliable |
| Testing | vitest | Fast, TypeScript-native |
| Dev runner | tsx | Fastest ts-node alternative |
| Package manager | pnpm | Disk-efficient, strict |

**Non-dependencies** (intentionally excluded):
- No ORM/database (filesystem is the database)
- No LLM SDK (CLI never calls LLM APIs)
- No web framework (no server)
- No vector/embedding libraries (v2 retrieval layer)
- No tiktoken (heuristic token counting)

## Risks / Trade-offs

### [Risk] LLM-generated wiki-diff quality varies by host and model
- **Mitigation**: Human `--review` gate before apply; source citation requirement prevents unmoored updates; contradiction flagging catches errors; mechanical validation checks diff structure

### [Risk] Context packer misses key information due to simple entity matching
- **Mitigation**: Config `alwaysInclude` acts as safety net; `reasons` field makes omissions visible; `excluded` list shows what was dropped; stale mention index is detected via `.last-indexed` timestamp with warning; future: LLM-based relevance scoring

### [Risk] Mention indexer produces false positives from regex matching
- **Mitigation**: Start with exact entity name matching (case-sensitive by default); aliases must be explicitly declared in frontmatter; word-boundary regex prevents substring matches; stale index is detected via `.last-indexed` timestamp with best-effort fallback; future: NLP-based entity recognition

### [Risk] Wiki page format drift over time (inconsistent Markdown structure)
- **Mitigation**: Frontmatter schema enforced by `wiki-engine` on every write; `wiki lint` validates page structure; wiki page templates (from schema) provide consistent starting templates

### [Risk] Schema versioning produces incompatibility with in-progress changes
- **Mitigation**: Changes lock to schema version at creation (`.openadab.yaml` records it); `schema validate` checks compatibility; `update` never overwrites project forks; completed changes archive with their schema version

### [Risk] Monolithic log.md grows unboundedly
- **Mitigation**: Append-only with human-readable structure; rotation strategy: `log-2026.md` per year (configurable) — deferred to v2, MVP handles this with ~500 lines per 50-chapter novel; log entries are compact (~1 line per operation) so growth is negligible for typical projects

### [Trade-off] File-existence state model prevents parallel chapter work
- Multiple simultaneous changes are theoretically possible but context packing gets complex (unapplied wiki-diff from ch-012 affects ch-013 context). Sequential workflow is safer for MVP. Future: explicit dependency declaration between changes.

### [Trade-off] Heuristic token counting loses ~20% accuracy vs. tiktoken
- 80% accuracy is sufficient for budget management (over/under by ~20% is acceptable). Adding tiktoken adds binary dependency complexity. Future: optional tiktoken integration.

## Migration Plan

N/A — greenfield project. No migration needed.

## Open Questions

1. **Index file git strategy**: Commit `index/*.json` (fast CLI startup, merge conflicts) or gitignore (regenerate on first use)? Leaning gitignore — regenerate on `init`/`sync`. Index staleness is detected via `.last-indexed` timestamp file.

2. **`scenes/` directory**: What goes in `manuscript/scenes/`? Individual scene files? Scene-level artifact? The directory is scaffolded by `init` for forward compatibility, but MVP uses inline scene markers in chapter Markdown. Scene-level artifacts are deferred to a future schema.

3. **Change naming convention**: Enforce prefix pattern (`draft-`, `revise-`, `wiki-`) or free-form? Leaning convention by schema type prefix.

4. **Semantic validation execution**: Generate prompts for LLM, or also parse LLM responses? Generate-only for MVP — CLI outputs validation prompts, human/AI runs them.

5. **Non-tool-use host adapter strategy**: For hosts that can't run CLI (Gemini web, Kimi web), the adapter generates a monolithic prompt with all context inlined. How to handle word count limits? Config `context.maxTokens` controls this.

6. **Concurrent wiki-diff conflicts**: When two changes have wiki-diffs that modify the same wiki page, the second `sync` may encounter stale `last_updated` timestamps. The wiki-diff-engine's idempotency check (detect stale target) warns but does not merge. Sequential workflow is the safe MVP path; merge strategies are deferred.

7. **Bidirectional relationship updates**: The `update_relationship` operation targets a single entity page (e.g., "Mara is now allied with Lin" on Mara's page). Should the engine also update Lin's page to reflect "allied with Mara"? Leaning single-target for MVP — the LLM generating the wiki-diff is responsible for including both sides if bidirectional consistency is desired. Automatic bidirectional sync is a v2 enhancement.
