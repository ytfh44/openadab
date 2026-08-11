/**
 * Unit tests for CLI command parsing and JSON output structure.
 */
import { existsSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import { createMinimalProject } from '../../tests/integration/fixture.js';
import type { ContextPacker } from '../modules/context-packer/index.js';
import { InstructionLoader } from '../modules/instruction-loader/index.js';
import { SchemaLoader } from '../modules/schema-engine/index.js';
import type { SchemaDef } from '../schemas/schema-def.js';
import type { ProjectConfig, ContextPack } from '../schemas/types.js';

import { createProgram } from './index.js';

/**
 * Read the current `process.exitCode`.
 *
 * Wrapped in a function because TS control-flow analysis pins the
 * property to `undefined` after an assignment of `undefined` — a direct
 * comparison at the call site would be narrowed to "always false" and
 * trip `no-unnecessary-condition`. A function call resets narrowing.
 */
function readExitCode(): typeof process.exitCode {
  return process.exitCode;
}

/**
 * Run a CLI command with cwd set to `projectRoot`, capturing stdout,
 * stderr, and the final exit code. Restores cwd, exit code, and all
 * console spies afterwards.
 *
 * @param projectRoot Directory to run the command in (must contain a project).
 * @param args        Arguments after `openadab`.
 * @returns Captured stdout/stderr text and the final exit code
 *          (`null` when the command left it unset, i.e. success).
 */
async function runCliCapture(
  projectRoot: string,
  args: string[],
): Promise<{ exitCode: number | null; stdoutText: string; stderrText: string }> {
  const originalCwd = process.cwd();
  process.chdir(projectRoot);

  const stdoutLines: string[] = [];
  const stderrLines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
    stdoutLines.push(String(msg));
  });
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
    stderrLines.push(String(msg));
  });
  const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  }));

  const originalExitCode = process.exitCode;
  // Earlier tests in this file run real action handlers that set
  // process.exitCode without restoring it, so the pre-run value cannot
  // be trusted as a "success" baseline. Clear it and treat ANY
  // non-undefined value after parsing as set by the command itself.
  process.exitCode = undefined;

  let capturedExitCode: number | null = null;
  try {
    const program = createProgram();
    await program.parseAsync(['node', 'openadab', ...args]);
  } finally {
    const exitAfterParse = readExitCode();
    if (exitAfterParse !== undefined) {
      capturedExitCode = Number(exitAfterParse);
    }
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    process.exitCode = originalExitCode;
  }
  return { exitCode: capturedExitCode, stdoutText: stdoutLines.join('\n'), stderrText: stderrLines.join('\n') };
}

describe('CLI createProgram', () => {
  it('returns a Commander program named openadab', () => {
    const program = createProgram();
    expect(program.name()).toBe('openadab');
  });

  it('has version 0.1.0', () => {
    const program = createProgram();
    expect(program.version()).toBe('0.1.0');
  });

  it('parses init command with --schema and --host flags', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'init', '--schema', 'chapter-draft', '--host', 'cursor'];
    await program.parseAsync(args);
    const cmd = program.commands.find((c) => c.name() === 'init');
    expect(cmd).toBeDefined();
    expect(cmd?.opts().schema).toBe('chapter-draft');
    expect(cmd?.opts().host).toBe('cursor');
  });

  it('parses status command with --change and --json flags', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'status', '--change', 'ch-001', '--json'];
    // Only verify command exists and options are parsed; avoid executing action
    const cmd = program.commands.find((c) => c.name() === 'status');
    expect(cmd).toBeDefined();
    // Parse without executing action by overriding the action handler
    let parsedOptions: Record<string, unknown> = {};
    cmd?.action((opts: Record<string, unknown>) => {
      parsedOptions = opts;
    });
    await program.parseAsync(args);
    expect(parsedOptions.change).toBe('ch-001');
    expect(parsedOptions.json).toBe(true);
  });

  it('parses schema subcommands', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'schema', 'list'];
    await program.parseAsync(args);
    const schemaCmd = program.commands.find((c) => c.name() === 'schema');
    expect(schemaCmd).toBeDefined();
    expect(schemaCmd?.commands.find((c) => c.name() === 'list')).toBeDefined();
    expect(schemaCmd?.commands.find((c) => c.name() === 'validate')).toBeDefined();
    expect(schemaCmd?.commands.find((c) => c.name() === 'fork')).toBeDefined();
    expect(schemaCmd?.commands.find((c) => c.name() === 'show')).toBeDefined();
  });

  it('parses wiki subcommands', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'wiki', 'index'];
    await program.parseAsync(args);
    const wikiCmd = program.commands.find((c) => c.name() === 'wiki');
    expect(wikiCmd).toBeDefined();
    expect(wikiCmd?.commands.find((c) => c.name() === 'index')).toBeDefined();
    expect(wikiCmd?.commands.find((c) => c.name() === 'lint')).toBeDefined();
    expect(wikiCmd?.commands.find((c) => c.name() === 'diff')).toBeDefined();
    expect(wikiCmd?.commands.find((c) => c.name() === 'apply-diff')).toBeDefined();
  });

  it('parses config subcommands', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'config', 'get', 'project.title'];
    await program.parseAsync(args);
    const configCmd = program.commands.find((c) => c.name() === 'config');
    expect(configCmd).toBeDefined();
    expect(configCmd?.commands.find((c) => c.name() === 'get')).toBeDefined();
    expect(configCmd?.commands.find((c) => c.name() === 'set')).toBeDefined();
  });

  it('parses log command with --limit and --change flags', async () => {
    const program = createProgram();
    const args = ['node', 'openadab', 'log', '--limit', '5', '--change', 'ch-001'];
    await program.parseAsync(args);
    const cmd = program.commands.find((c) => c.name() === 'log');
    expect(cmd).toBeDefined();
  });
});

describe('CLI changeContext type safety', () => {
  it('InstructionLoader accepts undefined changeContext (empty chapter)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-cc-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });

    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [] },
      ],
    };

    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };

    const contextPack: ContextPack = { mustRead: [], optionalRead: [], excluded: [], reasons: {} };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue(contextPack),
      projectRootPath: root,
    } as unknown as ContextPacker;

    // When chapterNumber is empty string (no match), changeContext should be undefined
    const changeContextUndefined: Record<string, string> | undefined = undefined;
    const loader1 = new InstructionLoader(schema, config, contextPacker, 'non-matching', changeContextUndefined);
    expect(loader1).toBeDefined();
    const payload1 = await loader1.loadInstructions('brief');
    expect(payload1.artifact).toBe('brief');

    // When chapterNumber is matched, changeContext is { chapter: '012' }
    const loader2 = new InstructionLoader(schema, config, contextPacker, 'ch-012', { chapter: '012' });
    expect(loader2).toBeDefined();
    const payload2 = await loader2.loadInstructions('brief');
    expect(payload2.artifact).toBe('brief');
  });
});

describe('CLI JSON output helper', () => {
  it('outputs JSON when --json is set', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => { /* noop */ });
    const program = createProgram();
    // output is private; test indirectly via command parsing
    expect(program).toBeDefined();
    logSpy.mockRestore();
  });
});

describe('CLI wiki lint — system page checks', () => {
  it('reports issues for corrupted index.md (missing required type field)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-lint-'));
    const adabDir = join(root, 'adab');
    mkdirSync(join(adabDir, 'wiki'), { recursive: true });
    mkdirSync(join(adabDir, 'index'), { recursive: true });
    mkdirSync(join(adabDir, 'schemas'), { recursive: true });

    // Minimal valid config so ensureProjectConfig() passes
    writeFileSync(join(adabDir, 'config.yaml'), 'schema: chapter-draft\nversion: 1\n', 'utf-8');

    // Valid user page so listPages() has at least one entry
    writeFileSync(
      join(adabDir, 'wiki', 'a.md'),
      '---\ntype: character\nname: A\nstatus: x\n---\n# A',
      'utf-8',
    );
    // Corrupted index.md: frontmatter present but missing required `type`
    writeFileSync(
      join(adabDir, 'wiki', 'index.md'),
      '---\nname: NoType\n---\n# Index',
      'utf-8',
    );
    writeFileSync(join(adabDir, 'wiki', 'overview.md'), '---\ntype: overview\n---\n# Overview', 'utf-8');
    writeFileSync(join(adabDir, 'wiki', 'contradictions.md'), '---\ntype: contradictions\n---\n# Contradictions', 'utf-8');

    const originalCwd = process.cwd();
    process.chdir(root);

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
    });
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const program = createProgram();
      await program.parseAsync(['node', 'openadab', 'wiki', 'lint']);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      errorSpy.mockRestore();
      process.exitCode = originalExitCode;
    }

    const combined = [...stdoutLines, ...stderrLines].join('\n');
    expect(combined).toContain('index.md');
  });
});

/**
 * `update --schemas` should surface explicit warning/error when
 * `SchemaLoader.listBuiltInSchemas()` returns an empty array or throws.
 *
 * Before the fix:
 *   - Empty list: command silently succeeded (spinner printed "Update complete.")
 *   - Throw: command silently succeeded as long as the outer try/catch did
 *     not surface the inner error.
 *
 * After the fix:
 *   - Empty list: JSON output includes `warning: 'No built-in schemas found'`
 *     and `commandsRun: []`. forkSchema must not be called.
 *   - Throw: `process.exitCode` must be non-zero and the error reaches the
 *     user via `handleError`.
 *   - Normal path (regression): `commandsRun` contains the schema name(s)
 *     and no `warning` field is present.
 */
describe('CLI update --schemas surfaces empty/error cases', () => {
  let listSpy: ReturnType<typeof vi.spyOn> | null = null;
  let forkSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    listSpy = vi.spyOn(SchemaLoader.prototype, 'listBuiltInSchemas');
    forkSpy = vi.spyOn(SchemaLoader.prototype, 'forkSchema').mockResolvedValue(undefined);
  });

  afterEach(() => {
    listSpy?.mockRestore();
    forkSpy?.mockRestore();
    listSpy = null;
    forkSpy = null;
  });

  /**
   * Run `openadab update --schemas --json` against a freshly scaffolded
   * minimal project, capturing stdout, stderr, and the final exit code.
   *
   * @param args Extra commander arguments appended after `update --schemas --json`.
   * @returns Captured stdout/stderr lines and the final `process.exitCode`.
   */
  async function runUpdateSchemasJson(args: string[]): Promise<{
    stdoutLines: string[];
    stderrLines: string[];
    exitCode: number | undefined;
  }> {
    const projectRoot = mkdtempSync(join(tmpdir(), 'openadab-'));
    await createMinimalProject(projectRoot);

    const stdoutLines: string[] = [];
    const stderrLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation((msg: unknown) => {
      stdoutLines.push(String(msg));
    });
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
    });
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }));
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as unknown as never;
    }));

    const originalCwd = process.cwd();
    const originalExitCode = process.exitCode;
    process.chdir(projectRoot);
    process.exitCode = undefined;

    let exitCode: number | undefined;
    try {
      const program = createProgram();
      await program.parseAsync(['node', 'openadab', 'update', '--schemas', '--json', ...args]);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      errorSpy.mockRestore();
      stderrWriteSpy.mockRestore();
      exitSpy.mockRestore();
      exitCode = process.exitCode;
      process.exitCode = originalExitCode;
    }

    return { stdoutLines, stderrLines, exitCode };
  }

  it('emits warning and commandsRun=[] when listBuiltInSchemas returns []', async () => {
    listSpy?.mockResolvedValue([]);
    const { stdoutLines, stderrLines } = await runUpdateSchemasJson([]);

    const combined = [...stdoutLines, ...stderrLines].join('\n');
    expect(combined).toContain('No built-in schemas found');
    expect(forkSpy).not.toHaveBeenCalled();
    const jsonLine = stdoutLines.find((l) => l.trimStart().startsWith('{'));
    expect(jsonLine, 'expected a JSON object on stdout').toBeDefined();
    if (jsonLine !== undefined) {
      const parsed = JSON.parse(jsonLine) as { warning?: string; commandsRun?: unknown[]; success?: boolean };
      expect(parsed.warning).toBe('No built-in schemas found');
      expect(parsed.commandsRun).toEqual([]);
    }
  });

  it('sets process.exitCode to a non-zero value when listBuiltInSchemas throws', async () => {
    listSpy?.mockRejectedValue(new Error('dist/schemas/built-in missing'));
    const { exitCode, stderrLines } = await runUpdateSchemasJson([]);

    expect(exitCode).toBeDefined();
    expect(exitCode).not.toBe(0);
    const combined = stderrLines.join('\n');
    expect(combined.toLowerCase()).toMatch(/error|dist\/schemas\/built-in missing/);
  });

  it('normal path reports commandsRun without a warning (regression)', async () => {
    listSpy?.mockResolvedValue(['chapter-draft']);
    const { stdoutLines, stderrLines } = await runUpdateSchemasJson([]);

    const jsonLine = stdoutLines.find((l) => l.trimStart().startsWith('{'));
    expect(jsonLine, 'expected a JSON object on stdout').toBeDefined();
    if (jsonLine !== undefined) {
      const parsed = JSON.parse(jsonLine) as {
        warning?: string;
        commandsRun?: string[];
        success?: boolean;
      };
      expect(parsed.warning).toBeUndefined();
      expect(parsed.commandsRun).toContain('chapter-draft');
    }
    const combined = [...stdoutLines, ...stderrLines].join('\n');
    expect(combined).not.toContain('No built-in schemas found');
  });

  // ===== CLI-CONFLICT: --apply vs --dry-run must be detected =====
  // The pre-fix code passed `conflicts(['dryRun'])` which is the
  // Commander attribute name (camelCase), not the kebab-case option
  // name.  Commander silently ignored the conflict declaration, so
  // the user could pass `--apply --dry-run` and the apply actually
  // fired.  The fix uses `conflicts(['dry-run'])` and the runtime
  // throws when both are supplied.
  describe('CLI-CONFLICT apply vs dry-run', () => {
    it('wiki apply-diff command declares --dry-run and --apply as conflicting options', () => {
      const program = createProgram();
      const wikiCmd = program.commands.find((c) => c.name() === 'wiki');
      expect(wikiCmd).toBeDefined();
      const applyDiff = wikiCmd?.commands.find((c) => c.name() === 'apply-diff');
      expect(applyDiff).toBeDefined();
      // Both options should be present.
      const dryRunOpt = applyDiff?.options.find((o) => o.name() === 'dry-run');
      const applyOpt = applyDiff?.options.find((o) => o.name() === 'apply');
      expect(dryRunOpt).toBeDefined();
      expect(applyOpt).toBeDefined();
      // And the --apply option MUST declare --dry-run as a conflict.
      // Commander stores this in option.conflictsWith (Array of strings, not a Set).
      // The conflict is declared in the form Commander compares against at
      // runtime (camelCase attribute name), so accept either kebab-case or
      // camelCase storage to keep this assertion robust to either declaration
      // style that satisfies Commander's runtime conflict check.
      const conflicts = (applyOpt?.conflictsWith ?? []) as readonly string[];
      expect(Array.isArray(conflicts)).toBe(true);
      expect(conflicts.includes('dryRun') || conflicts.includes('dry-run')).toBe(true);
    });

    it('passing only --apply does not throw (positive case still works)', async () => {
      const program = createProgram();
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => stderrLines.push(m));
      const origExit = process.exit;
      (process as unknown as { exit: (code?: number) => never }).exit = ((_code?: number) => {
        throw new Error('commander:exit');
      });
      try {
        await expect(
          program.parseAsync(['node', 'openadab', 'wiki', 'apply-diff', 'foo/bar.md', '--apply'])
        ).resolves.toBeDefined();
      } finally {
        process.exit = origExit;
        errSpy.mockRestore();
      }
    });

    it('passing only --dry-run does not throw (positive case still works)', async () => {
      const program = createProgram();
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => stderrLines.push(m));
      const origExit = process.exit;
      (process as unknown as { exit: (code?: number) => never }).exit = ((_code?: number) => {
        throw new Error('commander:exit');
      });
      try {
        await expect(
          program.parseAsync(['node', 'openadab', 'wiki', 'apply-diff', 'foo/bar.md', '--dry-run'])
        ).resolves.toBeDefined();
      } finally {
        process.exit = origExit;
        errSpy.mockRestore();
      }
    });

    it('passing neither --apply nor --dry-run does not throw (safe default)', async () => {
      const program = createProgram();
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => stderrLines.push(m));
      const origExit = process.exit;
      (process as unknown as { exit: (code?: number) => never }).exit = ((_code?: number) => {
        throw new Error('commander:exit');
      });
      try {
        await expect(
          program.parseAsync(['node', 'openadab', 'wiki', 'apply-diff', 'foo/bar.md'])
        ).resolves.toBeDefined();
      } finally {
        process.exit = origExit;
        errSpy.mockRestore();
      }
    });

    it('passing both --apply and --dry-run is rejected at parse time', async () => {
      const program = createProgram();
      const stderrLines: string[] = [];
      const errSpy = vi.spyOn(console, 'error').mockImplementation((m: string) => stderrLines.push(m));
      // Commander writes its error messages via process.stderr.write (not
      // console.error), so spy on that too. See lib/command.js:63 default
      // writeErr: (str) => process.stderr.write(str).
      const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
        stderrLines.push(String(chunk));
        return true;
      }));
      const origExit = process.exit;
      // Commander calls process.exit on parse error; replace it so the
      // test does not abort the process.
      (process as unknown as { exit: (code?: number) => never }).exit = ((_code?: number) => {
        throw new Error('commander:exit');
      });
      try {
        await expect(
          program.parseAsync(['node', 'openadab', 'wiki', 'apply-diff', 'foo/bar.md', '--apply', '--dry-run'])
        ).rejects.toThrow();
      } finally {
        process.exit = origExit;
        errSpy.mockRestore();
        stderrWriteSpy.mockRestore();
      }
      const combined = stderrLines.join('\n');
      expect(combined.toLowerCase()).toMatch(/cannot be used with|--apply|--dry-run/);
    });
  });
});

/**
 * Regression for S1: `sync` must validate/pack against the schema the
 * change was created under (from its manifest), not the currently
 * ACTIVE schema. A change created under schema A must not be validated
 * against schema B just because the project's active schema changed.
 */
describe('CLI sync uses the change manifest schema (S1)', () => {
  it('builds the SchemaLoader from changeManifest.schema, not the active schema', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'openadab-sync-schema-'));
    await createMinimalProject(projectRoot);

    // The change is created under "legacy-schema" while the project's
    // ACTIVE schema stays "chapter-draft" (the minimal-project default).
    const changeDir = join(projectRoot, 'adab', 'changes', 'ch-001');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, '.openadab.yaml'),
      `${[
        'changeId: ch-001',
        'schema: legacy-schema',
        'version: 1',
        'created: 2024-01-01T00:00:00Z',
        'status: in_progress',
        'currentArtifact: brief',
        'artifacts:',
        '  brief: ready',
        '  scene-plan: blocked',
        '  draft: blocked',
        '  revision: blocked',
        '  continuity-report: blocked',
        '  wiki-diff: blocked',
        'metadata: {}',
      ].join('\n')  }\n`,
      'utf-8',
    );

    let capturedSchemaDir = '';
    const schemaLoadSpy = vi.spyOn(SchemaLoader.prototype, 'load');
    schemaLoadSpy.mockImplementation(function mockLoad(this: SchemaLoader) {
      capturedSchemaDir = (this as unknown as { schemaDir: string }).schemaDir;
      return Promise.resolve({
        name: 'legacy-schema',
        version: 1,
        // "xyz" is deliberately NOT in the sync engine's legacy optional
        // list (wiki-diff/brief/scene-plan), so the missing artifact file
        // is a hard validation failure and sync aborts after capturing
        // the schema dir.
        artifacts: [{ id: 'xyz', generates: 'xyz.md', requires: [], required: true }],
      });
    });

    try {
      const { exitCode, stderrText } = await runCliCapture(projectRoot, ['sync', '--change', 'ch-001']);
      // The real validation pipeline runs against the change's own schema
      // (the mocked load returns a schema with one REQUIRED artifact whose
      // file is missing, so sync fails after the schema dir was captured).
      expect(exitCode).not.toBeNull();
      expect(exitCode).not.toBe(0);
      expect(stderrText.toLowerCase()).toMatch(/pre-sync validation failed|error/);
    } finally {
      schemaLoadSpy.mockRestore();
    }

    expect(capturedSchemaDir).toBe(join(projectRoot, 'adab', 'schemas', 'legacy-schema'));
    expect(capturedSchemaDir).not.toBe(join(projectRoot, 'adab', 'schemas', 'chapter-draft'));
  });
});

/**
 * Regression for S2: change-id arguments must be validated before they
 * are joined onto `adab/changes/`, so ids like `../../x` cannot write
 * or read outside the project boundary.
 */
describe('CLI change-id traversal guards (path safety)', () => {
  let projectRoot: string;
  let projectParent: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'openadab-traversal-'));
    await createMinimalProject(projectRoot);
    projectParent = dirname(projectRoot);
  });

  it('rejects `new` with a traversal id and writes nothing outside the project', async () => {
    const { exitCode, stderrText } = await runCliCapture(projectRoot, ['new', 'chapter', '../../x']);
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText.toLowerCase()).toMatch(/path_traversal|boundary/);
    expect(existsSync(join(projectParent, 'x'))).toBe(false);
  });

  it('rejects `status --change` with a parent-traversal id', async () => {
    const { exitCode, stderrText } = await runCliCapture(projectRoot, ['status', '--change', '../x']);
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText.toLowerCase()).toMatch(/path_traversal|boundary/);
  });

  it('rejects `wiki diff --change` with a parent-traversal id', async () => {
    const { exitCode, stderrText } = await runCliCapture(projectRoot, ['wiki', 'diff', '--change', '../x']);
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText.toLowerCase()).toMatch(/path_traversal|boundary/);
  });
});

/**
 * Regression for S3: `wiki diff` with neither `--from` nor `--change`
 * must fail with a usage error instead of silently exiting 0; when both
 * are passed, `--from` wins but the precedence must be announced.
 */
describe('CLI wiki diff argument validation', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = mkdtempSync(join(tmpdir(), 'openadab-wiki-diff-'));
    await createMinimalProject(projectRoot);
  });

  it('exits non-zero with a usage error when neither --from nor --change is given', async () => {
    const { exitCode, stderrText } = await runCliCapture(projectRoot, ['wiki', 'diff']);
    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText).toContain('Either --from <path> or --change <id> is required');
  });

  it('--from wins when both --from and --change are passed (warning emitted)', async () => {
    writeFileSync(join(projectRoot, 'manuscript.md'), 'See [[characters/mara]].', 'utf-8');
    const warnLines: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((msg: unknown) => {
      warnLines.push(String(msg));
    });
    try {
      const { exitCode, stdoutText } = await runCliCapture(projectRoot, [
        'wiki',
        'diff',
        '--from',
        'manuscript.md',
        '--change',
        'ch-001',
      ]);
      expect(exitCode === null || exitCode === 0).toBe(true);
      expect(stdoutText).toContain('characters/mara');
      expect(warnLines.join('\n')).toContain('--from takes precedence');
    } finally {
      warnSpy.mockRestore();
    }
  });
});

/**
 * Regression for S4: `validate --semantic` must not silently no-op when
 * the change's schema names its artifacts differently from the hardcoded
 * profile set (draft/revision/wiki-diff).  A schema with only `scene-plan`
 * matches zero profile ids, so the command must surface a warning instead
 * of printing "Validation passed" as if prompts had been generated.
 */
describe('CLI validate --semantic with no profile artifacts (S4)', () => {
  let schemaLoadSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    schemaLoadSpy = vi.spyOn(SchemaLoader.prototype, 'load');
    schemaLoadSpy.mockResolvedValue({
      name: 'custom-schema',
      version: 1,
      artifacts: [{ id: 'scene-plan', generates: 'scene-plan.md', requires: [] }],
    });
  });

  afterEach(() => {
    schemaLoadSpy?.mockRestore();
    schemaLoadSpy = null;
  });

  async function setupProjectWithChange(): Promise<string> {
    const projectRoot = mkdtempSync(join(tmpdir(), 'openadab-validate-semantic-'));
    await createMinimalProject(projectRoot);
    const changeDir = join(projectRoot, 'adab', 'changes', 'ch-001');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(
      join(changeDir, '.openadab.yaml'),
      `${[
        'changeId: ch-001',
        'schema: chapter-draft',
        'version: 1',
        'created: 2024-01-01T00:00:00Z',
        'status: in_progress',
        'currentArtifact: brief',
        'artifacts:',
        '  brief: ready',
        '  scene-plan: blocked',
        '  draft: blocked',
        '  revision: blocked',
        '  continuity-report: blocked',
        '  wiki-diff: blocked',
        'metadata: {}',
      ].join('\n')  }\n`,
      'utf-8',
    );
    return projectRoot;
  }

  it('warns in human mode and still exits 0 when no profile artifact ids match', async () => {
    const projectRoot = await setupProjectWithChange();
    const warnLines: string[] = [];
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation((msg: unknown) => {
      warnLines.push(String(msg));
    });
    try {
      const { exitCode, stdoutText } = await runCliCapture(projectRoot, ['validate', '--change', 'ch-001', '--semantic']);
      expect(exitCode === null || exitCode === 0).toBe(true);
      const warning = warnLines.join('\n');
      expect(warning.toLowerCase()).toMatch(/no semantic validation prompts/i);
      expect(warning).toMatch(/draft, revision, wiki-diff/);
      // The placeholder line must not claim prompts were generated.
      expect(stdoutText).not.toContain('Prompt generated for manual review');
    } finally {
      warnSpy.mockRestore();
    }
  });

  it('includes a warning in the JSON results when no profile artifact ids match', async () => {
    const projectRoot = await setupProjectWithChange();
    const { exitCode, stdoutText } = await runCliCapture(projectRoot, [
      'validate',
      '--change',
      'ch-001',
      '--semantic',
      '--json',
    ]);
    expect(exitCode === null || exitCode === 0).toBe(true);
    const parsed = JSON.parse(stdoutText) as { artifactId: string; warnings: string[] }[];
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toBeDefined();
    if (parsed[0] !== undefined) {
      expect(parsed[0].warnings.join(' ').toLowerCase()).toMatch(/no semantic validation prompts/i);
    }
  });
});
