import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { AdabError, WikiDiffParseError } from '../../utils/errors.js';
import type { ContextPacker } from '../context-packer/index.js';
import type { MechanicalValidator } from '../mechanical-validator/index.js';
import type { MentionIndexer } from '../mention-indexer/index.js';
import type { ProgressionTracker } from '../progression-tracker/index.js';
import type { WikiDiffParser, WikiDiffApplier } from '../wiki-diff-engine/index.js';
import type { WikiEngine } from '../wiki-engine/index.js';
import type { SchemaDef } from '../../schemas/schema-def.js';

import { SyncEngine } from './index.js';

describe('SyncEngine', () => {
  function setupSyncEngine(overrides?: { manifestStatus?: string; wikiDiffOps?: { type: string; target: string; source?: string }[]; validationFail?: boolean; schemaLoader?: { load: () => Promise<SchemaDef> } }) {
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
      validateDependencies: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [] }),
    } as unknown as MechanicalValidator;

    const engine = new SyncEngine(
      root,
      wikiDiffParser,
      wikiDiffApplier,
      wikiEngine,
      mentionIndexer,
      progressionTracker,
      contextPacker,
      validator,
      overrides?.schemaLoader,
    );
    return { root, engine, changeDir, wikiDiffParser, wikiDiffApplier, mentionIndexer, wikiEngine, progressionTracker };
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
    // Use 'draft' artifact which is NOT in the optional list (wiki-diff, brief, scene-plan)
    (engine as any).validator.validateChange = vi.fn().mockResolvedValue([{ artifactId: 'draft', passed: false, errors: ['File missing: draft.md'], warnings: [] }]);
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

  it('index regeneration failure after wiki-diff applied logs error but continues', async () => {
    const { engine, mentionIndexer } = setupSyncEngine({ manifestStatus: 'in_progress', wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }] });
    mentionIndexer.incrementalIndex = vi.fn().mockRejectedValue(new Error('index crash'));
    // Per spec: any index step failure → throw SYNC_INDEX_FAILED (wiki-diff changes kept on disk)
    await expect(engine.sync('draft-ch-001')).rejects.toMatchObject({ code: 'SYNC_INDEX_FAILED' });
  });

  // L6: brief.md missing should not block sync
  it('brief.md missing does not block sync', async () => {
    const { engine } = setupSyncEngine({ manifestStatus: 'in_progress' });
    // Mock validator to return "File missing: brief.md" error
    (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
      { artifactId: 'brief', passed: false, errors: ['File missing: brief.md'], warnings: [] },
      { artifactId: 'draft', passed: true, errors: [], warnings: [] },
      { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
    ]);
    (engine as any).validator.requireNonEmpty = vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [], artifactId: '' });
    (engine as any).validator.validateDependencies = vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [] });

    // Should not throw - brief.md missing is optional
    const report = await engine.sync('draft-ch-001');
    expect(report.changeId).toBe('draft-ch-001');
  });

  // L6: scene-plan.md missing should not block sync
  it('scene-plan.md missing does not block sync', async () => {
    const { engine } = setupSyncEngine({ manifestStatus: 'in_progress' });
    // Mock validator to return "File missing: scene-plan.md" error
    (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
      { artifactId: 'scene-plan', passed: false, errors: ['File missing: scene-plan.md'], warnings: [] },
      { artifactId: 'brief', passed: true, errors: [], warnings: [] },
      { artifactId: 'draft', passed: true, errors: [], warnings: [] },
    ]);
    (engine as any).validator.requireNonEmpty = vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [], artifactId: '' });
    (engine as any).validator.validateDependencies = vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [] });

    // Should not throw - scene-plan.md missing is optional
    const report = await engine.sync('draft-ch-001');
    expect(report.changeId).toBe('draft-ch-001');
  });

  // L6 regression: manifest missing should still block sync
  it('manifest missing still blocks sync', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-se-manifest-'));
    const changeDir = join(root, 'adab', 'changes', 'draft-ch-001');
    mkdirSync(changeDir, { recursive: true });
    // Do NOT create manifest - should block

    const wikiDiffParser = { parse: vi.fn().mockResolvedValue({ changeId: 'draft-ch-001', operations: [] }) } as unknown as WikiDiffParser;
    const wikiDiffApplier = { apply: vi.fn().mockResolvedValue({ success: true, operationsApplied: 0, pagesModified: 0, contradictionsFlagged: 0, summary: 'ok', warnings: [] }) } as unknown as WikiDiffApplier;
    const wikiEngine = { generateWikilinks: vi.fn().mockResolvedValue(undefined), generateIndex: vi.fn().mockResolvedValue(undefined) } as unknown as WikiEngine;
    const mentionIndexer = { incrementalIndex: vi.fn().mockResolvedValue(undefined), indexAll: vi.fn().mockResolvedValue(undefined), generateContextMap: vi.fn().mockResolvedValue(undefined) } as unknown as MentionIndexer;
    const progressionTracker = { generateProgressionsJson: vi.fn().mockResolvedValue(undefined) } as unknown as ProgressionTracker;
    const contextPacker = { packContext: vi.fn().mockResolvedValue({ mustRead: [], optionalRead: [], excluded: [], reasons: {} }) } as unknown as ContextPacker;
    const validator = { validateChange: vi.fn().mockResolvedValue([]), requireNonEmpty: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [], artifactId: '' }), validateDependencies: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [] }) } as unknown as MechanicalValidator;

    const engine = new SyncEngine(root, wikiDiffParser, wikiDiffApplier, wikiEngine, mentionIndexer, progressionTracker, contextPacker, validator);

    await expect(engine.sync('draft-ch-001')).rejects.toThrow(AdabError);
    await expect(engine.sync('draft-ch-001')).rejects.toThrow(/manifest/i);
  });

  // ==================== SE-1: throw SYNC_INDEX_FAILED on index failure ====================
  describe('SE-1: index failure throws SYNC_INDEX_FAILED', () => {
    it('throws AdabError with code SYNC_INDEX_FAILED when an index step fails', async () => {
      const { engine, mentionIndexer } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      mentionIndexer.incrementalIndex = vi.fn().mockRejectedValue(new Error('index crash'));
      await expect(engine.sync('draft-ch-001')).rejects.toMatchObject({ code: 'SYNC_INDEX_FAILED' });
    });

    it('error message includes the spec-required text', async () => {
      const { engine, mentionIndexer } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      mentionIndexer.incrementalIndex = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(engine.sync('draft-ch-001')).rejects.toThrow(/Index regeneration partially failed after wiki-diff was applied/);
    });

    it('preserves which indexes succeeded in the error message', async () => {
      const { engine, wikiEngine } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      wikiEngine.generateWikilinks = vi.fn().mockRejectedValue(new Error('wikilink broken'));
      try {
        await engine.sync('draft-ch-001');
        expect.fail('Should have thrown');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        expect(msg).toContain('adab/index/mentions.json');
        expect(msg).toContain('Run `openadab wiki index`');
      }
    });

    it('does not throw SYNC_INDEX_FAILED when all indexes succeed', async () => {
      const { engine } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      const report = await engine.sync('draft-ch-001');
      expect(report.indexErrors).toEqual([]);
    });
  });

  // ==================== SE-2: try/catch around wikiDiffParser.parse ====================
  describe('SE-2: wikiDiffParser.parse errors are wrapped', () => {
    it('wraps parser errors in WikiDiffParseError with cause', async () => {
      const { engine, wikiDiffParser } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      const originalError = new Error('malformed heading depth');
      (wikiDiffParser.parse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(originalError);
      let caught: unknown;
      try {
        await engine.sync('draft-ch-001');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(WikiDiffParseError);
      expect((caught as Error & { cause?: unknown }).cause).toBe(originalError);
    });

    it('throws WikiDiffParseError when parser throws synchronously-style rejection', async () => {
      const { engine, wikiDiffParser } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      (wikiDiffParser.parse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('bad section'));
      await expect(engine.sync('draft-ch-001')).rejects.toBeInstanceOf(WikiDiffParseError);
    });

    it('does not invoke wikiDiffApplier when parse fails', async () => {
      const { engine, wikiDiffParser, wikiDiffApplier } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      (wikiDiffParser.parse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('nope'));
      await expect(engine.sync('draft-ch-001')).rejects.toBeInstanceOf(WikiDiffParseError);
      expect(wikiDiffApplier.apply).not.toHaveBeenCalled();
    });
  });

  // ==================== SE-3: optional artifacts loaded from schema ====================
  describe('SE-3: optional artifacts driven by schema required: false', () => {
    function makeSchemaWithOptional(requiredArtifacts: Record<string, boolean>): { load: () => Promise<SchemaDef> } {
      return {
        load: () => Promise.resolve({
          name: 'chapter-draft',
          version: 1,
          artifacts: [
            { id: 'brief', generates: 'brief.md', requires: [], required: requiredArtifacts.brief ?? true },
            { id: 'scene-plan', generates: 'scene-plan.md', requires: ['brief'], required: requiredArtifacts['scene-plan'] ?? true },
            { id: 'draft', generates: 'draft.md', requires: ['brief'], required: requiredArtifacts.draft ?? true },
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: ['draft'], required: requiredArtifacts['wiki-diff'] ?? true },
          ],
        }),
      };
    }

    it('missing wiki-diff is non-fatal when schema marks it required: false', async () => {
      const schemaLoader = makeSchemaWithOptional({ 'wiki-diff': false, brief: true });
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
        { artifactId: 'brief', passed: true, errors: [], warnings: [] },
        { artifactId: 'draft', passed: true, errors: [], warnings: [] },
      ]);
      const report = await engine.sync('draft-ch-001');
      expect(report.changeId).toBe('draft-ch-001');
    });

    it('missing brief is fatal when schema marks it required: true (default)', async () => {
      const schemaLoader = makeSchemaWithOptional({ brief: true });
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'brief', passed: false, errors: ['File missing: brief.md'], warnings: [] },
        { artifactId: 'draft', passed: true, errors: [], warnings: [] },
      ]);
      await expect(engine.sync('draft-ch-001')).rejects.toMatchObject({ code: 'SYNC_VALIDATION_FAILED' });
    });

    it('falls back to hardcoded list when no schemaLoader is provided', async () => {
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress' });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
        { artifactId: 'brief', passed: true, errors: [], warnings: [] },
      ]);
      // No schemaLoader → wiki-diff missing is OK (back-compat with hardcoded fallback)
      const report = await engine.sync('draft-ch-001');
      expect(report.changeId).toBe('draft-ch-001');
    });

    it('schemaLoader schema with required: false on wiki-diff but required: true on brief treats only wiki-diff as optional', async () => {
      const schemaLoader = makeSchemaWithOptional({ 'wiki-diff': false, brief: true, draft: true });
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
        { artifactId: 'brief', passed: false, errors: ['File missing: brief.md'], warnings: [] },
        { artifactId: 'draft', passed: true, errors: [], warnings: [] },
      ]);
      await expect(engine.sync('draft-ch-001')).rejects.toThrow(/brief\.md/);
    });
  });

  // ==================== SE-4: structured error codes (not startsWith) ====================
  describe('SE-4: structured ValidationErrorCode for missing optional artifacts', () => {
    it('classifies FILE_MISSING code when only that error is present for an optional artifact', async () => {
      const schemaLoader = {
        load: () => Promise.resolve({
          name: 'chapter-draft',
          version: 1,
          artifacts: [
            { id: 'brief', generates: 'brief.md', requires: [], required: true },
            { id: 'draft', generates: 'draft.md', requires: ['brief'], required: true },
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: ['draft'], required: false },
          ],
        }),
      };
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      // Engine should NOT treat a File-missing error from a different prefix as missing-optional
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
      ]);
      const report = await engine.sync('draft-ch-001');
      expect(report.changeId).toBe('draft-ch-001');
    });

    it('non-FILE_MISSING errors on an optional artifact still block sync (e.g., schema validation)', async () => {
      const schemaLoader = {
        load: () => Promise.resolve({
          name: 'chapter-draft',
          version: 1,
          artifacts: [
            { id: 'brief', generates: 'brief.md', requires: [], required: true },
            { id: 'draft', generates: 'draft.md', requires: ['brief'], required: true },
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: ['draft'], required: false },
          ],
        }),
      };
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        { artifactId: 'wiki-diff', passed: false, errors: ['File missing: wiki-diff.md'], warnings: [] },
        { artifactId: 'brief', passed: true, errors: [], warnings: [] },
        { artifactId: 'draft', passed: true, errors: [], warnings: [] },
      ]);
      // wiki-diff missing → only FILE_MISSING → not fatal for optional
      const report = await engine.sync('draft-ch-001');
      expect(report.changeId).toBe('draft-ch-001');
    });

    it('uses the structural optional-set rather than ad-hoc string match', async () => {
      // Provide schema where wiki-diff IS required; ensure ad-hoc string would not match
      const schemaLoader = {
        load: () => Promise.resolve({
          name: 'chapter-draft',
          version: 1,
          artifacts: [
            { id: 'wiki-diff', generates: 'wiki-diff.md', requires: [], required: true },
            { id: 'brief', generates: 'brief.md', requires: [], required: true },
            { id: 'draft', generates: 'draft.md', requires: ['brief'], required: true },
          ],
        }),
      };
      const { engine } = setupSyncEngine({ manifestStatus: 'in_progress', schemaLoader });
      (engine as any).validator.validateChange = vi.fn().mockResolvedValue([
        // Distinct error string that does NOT start with "File missing:" but is still about absence
        { artifactId: 'wiki-diff', passed: false, errors: ['Custom error: artifact not registered'], warnings: [] },
      ]);
      await expect(engine.sync('draft-ch-001')).rejects.toMatchObject({ code: 'SYNC_VALIDATION_FAILED' });
    });
  });

  // ==================== SE-5: full flag drives all 5 index steps ====================
  describe('SE-5: --full flag drives all 5 index steps', () => {
    it('with full=true, calls indexAll + generateWikilinks + generateProgressionsJson + generateContextMap + generateIndex', async () => {
      const { engine, mentionIndexer, wikiEngine, progressionTracker } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      await engine.sync('draft-ch-001', true);
      expect(mentionIndexer.indexAll).toHaveBeenCalledTimes(1);
      expect(mentionIndexer.incrementalIndex).not.toHaveBeenCalled();
      expect(mentionIndexer.generateContextMap).toHaveBeenCalledTimes(1);
      expect(wikiEngine.generateWikilinks).toHaveBeenCalledTimes(1);
      expect(wikiEngine.generateIndex).toHaveBeenCalledTimes(1);
      expect(progressionTracker.generateProgressionsJson).toHaveBeenCalledTimes(1);
    });

    it('with full=false (default), calls incrementalIndex (not indexAll)', async () => {
      const { engine, mentionIndexer } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      await engine.sync('draft-ch-001', false);
      expect(mentionIndexer.incrementalIndex).toHaveBeenCalledTimes(1);
      expect(mentionIndexer.indexAll).not.toHaveBeenCalled();
    });

    it('full=true still continues through remaining steps if one index step fails (partial failure tolerant)', async () => {
      const { engine, mentionIndexer, wikiEngine, progressionTracker } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      mentionIndexer.indexAll = vi.fn().mockRejectedValue(new Error('full index broken'));
      await expect(engine.sync('draft-ch-001', true)).rejects.toMatchObject({ code: 'SYNC_INDEX_FAILED' });
      // Despite the failure of step 1, other steps should have been attempted
      expect(wikiEngine.generateWikilinks).toHaveBeenCalled();
      expect(progressionTracker.generateProgressionsJson).toHaveBeenCalled();
    });
  });

  // ==================== SE-7: manifest status preserved on index failure ====================
  describe('SE-7: manifest status preserved on partial failure', () => {
    function readManifestStatus(root: string, changeDir: string): string {
      const { readFileSync } = require('node:fs');
      const YAML = require('yaml');
      const raw = readFileSync(join(root, 'adab', 'changes', changeDir, '.openadab.yaml'), 'utf-8');
      return (YAML.parse(raw) as { status: string }).status;
    }

    it('does not write synced when index fails (status preserved as in_progress)', async () => {
      const { engine, mentionIndexer } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      mentionIndexer.incrementalIndex = vi.fn().mockRejectedValue(new Error('boom'));
      await expect(engine.sync('draft-ch-001')).rejects.toMatchObject({ code: 'SYNC_INDEX_FAILED' });
      const status = readManifestStatus((engine as any).projectRoot, 'draft-ch-001');
      expect(status).toBe('in_progress');
    });

    it('writes synced when all indexes succeed', async () => {
      const { engine } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      await engine.sync('draft-ch-001');
      const status = readManifestStatus((engine as any).projectRoot, 'draft-ch-001');
      expect(status).toBe('synced');
    });

    it('manifest status is in_progress when wikiDiffParser.parse throws', async () => {
      const { engine, wikiDiffParser } = setupSyncEngine({
        manifestStatus: 'in_progress',
        wikiDiffOps: [{ type: 'update_field', target: 'characters/alice.md', source: 'draft-ch-001' }],
      });
      (wikiDiffParser.parse as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('parse fail'));
      await expect(engine.sync('draft-ch-001')).rejects.toBeInstanceOf(WikiDiffParseError);
      const status = readManifestStatus((engine as any).projectRoot, 'draft-ch-001');
      expect(status).toBe('in_progress');
    });
  });
});
