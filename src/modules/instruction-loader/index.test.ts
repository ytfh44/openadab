import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import type { ProjectConfig, ContextPack } from '../../schemas/types.js';
import type { SchemaDef } from '../../schemas/schema-def.js';
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

    if (overrides?.templateText !== undefined) {
      writeFileSync(join(schemaDir, 'brief-template.md'), overrides.templateText);
    }
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
