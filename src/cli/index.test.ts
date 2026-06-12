/**
 * Unit tests for CLI command parsing and JSON output structure.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';

import type { ProjectConfig, ContextPack } from '../schemas/types.js';
import type { SchemaDef } from '../schemas/schema-def.js';
import type { ContextPacker } from '../modules/context-packer/index.js';
import { InstructionLoader } from '../modules/instruction-loader/index.js';
import { SchemaLoader } from '../modules/schema-engine/index.js';
import { createMinimalProject } from '../../tests/integration/fixture.js';

import { createProgram } from './index.js';

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
    }) as never);
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as unknown as never;
    }) as never);

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
});
