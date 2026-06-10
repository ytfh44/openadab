# OpenAdab

Local-first, host-neutral fiction workflow engine CLI.

OpenAdab helps writers and AI assistants collaborate on long-form fiction by providing a structured, schema-driven workflow for drafting chapters, tracking continuity, and maintaining a living wiki of characters, locations, threads, and world rules.

## Features

- **Schema-driven workflows** — Built-in schemas for chapter drafts, revisions, wiki ingestion, and more.
- **Living wiki** — Markdown-based wiki pages with frontmatter, auto-generated indexes, and wikilink graphs.
- **Continuity tracking** — Mention indexer, progression tracker, and wiki-diff engine keep the story consistent.
- **Context packing** — Automatically assembles the most relevant wiki pages and manuscript chapters as context for each artifact.
- **Host-neutral** — Generates adapter files for Opencode, Cursor, GitHub Copilot, and generic AI agents.
- **Local-first** — All data lives in your project directory; no cloud dependency.

## Installation

Requires Node.js >= 20.

```bash
npm install -g openadab
# or
pnpm add -g openadab
```

## Quick Start

```bash
# 1. Initialize a new project
openadab init --schema chapter-draft

# 2. Create a new chapter change
openadab new chapter ch-001

# 3. Check status
openadab status --change ch-001

# 4. Load instructions for the next artifact
openadab instructions brief --change ch-001

# 5. After writing all artifacts, sync and archive
openadab sync --change ch-001
openadab archive ch-001
```

## Command Reference

### Project

| Command | Description |
|---------|-------------|
| `openadab init [--schema <name>] [--host <name>]` | Initialize a new OpenAdab project |
| `openadab update [--schemas]` | Regenerate host adapters and refresh schemas |

### Change Management

| Command | Description |
|---------|-------------|
| `openadab new <type> <id>` | Create a new change (e.g., `new chapter ch-001`) |
| `openadab status --change <id> [--json]` | Show artifact graph status |
| `openadab instructions <artifact> --change <id> [--json] [--inline-deps]` | Load instructions for an artifact |
| `openadab context pack --change <id> --artifact <id> [--json]` | Pack context for an artifact |
| `openadab validate --change <id> [--mechanical] [--semantic]` | Run validators on a change |
| `openadab sync --change <id>` | Orchestrate full sync for a change |
| `openadab archive <change-id>` | Archive a completed change |

### Schema

| Command | Description |
|---------|-------------|
| `openadab schema list` | List available built-in schemas |
| `openadab schema validate <path>` | Validate a schema directory |
| `openadab schema fork <base> <name>` | Fork a built-in schema |
| `openadab schema show <name>` | Show schema details |

### Wiki

| Command | Description |
|---------|-------------|
| `openadab wiki index` | Regenerate wiki index TOC |
| `openadab wiki lint` | Validate wiki page structure |
| `openadab wiki diff --change <id>` | Preview wiki-diff for a change |
| `openadab wiki apply-diff <path> [--dry-run] [--apply] [--change <id>]` | Apply semantic wiki-diff operations |

### Config & Log

| Command | Description |
|---------|-------------|
| `openadab config get <path>` | Get a config value by dot-path |
| `openadab config set <path> <value>` | Set a config value by dot-path |
| `openadab log [--limit <N>] [--change <id>]` | Display log entries |

## Architecture

```
┌─────────────────────────────────────────┐
│              CLI (src/cli)              │
├─────────────────────────────────────────┤
│  init │ new │ status │ sync │ archive   │
│  schema │ wiki │ config │ log │ validate│
├─────────────────────────────────────────┤
│           Host Adapters                 │
│  Opencode │ Cursor │ Copilot │ Generic  │
├─────────────────────────────────────────┤
│         Workflow Engine                 │
│  SchemaEngine │ ArtifactGraph │ Manifest│
├─────────────────────────────────────────┤
│         Content Modules                 │
│  WikiEngine │ MentionIndexer │ Context  │
│  Packer │ ProgressionTracker │ Sync     │
│  Engine │ ArchiveEngine │ WikiDiff     │
├─────────────────────────────────────────┤
│         Utilities                       │
│  FS │ Markdown │ TokenCounter │ Errors  │
└─────────────────────────────────────────┘
```

## Project Structure

```
my-novel/
├── adab/
│   ├── config.yaml
│   ├── log.md
│   ├── manuscript/
│   │   └── chapters/
│   ├── wiki/
│   │   ├── characters/
│   │   ├── locations/
│   │   ├── threads/
│   │   └── index.md
│   ├── changes/
│   │   └── archive/
│   ├── schemas/
│   │   └── chapter-draft/
│   └── index/
│       ├── mentions.json
│       ├── wikilinks.json
│       ├── progressions.json
│       └── context-map.json
└── .gitignore
```

## Acknowledgments

OpenAdab is deeply inspired by [OpenSpec](https://github.com/Fission-AI/OpenSpec/), a schema-driven artifact workflow framework that demonstrates how structured creative work can be made tractable through artifact DAGs, file-existence state detection, and reviewable canon gates. OpenAdab's core architecture — schema-driven workflows, artifact graphs with blocked/ready/done states, and host-neutral adapter generation — directly extends the patterns pioneered by OpenSpec.

This project was itself built using the OpenSpec workflow, serving as both a consumer and a testament to the power of schema-driven development.

## License

MIT
