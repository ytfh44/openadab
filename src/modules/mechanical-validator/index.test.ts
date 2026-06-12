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

    it('missing config error message includes the absolute config path (M1 boundary)', async () => {
      const { root, validator } = setupValidator();
      const result = await validator.validateConfig();
      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toMatch(/^Config file not found: /);
      expect(result.errors[0]).toContain(join(root, 'adab', 'config.yaml'));
    });

    it('missing config returns artifactId "config" and empty warnings (M1 boundary)', async () => {
      const { validator } = setupValidator();
      const result = await validator.validateConfig();
      expect(result.artifactId).toBe('config');
      expect(result.warnings).toEqual([]);
      expect(result.passed).toBe(false);
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

    it('aggregate "all" result merges errors and warnings from every child (M3 boundary)', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // No draft.md → fileExists yields an error for 'draft'
      // No wiki-diff.md → fileExists yields an error for 'wiki-diff'

      // chapters: gap → warning
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), '');

      // No config.yaml → validateConfig yields an error (after M1 fix)

      const results = await validator.validateChange(changeDir);
      const all = results.find(r => r.artifactId === 'all');
      expect(all).toBeDefined();
      // Aggregate should have at least one error from each failing child
      expect(all!.errors.length).toBeGreaterThan(0);
      expect(all!.passed).toBe(false);
      // Warning from chapter gap should be present
      expect(all!.warnings.some((w) => w.includes('Gap'))).toBe(true);
    });

    it('aggregate "all" result is passed=true when only warnings are present (M3 boundary)', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nA perfectly fine draft body that meets the limits.');
      writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nNo links here.');

      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), ''); // gap warning

      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        'schema: chapter-draft\nversion: 1\nproject:\n  title: Test Novel\n  language: en-US\n  genre: fantasy\n  tense: past\n  pov: limited-third\n'
      );

      const results = await validator.validateChange(changeDir);
      const all = results.find(r => r.artifactId === 'all');
      expect(all).toBeDefined();
      expect(all!.passed).toBe(true);
      expect(all!.errors).toEqual([]);
      expect(all!.warnings.some((w) => w.includes('Gap'))).toBe(true);
    });

    it('aggregate "all" result exposes merged errors verbatim (M3 boundary)', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // No files at all → every artifact yields a "File missing" error
      const configDir = join(root, 'adab');
      mkdirSync(configDir, { recursive: true });
      writeFileSync(
        join(configDir, 'config.yaml'),
        'schema: chapter-draft\nversion: 1\nproject:\n  title: Test Novel\n  language: en-US\n  genre: fantasy\n  tense: past\n  pov: limited-third\n'
      );

      const results = await validator.validateChange(changeDir);
      const all = results.find(r => r.artifactId === 'all');
      expect(all).toBeDefined();
      // Each child ValidationResult's errors should appear in the aggregate
      for (const child of results) {
        if (child.artifactId === 'all') {continue;}
        for (const err of child.errors) {
          expect(all!.errors).toContain(err);
        }
      }
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

    it('missing-first-chapter is reported in errors, NOT warnings (M2 boundary)', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-002.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('start at ch-001'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('start at ch-001'))).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('gap is a warning: passed stays true and start-missing-chapter does not contaminate warnings (M2 boundary)', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-001.md'), '');
      writeFileSync(join(chaptersDir, 'ch-003.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('Gap'))).toBe(true);
    });

    it('mixed scenario: missing-first-chapter is error, gaps are warnings, passed is false (M2 boundary)', async () => {
      const { root, validator } = setupValidator();
      const chaptersDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(chaptersDir, { recursive: true });
      writeFileSync(join(chaptersDir, 'ch-002.md'), '');
      writeFileSync(join(chaptersDir, 'ch-004.md'), '');
      const result = await validator.chapterSequence();
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('start at ch-001'))).toBe(true);
      expect(result.warnings.some((w) => w.includes('Gap'))).toBe(true);
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

  describe('validateArtifact — word count warnings propagation (M4 boundary)', () => {
    it('propagates wordCount warnings to result.warnings when below min', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // Body has 1 word, schema requires minWords:10
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nshort.');
      const result = await validator.validateArtifact(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('below minimum'))).toBe(true);
    });

    it('propagates wordCount warnings to result.warnings when above max', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      // Default schema has maxWords:100; build a body of 150 words to trigger the upper bound.
      const longBody = ('word ').repeat(150).trim();
      writeFileSync(join(changeDir, 'draft.md'), `---\ntitle: X\n---\n\n${longBody}`);
      const result = await validator.validateArtifact(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('above maximum'))).toBe(true);
    });

    it('schemaCompliance reports word-count warnings as warnings (M4 boundary)', async () => {
      const { root, validator } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nshort.');
      const result = await validator.schemaCompliance(changeDir, 'draft');
      expect(result.passed).toBe(true);
      expect(result.errors).toEqual([]);
      expect(result.warnings.some((w) => w.includes('Word count'))).toBe(true);
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

  // ===== MV-CACHE: schema is loaded once per validateChange call =====
  // The pre-fix code called `this.schemaEngine.load()` for every
  // individual rule (fileExists, wordCount, frontmatterPresent, ...).
  // For a 5-artifact change that meant 5 disk reads.  The fix adds a
  // per-`validateChange` cache; this test pins that down.
  describe('MV-CACHE schema caching', () => {
    it('schemaEngine.load is called at most once per validateChange invocation', async () => {
      const { root, validator, schemaEngine } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nBody with enough words here to pass minWords.');

      await validator.validateChange(changeDir);
      const calls = (schemaEngine.load as ReturnType<typeof vi.fn>).mock.calls.length;
      // Even with multiple per-artifact checks, the cache must keep
      // the call count at exactly 1.
      expect(calls).toBe(1);
    });

    it('a new validateChange call refreshes the cache (re-loads schema)', async () => {
      const { root, validator, schemaEngine } = setupValidator();
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'draft.md'), '---\ntitle: X\n---\n\nBody with enough words.');

      await validator.validateChange(changeDir);
      const callsAfterFirst = (schemaEngine.load as ReturnType<typeof vi.fn>).mock.calls.length;
      expect(callsAfterFirst).toBe(1);

      // Mutate the underlying schema between calls to simulate
      // a `update --schemas` workflow that the spec requires to be
      // observed by subsequent validateChange calls.
      const newSchema: SchemaDef = {
        name: 'test-v2',
        version: 2,
        artifacts: [
          { id: 'draft', generates: 'draft.md', requires: [], validation: { mechanical: ['minWords:50', 'maxWords:200'] } },
        ],
      };
      (schemaEngine.load as ReturnType<typeof vi.fn>).mockResolvedValue(newSchema);

      await validator.validateChange(changeDir);
      const callsAfterSecond = (schemaEngine.load as ReturnType<typeof vi.fn>).mock.calls.length;
      // The cache MUST be reset between calls — otherwise the
      // post-update schema is never observed.
      expect(callsAfterSecond).toBe(2);
    });
  });

  // ===== MV-WIKILINK: classify TargetNotFoundError vs other failures =====
  describe('MV-WIKILINK wiki link error classification', () => {
    it('distinguishes missing-target (broken link) from wiki-engine internal failure', async () => {
      // wikiEngine that throws TargetNotFoundError for some links
      // and a generic Error for others.
      const wikiEngine = {
        listPages: vi.fn().mockResolvedValue(['Existing.md']),
        readPage: vi.fn().mockImplementation((p: string) => {
          if (p === 'Existing.md') {return Promise.resolve({ frontmatter: { name: 'Existing' }, body: 'x' });}
          const err = new Error('wiki internal failure') as Error & { name: string };
          err.name = 'EACCES';
          return Promise.reject(err);
        }),
      };
      const root = mkdtempSync(join(tmpdir(), 'openadab-mv-wl-'));
      const schema: SchemaDef = {
        name: 't', version: 1,
        artifacts: [
          { id: 'wiki-diff', generates: 'wiki-diff.md', requires: [] },
          { id: 'draft', generates: 'draft.md', requires: [] },
        ],
      };
      const validator = new MechanicalValidator(
        { load: vi.fn().mockResolvedValue(schema) },
        { project: { language: 'en-US' } },
        wikiEngine as unknown as WikiEngine,
        root,
      );
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nSee [[Existing]] and [[MissingOne]].');
      const result = await validator.wikiLinkValidity(changeDir, 'wiki-diff');
      // The missing link should be reported as "Broken wiki link"
      // but the wiki engine internal failure should also surface
      // as an error (not a silent "broken link" misclassification).
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('Broken wiki link'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Wiki link check failed'))).toBe(true);
    });

    it('TargetNotFoundError specifically produces "Broken wiki link" only', async () => {
      const wikiEngine = {
        listPages: vi.fn().mockResolvedValue([]),
        readPage: vi.fn().mockImplementation(() => {
          const err = new Error('not found') as Error & { name: string };
          err.name = 'TargetNotFoundError';
          return Promise.reject(err);
        }),
      };
      const root = mkdtempSync(join(tmpdir(), 'openadab-mv-wl2-'));
      const schema: SchemaDef = {
        name: 't', version: 1,
        artifacts: [{ id: 'wiki-diff', generates: 'wiki-diff.md', requires: [] }],
      };
      const validator = new MechanicalValidator(
        { load: vi.fn().mockResolvedValue(schema) },
        { project: { language: 'en-US' } },
        wikiEngine as unknown as WikiEngine,
        root,
      );
      const changeDir = join(root, 'change');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'wiki-diff.md'), '---\ntitle: X\n---\n\nSee [[Missing]].');
      const result = await validator.wikiLinkValidity(changeDir, 'wiki-diff');
      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('Broken wiki link'))).toBe(true);
      expect(result.errors.some((e) => e.includes('Wiki link check failed'))).toBe(false);
    });
  });
});
