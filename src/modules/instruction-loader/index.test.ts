import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import type { SchemaDef } from '../../schemas/schema-def.js';
import type { ProjectConfig, ContextPack } from '../../schemas/types.js';
import { UnresolvedVariableError, TemplateNotFoundError } from '../../utils/errors.js';
import type { ContextPacker } from '../context-packer/index.js';

import { InstructionLoader } from './index.js';

describe('InstructionLoader', () => {
  function setupLoader(overrides?: { schema?: SchemaDef; config?: ProjectConfig; templateText?: string; instructionFileText?: string }) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });

    const schema: SchemaDef = overrides?.schema ?? {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [], template: 'brief-template.md' },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ],
      apply: { requires: ['brief', 'draft'], target: 'chapters/ch-001.md', action: 'copy' as const },
    };

    // Always materialize the schema-declared template file (empty by
    // default): loadTemplate now throws when a declared template is
    // missing from disk, so tests that do not exercise the missing-file
    // path must provide the file.
    writeFileSync(join(schemaDir, 'brief-template.md'), overrides?.templateText ?? '');
    if (overrides?.instructionFileText !== undefined) {
      writeFileSync(join(schemaDir, 'instructions.md'), overrides.instructionFileText);
      schema.artifacts[1].instructionFile = 'instructions.md';
    }

    const config: ProjectConfig = overrides?.config ?? {
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

    const loader = new InstructionLoader(schema, config, contextPacker, 'ch-001');
    return { root, loader, contextPacker };
  }

  it('assembles basic instruction payload', async () => {
    const { loader } = setupLoader();
    const payload = await loader.loadInstructions('brief');
    expect(payload.artifact).toBe('brief');
    expect(payload.change).toBe('ch-001');
    expect(payload.outputPath).toContain('brief.md');
    expect(payload.rules).toEqual([]);
  });

  it('interpolates template variables', async () => {
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      context: { povName: 'Alice', genre: 'fantasy' },
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [], template: 'brief-template.md' }],
    };
    const { loader } = setupLoader({ schema, templateText: 'Write a {{genre}} story from {{povName}} POV.' });
    const payload = await loader.loadInstructions('brief');
    expect(payload.template).toContain('Write a fantasy story from Alice POV.');
  });

  it('injects rules from config', async () => {
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: { brief: ['Rule A', 'Rule B'] },
      archive: { backupOnOverwrite: false },
    };
    const { loader } = setupLoader({ config });
    const payload = await loader.loadInstructions('brief');
    expect(payload.rules).toEqual(['Rule A', 'Rule B']);
    expect(payload.instruction).toContain('Rule A');
  });

  it('emits missing dependency warning', async () => {
    const { root, loader } = setupLoader();
    const changePath = join(root, 'adab', 'changes', 'ch-001');
    mkdirSync(changePath, { recursive: true });
    // brief.md is missing
    const payload = await loader.loadInstructions('draft', true);
    expect(payload.dependencyContent).toBeDefined();
    expect(payload.dependencyContent?.brief).toMatch(/missing/i);
  });
});

// =============================================================================
// Constructor rejects change IDs that escape the project root's changes dir.
// =============================================================================
describe('InstructionLoader constructor — changeDir must stay under adab/changes/', () => {
  function setupContext() {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-ct-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [] }],
    };
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, schema, config, contextPacker };
  }

  it('throws PathTraversalError for a changeDir that contains ".."', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, '../etc/passwd'))
      .toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for an absolute path that escapes the project', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, '/etc/passwd'))
      .toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for a changeDir with a nested ".." segment', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, '..', '..', 'evil.md'))
      .toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for a changeDir that collapses into the changes root ("foo/..")', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, 'foo/..'))
      .toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for a bare ".."', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, '..'))
      .toThrow(/Path traversal/);
  });

  it('throws PathTraversalError for a changeDir of "."', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, '.'))
      .toThrow(/Path traversal/);
  });

  it('accepts a normal change ID like "ch-001"', () => {
    const { schema, config, contextPacker } = setupContext();
    expect(() => new InstructionLoader(schema, config, contextPacker, 'ch-001'))
      .not.toThrow();
  });
});

// =============================================================================
// loadTemplate — error propagation: a failed interpolation must surface as a
// thrown UnresolvedVariableError (not be silently replaced with markers).
// =============================================================================
describe('InstructionLoader.loadTemplate — interpolation errors propagate', () => {
  function setupContext(templateText: string) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-tpl-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'brief-template.md'), templateText);
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [], template: 'brief-template.md' }],
    };
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, loader: new InstructionLoader(schema, config, contextPacker, 'ch-001') };
  }

  afterEach(() => {
    // Best-effort cleanup; temp roots are per-test.
  });

  it('throws when a plain {{variable}} cannot be resolved (no marker replacement)', async () => {
    const { loader } = setupContext('Hello {{unknown}} world');
    await expect(loader.loadTemplate('brief')).rejects.toBeInstanceOf(UnresolvedVariableError);
  });

  it('throws when a {{config.*}} placeholder references a missing path', async () => {
    const { loader } = setupContext('Hello {{config.project.nonexistent}}');
    await expect(loader.loadTemplate('brief')).rejects.toBeInstanceOf(UnresolvedVariableError);
  });

  it('does not emit "[unresolved:" marker text on failure', async () => {
    const { loader } = setupContext('Hello {{unknown}} world');
    let thrown: unknown = null;
    try {
      await loader.loadTemplate('brief');
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(UnresolvedVariableError);
  });
});

// =============================================================================
// loadTemplate — mergedContext overlap detection
// =============================================================================
describe('InstructionLoader.loadTemplate — context overlap', () => {
  function setupContextWithOverlaps() {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-overlap-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'brief-template.md'), 'Hello {{povName}}');
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      context: { povName: 'FromSchema' },
      artifacts: [{ id: 'brief', generates: 'brief.md', requires: [], template: 'brief-template.md' }],
    };
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, schema, config, contextPacker };
  }

  it('warns when changeContext shadows a schemaContext key', async () => {
    const { schema, config, contextPacker } = setupContextWithOverlaps();
    const loader = new InstructionLoader(schema, config, contextPacker, 'ch-001', { povName: 'FromChange' });
    const captured: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await loader.loadTemplate('brief');
    } finally {
      console.warn = originalWarn;
    }
    expect(captured.length).toBeGreaterThan(0);
    expect(captured.some((w) => w.includes('povName') && /overlap|shadow|overrid/i.test(w))).toBe(true);
  });

  it('does not warn when changeContext introduces new keys only', async () => {
    const { schema, config, contextPacker } = setupContextWithOverlaps();
    const loader = new InstructionLoader(schema, config, contextPacker, 'ch-001', { freshKey: 'value' });
    const captured: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await loader.loadTemplate('brief');
    } finally {
      console.warn = originalWarn;
    }
    expect(captured.some((w) => /overlap|shadow|overrid/i.test(w))).toBe(false);
  });

  it('changeContext value wins on collision (documented precedence)', async () => {
    const { schema, config, contextPacker } = setupContextWithOverlaps();
    const loader = new InstructionLoader(schema, config, contextPacker, 'ch-001', { povName: 'FromChange' });
    const text = await loader.loadTemplate('brief');
    expect(text).toBe('Hello FromChange');
  });
});

// =============================================================================
// loadInstructions — warnings field (independent of the concatenated instruction text)
// =============================================================================
describe('InstructionLoader.loadInstructions — independent warnings field', () => {
  function setupLoader(overrides?: { schema?: SchemaDef; config?: ProjectConfig; templateText?: string }) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-warn-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema: SchemaDef = overrides?.schema ?? {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ],
    };
    if (overrides?.templateText !== undefined) {
      writeFileSync(join(schemaDir, 'brief-template.md'), overrides.templateText);
    }
    const config: ProjectConfig = overrides?.config ?? {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    const loader = new InstructionLoader(schema, config, contextPacker, 'ch-001');
    return { root, loader, contextPacker };
  }

  it('exposes missing-dependency warnings as a separate warnings array', async () => {
    const { root, loader } = setupLoader();
    mkdirSync(join(root, 'adab', 'changes', 'ch-001'), { recursive: true });
    const payload = await loader.loadInstructions('draft', false);
    expect(Array.isArray(payload.warnings)).toBe(true);
    expect(payload.warnings.length).toBeGreaterThan(0);
    expect(payload.warnings.join(' ')).toMatch(/missing/i);
  });

  it('exposes an empty warnings array when no dependencies are missing', async () => {
    const { loader } = setupLoader();
    const payload = await loader.loadInstructions('brief', false);
    expect(payload.warnings).toEqual([]);
  });

  it('does not duplicate warnings inside the concatenated instruction string', async () => {
    const { root, loader } = setupLoader();
    mkdirSync(join(root, 'adab', 'changes', 'ch-001'), { recursive: true });
    const payload = await loader.loadInstructions('draft', false);
    const inInstruction = (payload.instruction.match(/Warning:/g) ?? []).length;
    const inWarnings = payload.warnings.filter((w) => w.startsWith('Warning:')).length;
    expect(inInstruction).toBe(inWarnings);
  });
});

// =============================================================================
// loadTemplate / loadInstructions — a schema-declared template file that is
// missing from disk must throw TemplateNotFoundError instead of silently
// producing an empty instruction.
// =============================================================================
describe('InstructionLoader.loadTemplate — missing template file', () => {
  function setupContext(missingInstructionFile = false) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-mtpl-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [], template: 'missing-template.md' },
        { id: 'draft', generates: 'draft.md', requires: [], instructionFile: 'missing-instructions.md' },
      ],
    };
    if (missingInstructionFile) {
      delete schema.artifacts[0].template;
    }
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, loader: new InstructionLoader(schema, config, contextPacker, 'ch-001') };
  }

  it('loadTemplate throws TemplateNotFoundError when the declared template file is missing', async () => {
    const { loader } = setupContext();
    await expect(loader.loadTemplate('brief')).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it('loadInstructions propagates the TemplateNotFoundError instead of returning an empty instruction', async () => {
    const { loader } = setupContext();
    await expect(loader.loadInstructions('brief')).rejects.toBeInstanceOf(TemplateNotFoundError);
  });

  it('warns (and falls back to the inline instruction) when instructionFile is missing', async () => {
    const { loader } = setupContext(true);
    const captured: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      captured.push(args.map((a) => String(a)).join(' '));
    };
    try {
      await loader.loadInstructions('draft');
    } finally {
      console.warn = originalWarn;
    }
    expect(captured.some((w) => w.includes('instructionFile') && w.includes('not found'))).toBe(true);
  });
});

// =============================================================================
// loadInstructions — requiredReads handles missing dependency IDs consistently
// =============================================================================
describe('InstructionLoader.loadInstructions — requiredReads when dep is unknown', () => {
  function setupLoaderWithPhantomDep() {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-phantom-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'draft', generates: 'draft.md', requires: ['phantom-dep', 'brief'] },
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
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, loader: new InstructionLoader(schema, config, contextPacker, 'ch-001') };
  }

  it('marks missing dependencies with an unknown: prefix in requiredReads', async () => {
    const { loader } = setupLoaderWithPhantomDep();
    const payload = await loader.loadInstructions('draft', false);
    expect(payload.requiredReads.some((p) => p === 'unknown:phantom-dep')).toBe(true);
  });

  it('includes real paths for known dependencies alongside the unknown marker', async () => {
    const { root, loader } = setupLoaderWithPhantomDep();
    mkdirSync(join(root, 'adab', 'changes', 'ch-001'), { recursive: true });
    const payload = await loader.loadInstructions('draft', false);
    const knownPaths = payload.requiredReads.filter((p) => !p.startsWith('unknown:'));
    expect(knownPaths).toHaveLength(1);
    expect(knownPaths[0]).toContain('brief.md');
  });
});

// =============================================================================
// loadDependencyContent — no dead try/catch (the main flow guarantees the
// artifact exists by the time this method is reached).
// =============================================================================
describe('InstructionLoader.loadDependencyContent — direct execution', () => {
  function setupLoader() {
    const root = mkdtempSync(join(tmpdir(), 'openadab-il-ldc-'));
    const schemaDir = join(root, 'adab', 'schemas', 'test-schema');
    mkdirSync(schemaDir, { recursive: true });
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [{ id: 'draft', generates: 'draft.md', requires: ['brief'] }],
    };
    const config: ProjectConfig = {
      schema: 'test-schema',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: false },
    };
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    return { root, loader: new InstructionLoader(schema, config, contextPacker, 'ch-001') };
  }

  it('returns an empty map when inline=false', async () => {
    const { loader } = setupLoader();
    const result = await loader.loadDependencyContent('draft', false);
    expect(result).toEqual({});
  });

  it('returns a warning for a missing dependency file when inline=true', async () => {
    const { root, loader } = setupLoader();
    mkdirSync(join(root, 'adab', 'changes', 'ch-001'), { recursive: true });
    const result = await loader.loadDependencyContent('draft', true);
    expect(result.brief).toMatch(/missing/i);
  });

  it('reads dependency file content when present and inline=true', async () => {
    const { root, loader } = setupLoader();
    const changePath = join(root, 'adab', 'changes', 'ch-001');
    mkdirSync(changePath, { recursive: true });
    writeFileSync(join(changePath, 'brief.md'), 'BRIEF CONTENT');
    // The schema above does not declare 'brief' as an artifact; rebuild with one:
    const schema: SchemaDef = {
      name: 'test-schema',
      version: 1,
      artifacts: [
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
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
    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
      projectRootPath: root,
    } as unknown as ContextPacker;
    const freshLoader = new InstructionLoader(schema, config, contextPacker, 'ch-001');
    const result = await freshLoader.loadDependencyContent('draft', true);
    expect(result.brief).toBe('BRIEF CONTENT');
  });
});
