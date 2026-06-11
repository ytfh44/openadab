/**
 * Unit tests for the Project Config module.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { ConfigValidationError } from '../../utils/errors.js';

import { ConfigLoader, ConfigWriter, resolveVariable } from './index.js';


describe('ConfigLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-config-test-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads a valid config and applies defaults', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: Test Novel\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    const config = await loader.load();
    expect(config.schema).toBe('chapter-draft');
    expect(config.project.title).toBe('Test Novel');
    expect(config.project.language).toBe('zh-CN');
    expect(config.context.maxTokens).toBe(18000);
  });

  it('throws ConfigValidationError when config file is missing', async () => {
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('throws ConfigValidationError for invalid YAML', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, '{invalid: yaml: [', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('throws ConfigValidationError when validation fails', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: T\n  language: invalid-lang\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('getActiveSchema returns the loaded schema', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: custom-schema\nproject:\n  title: T\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await loader.load();
    expect(loader.getActiveSchema()).toBe('custom-schema');
  });

  it('getRules returns rules for an artifact', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\nrules:\n  draft:\n    - Maintain POV.\n',
      'utf-8'
    );
    const loader = new ConfigLoader(tempDir);
    await loader.load();
    expect(loader.getRules('draft')).toEqual(['Maintain POV.']);
  });

  it('getRules returns empty array for unknown artifact', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: T\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await loader.load();
    expect(loader.getRules('unknown')).toEqual([]);
  });

  it('getMaxTokens returns the token budget', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  maxTokens: 24000\n',
      'utf-8'
    );
    const loader = new ConfigLoader(tempDir);
    await loader.load();
    expect(loader.getMaxTokens()).toBe(24000);
  });

  it('getAlwaysInclude returns the always-include list', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude:\n    - adab/wiki/index.md\n',
      'utf-8'
    );
    const loader = new ConfigLoader(tempDir);
    await loader.load();
    expect(loader.getAlwaysInclude()).toEqual(['adab/wiki/index.md']);
  });

  it('throws if getters are called before load', () => {
    const loader = new ConfigLoader(tempDir);
    expect(() => loader.getActiveSchema()).toThrow(ConfigValidationError);
  });
});

describe('ConfigWriter', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-configwriter-test-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a valid config to YAML', async () => {
    const writer = new ConfigWriter(tempDir);
    const config = {
      schema: 'chapter-draft',
      version: 1,
      project: {
        title: 'Written Novel',
        language: 'zh-CN' as const,
        genre: 'sci-fi',
        tense: 'past' as const,
        pov: 'first-person' as const,
      },
      context: {
        maxTokens: 18000,
        alwaysInclude: [],
        tokenHeuristic: 'chars-per-token' as const,
        excludePatterns: [],
      },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    await writer.write(config);
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.project.title).toBe('Written Novel');
    expect(loaded.project.genre).toBe('sci-fi');
  });

  it('set updates a nested field and persists', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: Old\n', 'utf-8');
    const writer = new ConfigWriter(tempDir);
    await writer.set('project.title', 'New');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.project.title).toBe('New');
  });

  it('set creates intermediate objects if missing', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: T\n', 'utf-8');
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.maxTokens', 12000);
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.maxTokens).toBe(12000);
  });

  it('set throws if resulting config is invalid', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, 'schema: chapter-draft\nproject:\n  title: T\n', 'utf-8');
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('project.pov', 'invalid-pov')).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('set throws if config file is missing', async () => {
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('project.title', 'X')).rejects.toBeInstanceOf(ConfigValidationError);
  });
});

describe('ConfigWriter.set — nested path edge cases', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-configwriter-edge-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: Old\n  language: zh-CN\n  genre: fantasy\n  tense: past\n  pov: limited-third\ncontext:\n  maxTokens: 18000\n  alwaysInclude: []\n  tokenHeuristic: chars-per-token\n  excludePatterns: []\nrules:\n  draft: []\n  revision: []\narchive:\n  backupOnOverwrite: false\n',
      'utf-8'
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes a nested object path', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('project.title', 'New Title');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.project.title).toBe('New Title');
  });

  it('writes a numeric value', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.maxTokens', 99999);
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.maxTokens).toBe(99999);
  });

  it('writes into array index slots', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.alwaysInclude[0]', 'a');
    await writer.set('context.alwaysInclude[1]', 'b');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.alwaysInclude).toEqual(['a', 'b']);
  });

  it('writes into array slot created from object parent (rules.draft[0])', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('rules.draft[0]', 'first rule');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.rules.draft).toEqual(['first rule']);
  });

  it('writes into multiple sibling array slots under object parent', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('rules.draft[0]', 'a');
    await writer.set('rules.revision[0]', 'b');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.rules.draft).toEqual(['a']);
    expect(loaded.rules.revision).toEqual(['b']);
  });

  it('creates a new top-level path with passthrough', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('customTag', true);
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect((loaded as unknown as { customTag?: boolean }).customTag).toBe(true);
  });

  it('extends an array beyond its current length', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude: []\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.alwaysInclude[3]', 'd');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.alwaysInclude.length).toBeGreaterThanOrEqual(4);
    expect(loaded.context.alwaysInclude[3]).toBe('d');
  });

  it('throws ConfigValidationError when set produces invalid config', async () => {
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('project.tense', 'invalid-tense')).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('replaces the entire array when value is an array', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.alwaysInclude', ['x', 'y']);
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.alwaysInclude).toEqual(['x', 'y']);
  });
});

describe('resolveVariable', () => {
  const config = {
    schema: 'chapter-draft',
    version: 1,
    project: {
      title: 'The Black Library',
      language: 'zh-CN' as const,
      genre: 'fantasy',
      tense: 'past' as const,
      pov: 'limited-third' as const,
    },
    context: {
      maxTokens: 18000,
      alwaysInclude: [],
      tokenHeuristic: 'chars-per-token' as const,
      excludePatterns: [],
    },
    rules: {},
    archive: { backupOnOverwrite: false },
  };

  it('resolves a top-level config variable', () => {
    expect(resolveVariable('Schema: {{config.schema}}', config)).toBe('Schema: chapter-draft');
  });

  it('resolves a nested config variable', () => {
    expect(resolveVariable('POV: {{config.project.pov}}', config)).toBe('POV: limited-third');
  });

  it('resolves multiple variables', () => {
    const template = '{{config.project.title}} — {{config.project.genre}}';
    expect(resolveVariable(template, config)).toBe('The Black Library — fantasy');
  });

  it('returns unmodified string when no placeholders exist', () => {
    expect(resolveVariable('No placeholders here.', config)).toBe('No placeholders here.');
  });

  it('throws ConfigValidationError for unknown variable', () => {
    expect(() => resolveVariable('{{config.project.unknown}}', config)).toThrow(ConfigValidationError);
  });

  it('throws ConfigValidationError for intermediate missing path', () => {
    expect(() => resolveVariable('{{config.missing.field}}', config)).toThrow(ConfigValidationError);
  });
});
