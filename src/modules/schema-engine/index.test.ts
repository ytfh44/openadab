/**
 * Unit tests for the Schema Engine module.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import * as fsPromises from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import * as resourcePaths from '../../utils/resource-paths.js';
import { SchemaValidationError, AdabError, CycleDetectedError, UnresolvedVariableError } from '../../utils/errors.js';

import {
  SchemaLoader,
  SchemaValidator,
  detectCycle,
  resolveTemplatePath,
  interpolateVariables,
  interpolateConfigVariables,
} from './index.js';

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    readdir: vi.fn(actual.readdir),
  };
});


describe('SchemaLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-schema-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads a valid schema YAML', async () => {
    const schemaDir = join(tempDir, 'chapter-draft');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(
      join(schemaDir, 'schema.yaml'),
      `name: chapter-draft\nversion: 1\nartifacts:\n  - id: brief\n    generates: brief.md\n    requires: []\n`,
      'utf-8'
    );
    const loader = new SchemaLoader(schemaDir);
    const schema = await loader.load();
    expect(schema.name).toBe('chapter-draft');
    expect(schema.version).toBe(1);
    expect(schema.artifacts).toHaveLength(1);
  });

  it('throws SchemaValidationError when schema file is missing', async () => {
    const loader = new SchemaLoader(join(tempDir, 'missing'));
    await expect(loader.load()).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('throws SchemaValidationError for invalid YAML', async () => {
    const schemaDir = join(tempDir, 'bad');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'schema.yaml'), '{invalid', 'utf-8');
    const loader = new SchemaLoader(schemaDir);
    await expect(loader.load()).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('throws SchemaValidationError when validation fails', async () => {
    const schemaDir = join(tempDir, 'bad');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'schema.yaml'), 'version: 1\n', 'utf-8');
    const loader = new SchemaLoader(schemaDir);
    await expect(loader.load()).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('listBuiltInSchemas returns an array (may be empty in tests)', async () => {
    const loader = new SchemaLoader(tempDir);
    const list = await loader.listBuiltInSchemas();
    expect(Array.isArray(list)).toBe(true);
  });

  it('forkSchema throws for non-existent base schema', async () => {
    const loader = new SchemaLoader(tempDir);
    await expect(loader.forkSchema('nonexistent', 'my-copy')).rejects.toBeInstanceOf(SchemaValidationError);
  });
});

describe('SchemaLoader.forkSchema — path traversal guard', () => {
  let tempDir: string;
  let builtInDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-fork-guard-'));
    builtInDir = join(tempDir, 'built-in');
    mkdirSync(join(builtInDir, 'chapter-draft', 'templates'), { recursive: true });
    writeFileSync(
      join(builtInDir, 'chapter-draft', 'schema.yaml'),
      'name: chapter-draft\nversion: 1\nartifacts: []\n',
      'utf-8'
    );
    vi.spyOn(resourcePaths, 'resolveBuiltInSchemasDir').mockReturnValue(builtInDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('rejects a base name with traversal and writes nothing outside the built-in dir', async () => {
    const loader = new SchemaLoader(join(tempDir, 'schemas'));
    await expect(loader.forkSchema('../evil', 'x')).rejects.toBeInstanceOf(SchemaValidationError);
    // Without the guard, join(builtInDir, '../evil') would land in tempDir.
    expect(existsSync(join(tempDir, 'evil'))).toBe(false);
  });

  it('rejects a new name with traversal and writes nothing outside the schemas dir', async () => {
    const loader = new SchemaLoader(join(tempDir, 'schemas'));
    await expect(loader.forkSchema('chapter-draft', '../evil')).rejects.toBeInstanceOf(SchemaValidationError);
    // Without the guard, join(schemaDir, '../evil') would land in tempDir.
    expect(existsSync(join(tempDir, 'evil'))).toBe(false);
    // The destination directory must not be created at all.
    expect(existsSync(join(tempDir, 'schemas'))).toBe(false);
  });

  it('rejects absolute and separator-bearing names', async () => {
    const loader = new SchemaLoader(join(tempDir, 'schemas'));
    await expect(loader.forkSchema('/etc/passwd', 'x')).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(loader.forkSchema('chapter-draft', '/tmp/evil')).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(loader.forkSchema('chapter/draft', 'x')).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(loader.forkSchema('chapter-draft', 'evil\\name')).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('rejects empty names', async () => {
    const loader = new SchemaLoader(join(tempDir, 'schemas'));
    await expect(loader.forkSchema('', 'x')).rejects.toBeInstanceOf(SchemaValidationError);
    await expect(loader.forkSchema('chapter-draft', '')).rejects.toBeInstanceOf(SchemaValidationError);
  });

  it('still forks normally when both names are valid', async () => {
    const schemaDir = join(tempDir, 'schemas');
    const loader = new SchemaLoader(schemaDir);
    await loader.forkSchema('chapter-draft', 'my-fork');
    expect(existsSync(join(schemaDir, 'my-fork', 'templates'))).toBe(true);
    expect(readFileSync(join(schemaDir, 'my-fork', 'schema.yaml'), 'utf-8')).toContain('forked_from: chapter-draft');
  });
});

describe('SchemaLoader.listBuiltInSchemas (L9 — silent catch fix)', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-l9-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns [] when the built-in schemas directory cannot be located (resolveBuiltInSchemasDir throws)', async () => {
    vi.spyOn(resourcePaths, 'resolveBuiltInSchemasDir').mockImplementation(() => {
      throw new Error('Could not locate built-in schemas directory');
    });
    const loader = new SchemaLoader(tempDir);
    const list = await loader.listBuiltInSchemas();
    expect(list).toEqual([]);
  });

  it('rethrows non-ENOENT readdir errors (e.g. EACCES) instead of silently swallowing them', async () => {
    const fakeBuiltInDir = join(tempDir, 'fake-built-in');
    mkdirSync(fakeBuiltInDir, { recursive: true });
    vi.spyOn(resourcePaths, 'resolveBuiltInSchemasDir').mockReturnValue(fakeBuiltInDir);
    const eaccesErr: NodeJS.ErrnoException = new Error('permission denied');
    eaccesErr.code = 'EACCES';
    vi.mocked(fsPromises.readdir).mockRejectedValueOnce(eaccesErr);
    const loader = new SchemaLoader(tempDir);
    await expect(loader.listBuiltInSchemas()).rejects.toThrow('permission denied');
  });

  it('returns parsed schema directory names when the built-in directory is readable', async () => {
    const fakeBuiltInDir = join(tempDir, 'fake-built-in');
    mkdirSync(join(fakeBuiltInDir, 'schema-a'), { recursive: true });
    mkdirSync(join(fakeBuiltInDir, 'schema-b'), { recursive: true });
    writeFileSync(join(fakeBuiltInDir, 'noise.md'), 'not a directory');
    vi.spyOn(resourcePaths, 'resolveBuiltInSchemasDir').mockReturnValue(fakeBuiltInDir);
    const loader = new SchemaLoader(tempDir);
    const list = await loader.listBuiltInSchemas();
    expect(list).toContain('schema-a');
    expect(list).toContain('schema-b');
    expect(list).not.toContain('noise.md');
  });

  it('returns [] and does not throw when the resolved directory disappears between resolve and readdir (ENOENT race)', async () => {
    const fakeBuiltInDir = join(tempDir, 'fake-built-in');
    mkdirSync(fakeBuiltInDir, { recursive: true });
    rmSync(fakeBuiltInDir, { recursive: true, force: true });
    vi.spyOn(resourcePaths, 'resolveBuiltInSchemasDir').mockReturnValue(fakeBuiltInDir);
    const loader = new SchemaLoader(tempDir);
    const list = await loader.listBuiltInSchemas();
    expect(list).toEqual([]);
  });
});

describe('SchemaValidator', () => {
  it('passes for a valid schema', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'chapter-draft',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ],
      apply: { requires: ['draft'], target: 'out.md', action: 'copy' as const },
    };
    const result = await validator.validate(schema);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for duplicate artifact IDs', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'bad',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'a.md', requires: [] },
        { id: 'brief', generates: 'b.md', requires: [] },
      ],
    };
    const result = await validator.validate(schema);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate artifact ID'))).toBe(true);
  });

  it('fails when apply.requires references unknown artifact', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'bad',
      version: 1,
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [] }],
      apply: { requires: ['missing'], target: 'out.md', action: 'copy' as const },
    };
    const result = await validator.validate(schema);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('apply.requires'))).toBe(true);
  });

  it('fails when artifact requires unknown artifact', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'bad',
      version: 1,
      artifacts: [{ id: 'draft', generates: 'draft.md', requires: ['missing'] }],
    };
    const result = await validator.validate(schema);
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes("requires unknown artifact ID"))).toBe(true);
  });

  it('fails when template file is missing', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'bad',
      version: 1,
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [], template: 'templates/missing.md' }],
    };
    const result = await validator.validate(schema, '/nonexistent/schema/dir');
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('Template not found'))).toBe(true);
  });

  it('reports cycle error', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'cycle',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: ['b'] },
        { id: 'b', generates: 'b.md', requires: ['c'] },
        { id: 'c', generates: 'c.md', requires: ['a'] },
      ],
    };
    await expect(validator.validate(schema)).rejects.toBeInstanceOf(CycleDetectedError);
  });

  it('SC-3: does not duplicate errors for name/version (zod has already enforced them)', async () => {
    const validator = new SchemaValidator();
    const schema = {
      name: 'good',
      version: 2,
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
    };
    const result = await validator.validate(schema);
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});

describe('SchemaLoader SC-7 context multi-type', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-sc7-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('accepts numeric and boolean values in the schema context', async () => {
    const schemaDir = join(tempDir, 'ctx');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(
      join(schemaDir, 'schema.yaml'),
      [
        'name: ctx-schema',
        'version: 1',
        'context:',
        '  chapter: "001"',
        '  count: 42',
        '  enabled: true',
        'artifacts:',
        '  - id: a',
        '    generates: a.md',
        '    requires: []',
        '',
      ].join('\n'),
      'utf-8'
    );
    const loader = new SchemaLoader(schemaDir);
    const schema = await loader.load();
    expect(schema.context).toEqual({ chapter: '001', count: 42, enabled: true });
  });
});

describe('detectCycle', () => {
  it('returns null for acyclic graph', () => {
    const artifacts = [
      { id: 'a', generates: 'a.md', requires: [] },
      { id: 'b', generates: 'b.md', requires: ['a'] },
      { id: 'c', generates: 'c.md', requires: ['b'] },
    ];
    expect(detectCycle(artifacts)).toBeNull();
  });

  it('detects a 3-node cycle', () => {
    const artifacts = [
      { id: 'a', generates: 'a.md', requires: ['b'] },
      { id: 'b', generates: 'b.md', requires: ['c'] },
      { id: 'c', generates: 'c.md', requires: ['a'] },
    ];
    const cycle = detectCycle(artifacts);
    expect(cycle).not.toBeNull();
    expect(cycle![0]).toBe('a');
    expect(cycle![cycle!.length - 1]).toBe('a');
  });

  it('detects self-loop', () => {
    const artifacts = [{ id: 'a', generates: 'a.md', requires: ['a'] }];
    const cycle = detectCycle(artifacts);
    expect(cycle).not.toBeNull();
    expect(cycle).toEqual(['a', 'a']);
  });

  it('ignores missing dependency nodes', () => {
    const artifacts = [{ id: 'a', generates: 'a.md', requires: ['missing'] }];
    expect(detectCycle(artifacts)).toBeNull();
  });

  it('SC-4: throws CycleDetectedError listing missing refs when knownIds is supplied and a dep is unknown', () => {
    const artifacts = [{ id: 'a', generates: 'a.md', requires: ['missing'] }];
    expect(() => detectCycle(artifacts, undefined, new Set(['a'])))
      .toThrow(CycleDetectedError);
  });

  it('SC-10: cycle path does not contain the synthetic "apply" virtual node', () => {
    // Build a cycle: b -> apply -> c -> b, and tell detectCycle that
    // b/c/apply are all known so it actually walks the cycle.
    const artifacts = [
      { id: 'b', generates: 'b.md', requires: ['apply'] },
      { id: 'c', generates: 'c.md', requires: ['b'] },
    ];
    const cycle = detectCycle(artifacts, ['c'], new Set(['b', 'c', 'apply']));
    expect(cycle).not.toBeNull();
    expect(cycle).not.toContain('apply');
  });
});

describe('resolveTemplatePath', () => {
  it('resolves relative to schema directory', () => {
    const resolved = resolveTemplatePath('/project/schemas/chapter-draft', 'templates/brief.md');
    expect(resolved).toContain('project');
    expect(resolved).toContain('schemas');
    expect(resolved).toContain('chapter-draft');
    expect(resolved).toContain('templates');
    expect(resolved).toContain('brief.md');
  });
});

describe('interpolateVariables', () => {
  it('replaces placeholders with context values', () => {
    expect(interpolateVariables('Hello {{name}}', { name: 'World' })).toBe('Hello World');
  });

  it('replaces multiple placeholders', () => {
    expect(interpolateVariables('{{a}} and {{b}}', { a: '1', b: '2' })).toBe('1 and 2');
  });

  it('throws AdabError for missing variable', () => {
    expect(() => interpolateVariables('{{missing}}', {})).toThrow(AdabError);
  });

  it('SC-8: aggregates repeated missing variables into a single error message', () => {
    let caught: unknown;
    try {
      interpolateVariables('{{a}} and {{b}} and {{a}}', {});
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AdabError);
    const message = (caught as Error).message;
    expect(message).toContain('{{a}}');
    expect(message).toContain('{{b}}');
    // a is referenced twice but reported only once
    const matches = message.match(/\{\{a\}\}/g) ?? [];
    expect(matches.length).toBe(1);
  });

  it('SC-8: reports all missing variables when there are several distinct ones', () => {
    expect(() => interpolateVariables('{{x}}-{{y}}-{{z}}', {}))
      .toThrow(/x.*y.*z|y.*x.*z/);
  });

  it('SC-7: stringifies non-string context values (number/boolean) when interpolating', () => {
    expect(interpolateVariables('count={{count}} enabled={{flag}}', { count: 42, flag: true }))
      .toBe('count=42 enabled=true');
  });

  it('returns unmodified text when no placeholders', () => {
    expect(interpolateVariables('plain text', {})).toBe('plain text');
  });
});

describe('interpolateConfigVariables', () => {
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

  it('resolves top-level config variable', () => {
    expect(interpolateConfigVariables('Schema: {{config.schema}}', config)).toBe('Schema: chapter-draft');
  });

  it('resolves nested config variable', () => {
    expect(interpolateConfigVariables('POV: {{config.project.pov}}', config)).toBe('POV: limited-third');
  });

  it('resolves multiple config variables', () => {
    const template = '{{config.project.title}} — {{config.project.genre}}';
    expect(interpolateConfigVariables(template, config)).toBe('The Black Library — fantasy');
  });

  it('throws AdabError for unknown config path', () => {
    expect(() => interpolateConfigVariables('{{config.project.unknown}}', config)).toThrow(AdabError);
  });

  it('throws AdabError for intermediate missing path', () => {
    expect(() => interpolateConfigVariables('{{config.missing.field}}', config)).toThrow(AdabError);
  });

  it('SC-6: throws AdabError (not TypeError) for extra path segments past a leaf string', () => {
    expect(() => interpolateConfigVariables('{{config.project.title.extra}}', config))
      .toThrow(AdabError);
  });

  it('SC-6: throws AdabError for extra path segments past a numeric leaf', () => {
    expect(() => interpolateConfigVariables('{{config.context.maxTokens.bogus}}', config))
      .toThrow(AdabError);
  });
});
