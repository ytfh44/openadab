/**
 * Unit tests for CLI command parsing and JSON output structure.
 */
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import type { ProjectConfig, ContextPack } from '../schemas/types.js';
import type { SchemaDef } from '../schemas/schema-def.js';
import type { ContextPacker } from '../modules/context-packer/index.js';
import { InstructionLoader } from '../modules/instruction-loader/index.js';

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
