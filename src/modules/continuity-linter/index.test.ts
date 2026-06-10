import { describe, it, expect, vi } from 'vitest';

import type { ProjectConfig } from '../../schemas/types.js';
import type { WikiEngine } from '../wiki-engine/index.js';

import { ContinuityLinter } from './index.js';

describe('ContinuityLinter', () => {
  function makeLinter(overrides?: { rules?: ProjectConfig['rules']; wikiPages?: { path: string; frontmatter: Record<string, unknown>; body: string }[] }) {
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

    const linter = new ContinuityLinter(projectConfig, wikiEngine, '/tmp/fake-root');
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
});
