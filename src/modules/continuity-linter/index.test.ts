import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import type { ProjectConfig } from '../../schemas/types.js';
import type { WikiEngine } from '../wiki-engine/index.js';

import { ContinuityLinter } from './index.js';

describe('ContinuityLinter', () => {
  function makeLinter(overrides?: { rules?: ProjectConfig['rules']; wikiPages?: { path: string; frontmatter: Record<string, unknown>; body: string }[]; projectRoot?: string }) {
    const projectConfig: ProjectConfig = {
      schema: 'chapter-draft',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: overrides?.rules ?? {},
      archive: { backupOnOverwrite: false },
    };

    const pages = overrides?.wikiPages ?? [];
    const wikiEngine = {
      readPage: vi.fn().mockImplementation((path: string) => {
        const page = pages.find((p) => p.path === path);
        if (!page) {throw new Error('Not found');}
        return Promise.resolve(page);
      }),
      listPages: vi.fn().mockImplementation((type?: string) => {
        return Promise.resolve(pages.filter((p) => type === undefined || p.frontmatter.type === type).map((p) => p.path));
      }),
    } as unknown as InstanceType<typeof WikiEngine>;

    const linter = new ContinuityLinter(projectConfig, wikiEngine, overrides?.projectRoot ?? '/tmp/fake-root');
    return { linter, wikiEngine };
  }

  it('each check type produces valid prompt structure', async () => {
    const pages = [
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character', status: 'active' }, body: '## Knowledge Timeline\n- ch-001: Learns secret\n' },
      { path: 'threads/t1.md', frontmatter: { name: 'The Prophecy', type: 'thread', status: 'open' }, body: '' },
      { path: 'style/voice.md', frontmatter: { name: 'Voice', type: 'style' }, body: 'Snarky' },
      { path: 'locations/l1.md', frontmatter: { name: 'City', type: 'location' }, body: 'Rules: no flying' },
      { path: 'factions/f1.md', frontmatter: { name: 'Guild', type: 'faction' }, body: 'Rules: pay dues' },
      { path: 'timeline/tl.md', frontmatter: { name: 'Timeline', type: 'timeline' }, body: 'Day 1: event A' },
    ];
    const { linter } = makeLinter({ wikiPages: pages });
    const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
    expect(prompt.prompt).toContain('Semantic Validation: revision');
    expect(prompt.prompt).toContain('## Character Knowledge Consistency');
    expect(prompt.prompt).toContain('## Timeline Contradiction Check');
    expect(prompt.prompt).toContain('## POV Discipline Check');
    expect(prompt.prompt).toContain('## Foreshadowing Integrity Check');
    expect(prompt.prompt).toContain('## Voice Blending Check');
    expect(prompt.prompt).toContain('## World Rule Compliance Check');
    expect(prompt.expectedOutput).toContain('passed');
  });

  it('per-artifact profiles select correct checks', async () => {
    const pages = [
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character', status: 'active' }, body: '## Knowledge Timeline\n- ch-001: Learns secret\n' },
      { path: 'threads/t1.md', frontmatter: { name: 'The Prophecy', type: 'thread', status: 'open' }, body: '' },
      { path: 'style/voice.md', frontmatter: { name: 'Voice', type: 'style' }, body: 'Snarky' },
      { path: 'locations/l1.md', frontmatter: { name: 'City', type: 'location' }, body: 'Rules: no flying' },
      { path: 'factions/f1.md', frontmatter: { name: 'Guild', type: 'faction' }, body: 'Rules: pay dues' },
    ];
    const { linter: draftLinter } = makeLinter({ wikiPages: pages });
    const draftPrompt = await draftLinter.generateValidationPrompt('ch-001', 'draft');
    expect(draftPrompt.prompt).toContain('## POV Discipline Check');
    expect(draftPrompt.prompt).not.toContain('## Character Knowledge Consistency');

    const { linter: wikiDiffLinter } = makeLinter();
    const diffPrompt = await wikiDiffLinter.generateValidationPrompt('ch-001', 'wiki-diff');
    expect(diffPrompt.prompt).toContain('## Wiki-Diff Source Citation Check');
    expect(diffPrompt.prompt).toContain('## Wiki-Diff Contradiction Flagging Check');
    expect(diffPrompt.prompt).not.toContain('## POV Discipline Check');
  });

  it('rules from config appear in prompt', async () => {
    const { linter } = makeLinter({ rules: { draft: ['No deus ex machina', 'Show, do not tell'] } });
    const prompt = await linter.generateValidationPrompt('ch-001', 'draft');
    expect(prompt.prompt).toContain('No deus ex machina');
    expect(prompt.prompt).toContain('Show, do not tell');
  });

  describe('POV discipline when POV is not declared', () => {
    it('still generates a check section with a "no POV declared" note when scene-plan and brief are both missing', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('ch-001', 'draft');
      expect(prompt.prompt).toContain('## POV Discipline Check');
      expect(prompt.prompt).toContain('No POV character declared');
    });

    it('emits the fallback section even when the project root has no change directory', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('does-not-exist', 'draft');
      expect(prompt.prompt).toContain('## POV Discipline Check');
      expect(prompt.prompt).not.toContain('Declared POV Character:');
    });

    it('does not throw and does not include a "Declared POV Character" line when files exist but lack pov field', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'openadab-pov-missing-'));
      const changeDir = join(tempDir, 'adab', 'changes', 'ch-099');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'brief.md'), '---\ntitle: No pov here\n---\nBody\n', 'utf-8');
      try {
        const { linter } = makeLinter({ projectRoot: tempDir });
        const prompt = await linter.generateValidationPrompt('ch-099', 'draft');
        expect(prompt.prompt).toContain('## POV Discipline Check');
        expect(prompt.prompt).not.toContain('Declared POV Character:');
      } finally {
        rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe('expected output JSON schema in validation prompt', () => {
    it('lists the character, knownAt, actedOnAt, and description fields in the example issue object', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('ch-001', 'draft');
      expect(prompt.expectedOutput).toContain('"character"');
      expect(prompt.expectedOutput).toContain('"knownAt"');
      expect(prompt.expectedOutput).toContain('"actedOnAt"');
      expect(prompt.expectedOutput).toContain('"description"');
    });

    it('uses the same four fields regardless of the chosen artifact profile', async () => {
      const { linter } = makeLinter();
      const draftPrompt = await linter.generateValidationPrompt('ch-001', 'draft');
      const revisionPrompt = await linter.generateValidationPrompt('ch-001', 'revision');
      const wikiDiffPrompt = await linter.generateValidationPrompt('ch-001', 'wiki-diff');
      for (const field of ['character', 'knownAt', 'actedOnAt', 'description']) {
        expect(draftPrompt.expectedOutput).toContain(`"${field}"`);
        expect(revisionPrompt.expectedOutput).toContain(`"${field}"`);
        expect(wikiDiffPrompt.expectedOutput).toContain(`"${field}"`);
      }
    });

    it('produces valid JSON that parses back to an object containing the four fields', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('ch-001', 'draft');
      const parsed = JSON.parse(prompt.expectedOutput) as { issues: Array<Record<string, unknown>> };
      expect(parsed.issues[0]).toHaveProperty('character');
      expect(parsed.issues[0]).toHaveProperty('knownAt');
      expect(parsed.issues[0]).toHaveProperty('actedOnAt');
      expect(parsed.issues[0]).toHaveProperty('description');
    });
  });

  describe('character knowledge timeline section boundary', () => {
    it('excludes content that lives under the next level-2 or higher heading (deeper h3 stays in the section)', async () => {
      const pages = [
        {
          path: 'characters/alice.md',
          frontmatter: { name: 'Alice', type: 'character', status: 'active' },
          body: '## Knowledge Timeline\n- ch-001: Learns secret\n### Notes\nThis note belongs to Alice\n',
        },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('Knowledge Timeline');
      expect(prompt.prompt).toContain('Learns secret');
      expect(prompt.prompt).toContain('This note belongs to Alice');
      expect(prompt.prompt).not.toContain('## Knowledge Timeline\n- ch-001: Learns secret\n### Notes\nThis note belongs to Alice');
    });

    it('stops the timeline at the next level-2 heading instead of swallowing it', async () => {
      const pages = [
        {
          path: 'characters/bob.md',
          frontmatter: { name: 'Bob', type: 'character', status: 'active' },
          body: '## Knowledge Timeline\n- ch-002: Saw Bob\n## Combat Training\n- ch-003: Fought\n',
        },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('Saw Bob');
      expect(prompt.prompt).not.toContain('Fought');
    });

    it('still emits a "newly introduced" note when the page has no Knowledge Timeline section at all', async () => {
      const pages = [
        {
          path: 'characters/carol.md',
          frontmatter: { name: 'Carol', type: 'character', status: 'active' },
          body: '## Background\nJust some prose, no timeline.\n',
        },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('Character "Carol" is newly introduced');
    });

    it('produces no character knowledge section at all when no character pages exist', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).not.toContain('## Character Knowledge Consistency');
    });
  });

  describe('POV extraction robustness', () => {
    let tempDir: string;
    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'openadab-pov-extract-'));
    });
    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('extractPov rejects scene-plan frontmatter whose pov is an array and the upper layer falls back to the no-POV note', async () => {
      const changeDir = join(tempDir, 'adab', 'changes', 'ch-arr');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'scene-plan.md'), '---\npov: ["limited-third"]\n---\nBody\n', 'utf-8');
      const { linter } = makeLinter({ projectRoot: tempDir });
      const prompt = await linter.generateValidationPrompt('ch-arr', 'draft');
      expect(prompt.prompt).toContain('## POV Discipline Check');
      expect(prompt.prompt).not.toContain('Declared POV Character: ["limited-third"]');
      expect(prompt.prompt).not.toContain('["limited-third"]');
    });

    it('extractPov rejects brief frontmatter whose pov is a number and the upper layer falls back to the no-POV note', async () => {
      const changeDir = join(tempDir, 'adab', 'changes', 'ch-num');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'brief.md'), '---\npov: 42\n---\nBody\n', 'utf-8');
      const { linter } = makeLinter({ projectRoot: tempDir });
      const prompt = await linter.generateValidationPrompt('ch-num', 'draft');
      expect(prompt.prompt).toContain('## POV Discipline Check');
      expect(prompt.prompt).not.toContain('Declared POV Character: 42');
    });

    it('extractPov rejects pov given as a nested object and the upper layer falls back to the no-POV note', async () => {
      const changeDir = join(tempDir, 'adab', 'changes', 'ch-obj');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'scene-plan.md'), '---\npov:\n  mode: limited\n---\nBody\n', 'utf-8');
      const { linter } = makeLinter({ projectRoot: tempDir });
      const prompt = await linter.generateValidationPrompt('ch-obj', 'draft');
      expect(prompt.prompt).toContain('## POV Discipline Check');
      expect(prompt.prompt).not.toContain('Declared POV Character:');
      expect(prompt.prompt).not.toContain('"mode"');
    });

    it('extracts a string pov from scene-plan and embeds it in the prompt', async () => {
      const changeDir = join(tempDir, 'adab', 'changes', 'ch-good');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(join(changeDir, 'scene-plan.md'), '---\npov: Alice\n---\nBody\n', 'utf-8');
      const { linter } = makeLinter({ projectRoot: tempDir });
      const prompt = await linter.generateValidationPrompt('ch-good', 'draft');
      expect(prompt.prompt).toContain('Declared POV Character: Alice');
    });
  });

  describe('timeline prompt assembly with per-page headers', () => {
    it('prefixes each timeline page body with a level-3 header that uses the page name', async () => {
      const pages = [
        { path: 'timeline/t1.md', frontmatter: { name: 'World Timeline', type: 'timeline' }, body: 'Day 1: event A' },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('### World Timeline');
      expect(prompt.prompt).toContain('Day 1: event A');
    });

    it('falls back to the wiki page path when the timeline page has no name in frontmatter', async () => {
      const pages = [
        { path: 'timeline/anonymous.md', frontmatter: { type: 'timeline' }, body: 'Anon event' },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('### timeline/anonymous.md');
    });

    it('emits one header per timeline page so pages stay distinguishable', async () => {
      const pages = [
        { path: 'timeline/t1.md', frontmatter: { name: 'Page One', type: 'timeline' }, body: 'Body one' },
        { path: 'timeline/t2.md', frontmatter: { name: 'Page Two', type: 'timeline' }, body: 'Body two' },
      ];
      const { linter } = makeLinter({ wikiPages: pages });
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).toContain('### Page One');
      expect(prompt.prompt).toContain('### Page Two');
    });

    it('emits no timeline section when no timeline pages exist', async () => {
      const { linter } = makeLinter();
      const prompt = await linter.generateValidationPrompt('ch-002', 'revision');
      expect(prompt.prompt).not.toContain('## Timeline Contradiction Check');
    });
  });
});
