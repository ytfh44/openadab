/**
 * Unit tests for the Schema Engine module.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { SchemaValidationError, AdabError, CycleDetectedError } from '../../utils/errors.js';

import {
  SchemaLoader,
  SchemaValidator,
  detectCycle,
  resolveTemplatePath,
  interpolateVariables,
  interpolateConfigVariables,
} from './index.js';


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
});
