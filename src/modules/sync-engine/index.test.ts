import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { AdabError } from '../../utils/errors.js';
import type { ContextPacker } from '../context-packer/index.js';
import type { MechanicalValidator } from '../mechanical-validator/index.js';
import type { MentionIndexer } from '../mention-indexer/index.js';
import type { ProgressionTracker } from '../progression-tracker/index.js';
import type { WikiDiffParser, WikiDiffApplier } from '../wiki-diff-engine/index.js';
import type { WikiEngine } from '../wiki-engine/index.js';

import { SyncEngine } from './index.js';

describe('SyncEngine', () => {
  function setupSyncEngine(overrides?: { manifestStatus?: string; wikiDiffOps?: { type: string; target: string; source?: string }[]; validationFail?: boolean }) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-se-'));
    const changeDir = join(root, 'adab', 'changes', 'draft-ch-001');
    mkdirSync(changeDir, { recursive: true });

    const manifest = {
      changeId: 'draft-ch-001',
      schema: 'chapter-draft',
      version: 1,
      created: new Date().toISOString(),
      status: overrides?.manifestStatus ?? 'in_progress',
      artifacts: { brief: 'done', draft: 'done' },
    };
    writeFileSync(join(changeDir, '.openadab.yaml'), JSON.stringify(manifest));
    writeFileSync(join(changeDir, 'brief.md'), '---\nstatus: done\n---\n\nbrief');
    writeFileSync(join(changeDir, 'draft.md'), '---\nstatus: done\n---\n\ndraft');

    if (overrides?.wikiDiffOps) {
      const ops = overrides.wikiDiffOps.map((op) => `- ${op.type}: ${op.target}`).join('\n');
      writeFileSync(join(changeDir, 'wiki-diff.md'), `---\nchangeId: draft-ch-001\n---\n\n## Operations\n${ops}\n`);
    }

    const wikiDiffParser = {
      parse: vi.fn().mockImplementation(() => {
        const ops = overrides?.wikiDiffOps ?? [];
        return Promise.resolve({ changeId: 'draft-ch-001', operations: ops });
      }),
    } as unknown as WikiDiffParser;

    const wikiDiffApplier = {
      apply: vi.fn().mockResolvedValue({ success: true, operationsApplied: overrides?.wikiDiffOps?.length ?? 0, pagesModified: 0, contradictionsFlagged: 0, summary: 'ok', warnings: [] }),
    } as unknown as WikiDiffApplier;

    const wikiEngine = {
      generateWikilinks: vi.fn().mockResolvedValue(undefined),
      generateIndex: vi.fn().mockResolvedValue(undefined),
      listPages: vi.fn().mockResolvedValue([]),
      readPage: vi.fn().mockResolvedValue({ frontmatter: {}, body: '' }),
    } as unknown as WikiEngine;

    const mentionIndexer = {
      incrementalIndex: vi.fn().mockResolvedValue(undefined),
      indexAll: vi.fn().mockResolvedValue(undefined),
      generateContextMap: vi.fn().mockResolvedValue(undefined),
    } as unknown as MentionIndexer;

    const progressionTracker = {
      generateProgressionsJson: vi.fn().mockResolvedValue(undefined),
    } as unknown as ProgressionTracker;

    const contextPacker = {
      packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }),
    } as unknown as ContextPacker;

    const validator = {
      validateChange: vi.fn().mockResolvedValue([]),
      requireNonEmpty: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [], artifactId: '' }),
    } as unknown as MechanicalValidator;

    const engine = new SyncEngine(root, wikiDiffParser, wikiDiffApplier, wikiEngine, mentionIndexer, progressionTracker, contextPacker, validator);
    return { root, engine, changeDir, wikiDiffApplier, mentionIndexer };
  }

  it('full sync workflow succeeds with mocked components', async () => {
    const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }] });
    const report = await engine.sync('draft-ch-001');
    expect(report.changeId).toBe('draft-ch-001');
    expect(report.indexesRegenerated.length).toBeGreaterThan(0);
    expect(report.logEntry.op).toBe('sync');
  });

  it('validation failure aborts sync', async () => {
    const { engine } = setupSyncEngine({ manifestStatus: 'in_progress' });
    (engine as any).validator.validateChange = vi.fn().mockResolvedValue([{ artifactId: 'brief', passed: false, errors: ['File missing: brief.md'], warnings: [] }]);
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(AdabError);
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(/validation failed/i);
  });

  it('empty diff skips apply', async () => {
    const { engine, wikiDiffApplier } = setupSyncEngine({ manifestStatus: 'in_progress', wikiDiffOps: [] });
    await engine.sync('draft-ch-001');
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(wikiDiffApplier.apply).not.toHaveBeenCalled();
  });

  it('sync report contains expected fields', async () => {
    const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }] });
    const report = await engine.sync('draft-ch-001');
    expect(report).toHaveProperty('changeId');
    expect(report).toHaveProperty('wikiPagesModified');
    expect(report).toHaveProperty('contradictionsFlagged');
    expect(report).toHaveProperty('indexesRegenerated');
    expect(report).toHaveProperty('logEntry');
    expect(report.logEntry.details).toHaveProperty('wikiPagesModified');
    expect(report.logEntry.details).toHaveProperty('indexesRegenerated');
  });

  it('index regeneration failure after wiki-diff applied throws with manual recovery instruction', async () => {
    const { engine, mentionIndexer } = setupSyncEngine({ manifestStatus: 'in_progress', wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }] });
    mentionIndexer.incrementalIndex = vi.fn().mockRejectedValue(new Error('index crash'));
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(AdabError);
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(/Sync index regeneration partially failed/);
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(/openadab wiki index/);
  });
});
