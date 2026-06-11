import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import type { SchemaDef } from '../../schemas/schema-def.js';
import type { WikiEngine } from '../wiki-engine/index.js';

import { MechanicalValidator } from './index.js';

describe('MechanicalValidator', () => {
  function setupValidator(overrides?: { schema?: SchemaDef; projectConfig?: any; wikiPages?: Record<string, string> }) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-mv-'));

    const schema: SchemaDef = overrides?.schema ?? {
      name: 'test',
      version: 1,
      artifacts: [
        { id: 'draft', generates: 'draft.md', requires: [], validation: { mechanical: ['minWords:10', 'maxWords:100'] } },
        { id: 'wiki-diff', generates: 'wiki-diff.md', requires: [] },
      ],
    };

    const schemaEngine = {
      load: vi.fn().mockResolvedValue(schema),
    };

    const projectConfig = overrides?.projectConfig ?? {
      project: { language: 'en-US' },
    };

    const wikiEngine = {
      listPages: vi.fn().mockResolvedValue(Object.keys(overrides?.wikiPages ?? {})),
      readPage: vi.fn().mockImplementation((path: string) => {
        const key = path.endsWith('.md') ? path.slice(0, -3) : path;
        const body = overrides?.wikiPages?.[key] ?? overrides?.wikiPages?.[path];
        if (body === undefined) {throw new Error('Not found');}
        return Promise.resolve({ path, frontmatter: { name: path, type: 'other' }, body });
      }),
    } as unknown as WikiEngine;

    const validator = new MechanicalValidator(schemaEngine, projectConfig, wikiEngine, root);
    return { root, validator, schemaEngine };
  }

  it('valid artifact passes', async () => {
    const { root, validator } = setupValidator();
    const changeDir = join(root, 'change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nThis is a valid draft with enough words here.');
    const result = await validator.validateArtifact(changeDir, 'draft');
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('missing file fails', async () => {
    const { root, validator } = setupValidator();
    const changeDir = join(root, 'change');
    mkdirSync(changeDir, { recursive: true });
    const result = await validator.validateArtifact(changeDir, 'draft');
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('missing'))).toBe(true);
  });

  it('broken wiki link fails', async () => {
    const { root, validator } = setupValidator({ wikiPages: {} });
    const changeDir = join(root, 'change');
    mkdirSync(changeDir, { recursive: true });
    writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nSee [[MissingPage]].');
    const result = await validator.validateArtifact(changeDir, 'wiki-diff');
    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('Broken wiki link'))).toBe(true);
  });

  it('non-consecutive chapters warning', async () => {
    const { root, validator } = setupValidator();
    const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
    mkdirSync(chaptersDir, { recursive: true });
    writeFileSync(join(chaptersDir, 'ch-001.md'), '');
    writeFileSync(join(chaptersDir, 'ch-003.md'), '');
    const result = await validator.chapterSequence();
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.some((w) => w.includes('Gap'))).toBe(true);
  });

  describe('schemaCompliance', () => {
    it('passes when frontmatter is present and word count is in range', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nThis is a valid draft with enough words here to meet the minimum.');
      const result = await validator.schemaCompliance(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('produces warnings when word count is out of range', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nshort.');
      const result = await validator.schemaCompliance(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings.some((w) => w.includes('Word count'))).toBe(true);
    });
  });

  describe('frontmatterPresent', () => {
    it('passes when frontmatter is present', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nBody.');
      const result = await validator.frontmatterPresent(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when frontmatter is missing', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'draft', generates: 'draft.md', requires: [], validation: { mechanical: ['minWords:10', 'maxWords:100', 'frontmatterPresent'] } },
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: [] },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), 'No frontmatter here.');
      const result = await validator.frontmatterPresent(changeDir, 'draft');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('Frontmatter missing'))).toBe(true);
    });

    it('does not crash when artifact is not found in schema (parseRules receives undefined)', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // Artifact 'nonexistent' is not in the schema -> parseRules(undefined)
      const result = await validator.frontmatterPresent(changeDir, 'nonexistent');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('handles requireField rules without crashing and reports missing required fields', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            {
              id: 'draft',
              generates: 'draft.md',
              requires: [],
              validation: { mechanical: ['frontmatterPresent', 'requireField:title', 'requireField:status'] },
            },
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: [] },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // File has frontmatter but missing 'status' field
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nBody.');
      const result = await validator.frontmatterPresent(changeDir, 'draft');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes("Required frontmatter field 'status' is missing"))).toBe(true);
    });
  });

  describe('fileExists', () => {
    it('passes when file exists', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n');
      const result = await validator.fileExists(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when file does not exist', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      const result = await validator.fileExists(changeDir, 'draft');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('missing'))).toBe(true);
    });
  });

  describe('wordCount', () => {
    it('counts English words correctly and respects min/max boundaries', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\none two three four five six seven eight nine ten.');
      const result = await validator.wordCount(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns when English word count is below min', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nshort.');
      const result = await validator.wordCount(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('below minimum'))).toBe(true);
    });

    it('counts Chinese characters as words', async () => {
      const { root, validator } = setupValidator({
        projectConfig: { project: { language: 'zh-CN' } },
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'draft', generates: 'draft.md', requires: [], validation: { mechanical: ['minWords:5', 'maxWords:20'] } },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\n这是一个中文测试文本。');
      const result = await validator.wordCount(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns when Chinese character count exceeds max', async () => {
      const { root, validator } = setupValidator({
        projectConfig: { project: { language: 'zh-CN' } },
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'draft', generates: 'draft.md', requires: [], validation: { mechanical: ['minWords:1', 'maxWords:5'] } },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\n这是一个中文测试文本。');
      const result = await validator.wordCount(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('above maximum'))).toBe(true);
    });
  });

  describe('validateConfig', () => {
    it('passes with a valid config file', async () => {
      const { root, validator } = setupValidator();
      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        'schema: chapter-draft\nversion: 1\nproject:\n  title: Test Novel\n  language: en-US\n  genre: fantasy\n  tense: past\n  pov: limited-third\n'
      );
      const result = await validator.validateConfig();
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when config file is missing', async () => {
      const { validator } = setupValidator();
      const result = await validator.validateConfig();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('not found'))).toBe(true);
    });

    it('fails when config YAML is invalid', async () => {
      const { root, validator } = setupValidator();
      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(join(configDir, 'config.yaml'), 'not: valid: yaml: [');
      const result = await validator.validateConfig();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('Failed to parse'))).toBe(true);
    });

    it('fails when config content is invalid', async () => {
      const { root, validator } = setupValidator();
      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        'schema: chapter-draft\nversion: not-a-number\nproject:\n  title: Test Novel\n'
      );
      const result = await validator.validateConfig();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('validation failed'))).toBe(true);
    });
  });

  describe('validateChange', () => {
    it('aggregates artifact results plus chapterSequence and validateConfig', async () => {
      const { root, validator } = setupValidator({ wikiPages: { ExistingPage: 'body' } });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nThis is a valid draft with enough words here.');
      writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nSee [[ExistingPage]].');

      const chaptersDir = join(root, 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-002.md'), '');

      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        'schema: chapter-draft\nversion: 1\nproject:\n  title: Test Novel\n  language: en-US\n  genre: fantasy\n  tense: past\n  pov: limited-third\n'
      );

      const results = await validator.validateChange(changeDir);
      const result = results.find(r => r.artifactId === 'all');
      expect(result).toBeDefined();
      expect(result?.artifactId).toBe('all');
      expect(result?.passed).toBe(true);
      expect(result?.errors).toHaveLength(0);
    });
  });

  describe('chapterSequence', () => {
    it('passes when chapters are consecutive starting from 1', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-002.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });

    it('warns when chapters have a gap (warning, not error)', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(true);
      expect(result.warnings.some((w) => w.includes('Gap'))).toBe(true);
    });

    it('fails when chapters do not start at 1', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-002.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('start at ch-001'))).toBe(true);
    });
  });

  describe('wikiLinkValidity', () => {
    it('passes when wiki link target exists via wikiEngine', async () => {
      const { root, validator } = setupValidator({ wikiPages: { ExistingPage: 'body' } });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nSee [[ExistingPage]].');
      const result = await validator.wikiLinkValidity(changeDir, 'wiki-diff');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('requireNonEmpty', () => {
    it('passes when file has non-empty content', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nBody text.');
      const result = await validator.requireNonEmpty(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('fails when file is empty', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '');
      const result = await validator.requireNonEmpty(changeDir, 'draft');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });
  });

  describe('MechanicalValidator.parseRules — default requireNonEmpty', () => {
    it('does NOT enforce non-empty when artifact has no validation block', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'foo', generates: 'foo.md', requires: [] },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'foo.md'), '');
      const result = await validator.validateArtifact(changeDir, 'foo');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('does NOT enforce non-empty when mechanical rules array is empty', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'foo', generates: 'foo.md', requires: [], validation: { mechanical: [] } },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'foo.md'), '');
      const result = await validator.validateArtifact(changeDir, 'foo');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('enforces non-empty when schema explicitly opts in via requireNonEmpty rule', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'foo', generates: 'foo.md', requires: [], validation: { mechanical: ['requireNonEmpty'] } },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'foo.md'), '');
      const result = await validator.validateArtifact(changeDir, 'foo');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('empty'))).toBe(true);
    });

    it('does NOT enforce non-empty when schema explicitly opts out via requireNonEmpty:false', async () => {
      const { root, validator } = setupValidator({
        schema: {
          name: 'test',
          version: 1,
          artifacts: [
            { id: 'foo', generates: 'foo.md', requires: [], validation: { mechanical: ['requireNonEmpty:false'] } },
          ],
        },
      });
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'foo.md'), '');
      const result = await validator.validateArtifact(changeDir, 'foo');
      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });
});
