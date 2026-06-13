# Contributing to OpenAdab Desktop

The desktop app is an Electron shell inside the OpenAdab pnpm monorepo
at `apps/desktop/`. Package name: `@openadab/desktop`.

## Prerequisites

- Node.js >= 20
- pnpm (workspace manager)
- `openadab` CLI installed and available in PATH (for runtime, not build)

## Development Setup

```bash
# From the repository root:
pnpm install

# Navigate to the desktop app
cd apps/desktop
```

## Running in Development

The dev script starts both Vite (renderer) and Electron (main) concurrently:

```bash
pnpm dev
```

This runs:
1. Vite dev server at `http://localhost:5173` (HMR enabled).
2. Electron loads that URL and opens DevTools detached.

You can also run them separately:

```bash
pnpm dev:renderer   # Vite only
pnpm dev:electron   # Electron only (after renderer is running)
```

## Building

```bash
pnpm build
```

This runs:
1. `vite build` — bundles the React renderer into `renderer/dist/`.
2. `tsc -p tsconfig.electron.json` — compiles Electron main/preload
   TypeScript into `dist-electron/`.

For individual builds:

```bash
pnpm build:renderer   # Vite build only
pnpm build:electron   # TypeScript compilation only
```

## Testing

```bash
# Run all unit tests (vitest)
pnpm test

# Watch mode for TDD
pnpm test:watch

# Type-check without emitting
pnpm typecheck
```

### Test Suites

Tests live under `apps/desktop/tests/` and use vitest:

| Suite | Location | What it covers |
|-------|----------|----------------|
| Path guards | `tests/path-guards.test.ts` | Boundary validation, symlink escapes, normalization |
| Command runner | `tests/command-runner.test.ts` | Allow-list, mutating classification, arg extraction |
| Agent supervisor | `tests/agent-supervisor.test.ts` | Permission classification, session lifecycle |
| Transcript store | `tests/transcript-store.test.ts` | Append, filtering, clear, persistence |
| Project store | `tests/project-store.test.ts` | Project detection, config parsing, recent projects |
| IPC types | `tests/ipc-types.test.ts` | Schema validation for all request/response types |
| Path extraction | `tests/path-extraction.test.ts` | Wiki link parsing, reference extraction |
| Agent logger | `tests/agent-logger.test.ts` | Log entry creation, persistence, filtering |

### End-to-End Tests

E2E tests use Playwright and live under `apps/desktop/e2e/`. They launch
Electron and interact with the full app. Run with:

```bash
# Requires a built app first
pnpm build
npx playwright test --config=e2e/playwright.config.ts
```

## Project Structure

```
apps/desktop/
├── package.json              # @openadab/desktop package
├── tsconfig.json             # Shared TS config (renderer + tests)
├── tsconfig.electron.json    # Electron main/preload TS config
├── vite.config.ts            # Vite config for renderer
├── vitest.config.ts          # Vitest config for unit tests
│
├── electron/                 # Main process (Node.js, Electron APIs)
│   ├── main.ts               # App entry, BrowserWindow, IPC handlers
│   ├── preload.ts            # contextBridge, exposes window.openadab
│   ├── command-runner.ts     # CLI child_process.spawn() manager
│   ├── agent-supervisor.ts   # ACP agent process/session management
│   ├── agent-logger.ts       # Agent event persistence (JSONL)
│   ├── path-guards.ts        # Filesystem boundary validation
│   ├── project-store.ts      # Project detection, recent projects
│   └── transcript-store.ts   # Command event log (JSONL)
│
├── shared/                   # Types shared between main and renderer
│   └── ipc-types.ts          # All channels, schemas, and API surface
│
├── renderer/                 # Renderer process (React, Vite, browser APIs)
│   ├── index.html            # HTML shell
│   ├── src/
│   │   ├── app.tsx           # Root component, routing, layout shell
│   │   ├── api/              # window.openadab wrappers, API hooks
│   │   ├── routes/           # 7 route components
│   │   ├── components/       # Shared UI components
│   │   ├── workbenches/      # Workbench panels (Inspector, Editor, etc.)
│   │   ├── state/            # Renderer state management
│   │   └── styles/           # CSS
│   └── assets/               # Static assets
│
├── tests/                    # Unit tests (vitest)
├── e2e/                      # End-to-end tests (Playwright)
│
├── docs/                     # Documentation (architecture, CLI, permissions)
└── CONTRIBUTING.md           # This file
```

## Key Design Constraints

- **Renderer never imports from `electron/`.** All inter-process
  communication goes through the typed IPC bridge in `shared/ipc-types.ts`.

- **CLI is authoritative.** The GUI never directly manipulates project
  state. All workflow mutations go through `openadab` CLI invocations.

- **Path guards are mandatory.** Every filesystem operation from the
  renderer must pass through `guardFilePath()` in `path-guards.ts`.
  Bypassing this is a security bug.

- **No shell string joining.** CLI arguments are always passed as arrays
  to `child_process.spawn()`, never as a single string.

- **Tests don't require Electron runtime.** Most unit tests in `tests/`
  can run without an Electron binary because the core logic lives in
  pure functions with types-only Electron imports.

## Adding a New CLI Command to the Allow-List

1. Add the subcommand to `ALLOWED_COMMANDS` in `command-runner.ts`.
2. If it supports `--json`, add it to `JSON_COMMANDS`.
3. If it mutates state, add it to `MUTATING_COMMANDS`.
4. Add the command to `cli-contracts.md` with its expected JSON shape.
5. Add test coverage for allow-list validation in
   `tests/command-runner.test.ts`.

## Linting

```bash
pnpm lint
```

ESLint is configured at the repo root. The desktop package inherits the
root config.

## Releasing

The desktop app is built alongside the main CLI release. Run from repo root:

```bash
pnpm build           # Build CLI and desktop
pnpm -r build        # Build all workspace packages
```

The built desktop app lives in `apps/desktop/dist-electron/` (main) and
`apps/desktop/renderer/dist/` (renderer).
