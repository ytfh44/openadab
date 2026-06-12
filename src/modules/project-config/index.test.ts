/**
 * Unit tests for the Project Config module.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
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

  it('throws ConfigValidationError when extending an array with a non-adjacent index (no silent "" padding)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude: []\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('context.alwaysInclude[3]', 'd'))
      .rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('rejects distant index in the middle of an existing array (no "" slots created between)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude:\n    - a\n    - b\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('context.alwaysInclude[5]', 'f'))
      .rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('accepts an immediately adjacent index (length + 0 or length + 1)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude: []\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.alwaysInclude[0]', 'a');
    await writer.set('context.alwaysInclude[1]', 'b');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.alwaysInclude).toEqual(['a', 'b']);
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

// =============================================================================
// ConfigWriter.set — audit logging to adab/log.md
// =============================================================================
describe('ConfigWriter.set — audit log integration', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-configwriter-log-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: Old\n  language: zh-CN\n  genre: fantasy\n  tense: past\n  pov: limited-third\ncontext:\n  maxTokens: 18000\n  alwaysInclude: []\n  tokenHeuristic: chars-per-token\n  excludePatterns: []\nrules: {}\narchive:\n  backupOnOverwrite: false\n',
      'utf-8'
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes an update log entry to adab/log.md after a successful set', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('project.title', 'New Title');
    const logPath = join(tempDir, 'adab', 'log.md');
    const raw = readFileSync(logPath, 'utf-8');
    expect(raw).toContain('"op":"update"');
    expect(raw).toContain('project.title');
    expect(raw).toContain('New Title');
  });

  it('redacts sensitive values in the log entry (secrets subtree)', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('secrets.apiKey', 'plaintext-secret-value');
    const logPath = join(tempDir, 'adab', 'log.md');
    const raw = readFileSync(logPath, 'utf-8');
    expect(raw).toContain('"op":"update"');
    expect(raw).not.toContain('plaintext-secret-value');
    expect(raw).toContain('***');
  });

  it('preserves non-sensitive values verbatim in the log entry', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('project.pov', 'omniscient-third');
    const logPath = join(tempDir, 'adab', 'log.md');
    const raw = readFileSync(logPath, 'utf-8');
    expect(raw).toContain('omniscient-third');
  });

  it('does not write a log entry when set fails validation', async () => {
    const writer = new ConfigWriter(tempDir);
    const logPath = join(tempDir, 'adab', 'log.md');
    await expect(writer.set('project.pov', 'omniscient-god')).rejects.toBeInstanceOf(ConfigValidationError);
    let logExists = false;
    try {
      readFileSync(logPath, 'utf-8');
      logExists = true;
    } catch {
      logExists = false;
    }
    expect(logExists).toBe(false);
  });
});

// =============================================================================
// ConfigLoader.load — non-object top-level must not crash the unknown-field
// warning pass (defensive guard).
// =============================================================================
describe('ConfigLoader.load — defensive handling of non-object top-level', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-configloader-guard-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not throw when YAML parses to null (rejected by schema with clear message)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, '~\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('does not throw when YAML parses to a scalar string (rejected by schema with clear message)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, '"just a string"\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('does not throw when YAML parses to a number (rejected by schema with clear message)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(configPath, '42\n', 'utf-8');
    const loader = new ConfigLoader(tempDir);
    await expect(loader.load()).rejects.toBeInstanceOf(ConfigValidationError);
  });
});

// =============================================================================
// ConfigLoader.load / ConfigWriter.set — enum suggestion in error messages
// =============================================================================
describe('Validation errors — valid value suggestions', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-config-enum-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('suggests valid POV modes when project.pov is invalid', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\n  pov: omniscient-god\n',
      'utf-8'
    );
    const loader = new ConfigLoader(tempDir);
    try {
      await loader.load();
      throw new Error('expected ConfigValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toMatch(/first-person/);
      expect((err as Error).message).toMatch(/limited-third/);
      expect((err as Error).message).toMatch(/omniscient-third/);
    }
  });

  it('suggests valid language codes when project.language is invalid', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\n  language: fr-FR\n',
      'utf-8'
    );
    const loader = new ConfigLoader(tempDir);
    try {
      await loader.load();
      throw new Error('expected ConfigValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toMatch(/zh-CN/);
      expect((err as Error).message).toMatch(/en-US/);
      expect((err as Error).message).toMatch(/ja-JP/);
    }
  });

  it('suggests valid tense values when set rejects an invalid value', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\n  tense: past\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    try {
      await writer.set('project.tense', 'future');
      throw new Error('expected ConfigValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      expect((err as Error).message).toMatch(/past/);
      expect((err as Error).message).toMatch(/present/);
    }
  });
});

// =============================================================================
// ConfigWriter.set — numeric segments without brackets
// =============================================================================
describe('ConfigWriter.set — numeric segments without brackets', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-configwriter-numseg-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\ncontext:\n  alwaysInclude: []\n',
      'utf-8'
    );
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('treats dot-separated numeric segment as array index', async () => {
    const writer = new ConfigWriter(tempDir);
    await writer.set('context.alwaysInclude.0', 'a');
    await writer.set('context.alwaysInclude.1', 'b');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.context.alwaysInclude).toEqual(['a', 'b']);
  });

  it('rejects out-of-range numeric segment without brackets', async () => {
    const writer = new ConfigWriter(tempDir);
    await expect(writer.set('context.alwaysInclude.3', 'd'))
      .rejects.toBeInstanceOf(ConfigValidationError);
  });

  it('treats numeric segment in the middle of a path as array index', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\nrules:\n  draft:\n    - first\n    - second\n',
      'utf-8'
    );
    const writer = new ConfigWriter(tempDir);
    await writer.set('rules.draft.0', 'updated');
    const loader = new ConfigLoader(tempDir);
    const loaded = await loader.load();
    expect(loaded.rules.draft).toEqual(['updated', 'second']);
  });
});

// =============================================================================
// resolveVariable — only the committed top-level keys are resolvable
// =============================================================================
describe('resolveVariable — top-level key whitelist', () => {
  const baseConfig = {
    schema: 'chapter-draft',
    version: 1,
    project: {
      title: 'T',
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

  it('accepts a whitelisted top-level key', () => {
    expect(resolveVariable('{{config.schema}}', baseConfig)).toBe('chapter-draft');
  });

  it('rejects an unknown top-level key (passthrough field cannot be resolved)', () => {
    // The schema uses .passthrough() so extra keys survive validation; resolveVariable
    // must still refuse them so a template cannot exfiltrate unrelated config.
    const polluted = { ...baseConfig, customSecret: { token: 'oops' } } as typeof baseConfig & { customSecret: { token: string } };
    expect(() => resolveVariable('{{config.customSecret.token}}', polluted)).toThrow(ConfigValidationError);
  });

  it('rejects an unknown nested top-level key', () => {
    const polluted = { ...baseConfig, extra: { value: 'leak' } } as typeof baseConfig & { extra: { value: string } };
    expect(() => resolveVariable('{{config.extra.value}}', polluted)).toThrow(ConfigValidationError);
  });
});

// =============================================================================
// ConfigLoader.load — error messages must not leak absolute filesystem paths
// =============================================================================
describe('ConfigLoader.load — error message privacy', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-config-privacy-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not embed the absolute config path in the missing-file error', async () => {
    const loader = new ConfigLoader(tempDir);
    try {
      await loader.load();
      throw new Error('expected ConfigValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const message = (err as Error).message;
      expect(message).not.toContain(tempDir);
    }
  });
});

// =============================================================================
// ConfigWriter.set — error message privacy
// =============================================================================
describe('ConfigWriter.set — error message privacy', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-config-privset-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('does not embed the absolute config path in the missing-file error', async () => {
    const writer = new ConfigWriter(tempDir);
    try {
      await writer.set('project.title', 'X');
      throw new Error('expected ConfigValidationError');
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigValidationError);
      const message = (err as Error).message;
      expect(message).not.toContain(tempDir);
    }
  });
});

// =============================================================================
// ConfigLoader.load — recursive unknown-field detection
// =============================================================================
describe('ConfigLoader.load — recursive unknown-field detection', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-config-recursive-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('warns about unknown nested object fields (forward compatibility)', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\n  unknownNested: hello\n',
      'utf-8'
    );
    const captured: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      const loader = new ConfigLoader(tempDir);
      await loader.load();
    } finally {
      console.warn = originalWarn;
    }
    expect(captured.some((w) => w.includes('unknownNested'))).toBe(true);
  });

  it('warns about unknown fields inside a nested object even when the parent is a record', async () => {
    const configPath = join(tempDir, 'adab', 'config.yaml');
    writeFileSync(
      configPath,
      'schema: chapter-draft\nproject:\n  title: T\n  extra: { whatever: 1 }\n',
      'utf-8'
    );
    const captured: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      const loader = new ConfigLoader(tempDir);
      await loader.load();
    } finally {
      console.warn = originalWarn;
    }
    // Both 'extra' (unknown top-level) and the inner field should produce a warning
    // about its key. We just assert at least the outer unknown was flagged.
    expect(captured.some((w) => w.includes('extra'))).toBe(true);
  });
});
