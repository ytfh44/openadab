# Contributing to OpenAdab

Thank you for your interest in contributing! This document covers development setup, code style, the PR process, and testing requirements.

## Development Setup

1. **Clone the repository**

   ```bash
   git clone https://github.com/your-org/openadab.git
   cd openadab
   ```

2. **Install dependencies**

   ```bash
   pnpm install
   ```

3. **Verify the environment**

   ```bash
   pnpm test
   pnpm build
   ```

## Project Structure

```
src/
  cli/               # Commander-based CLI wrapper
  commands/          # Core command definitions (*.yaml)
  modules/           # Feature modules (wiki, sync, archive, etc.)
  schemas/           # Zod schemas and TypeScript types
  utils/             # Shared utilities (fs, markdown, tokens, errors)
tests/
  integration/       # Integration tests and fixtures
```

## Code Style

- **TypeScript** with strict mode enabled.
- **ES modules** (`"type": "module"` in `package.json`).
- Prefer `async/await` over raw promises.
- Use the `node:` prefix for built-in modules (e.g., `node:path`).
- Write docstrings for all public functions, classes, and interfaces.
- Do not add inline comments unless the logic is genuinely non-obvious.

## PR Process

1. **Branch** from `main`: `git checkout -b feature/your-feature-name`.
2. **Write tests** before or alongside your changes.
3. **Ensure all tests pass**: `pnpm test`.
4. **Build passes**: `pnpm build`.
5. **Open a PR** with a clear description of the problem and solution.
6. **Link related issues** if applicable.

## Testing Requirements

- **Unit tests** live next to the source file (`*.test.ts`).
- **Integration tests** live in `tests/integration/`.
- Run the full suite with `pnpm test`.
- Aim for meaningful coverage of public APIs and edge cases.

### Test Commands

```bash
pnpm test          # Run all tests once
pnpm test:watch    # Run tests in watch mode
pnpm build         # Compile TypeScript
```

## Adding a New Schema

1. Create a directory under `src/schemas/built-in/<name>/`.
2. Add `schema.yaml` and a `templates/` folder with Markdown templates.
3. Add a unit test in `src/schemas/built-in/index.test.ts` to validate the schema.

## Adding a New CLI Command

1. Implement the command in `src/cli/index.ts` using Commander.
2. Add a corresponding command definition in `src/commands/<name>.yaml` if it should be exposed to host adapters.
3. Add integration tests in `tests/integration/cli-e2e.test.ts`.

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
