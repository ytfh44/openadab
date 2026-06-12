/**
 * Integration test: sync → archive pipeline.
 *
 * Completes a full change, verifies the manuscript is updated, the change
 * is archived, and log entries are complete.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';


import { ArchiveEngine } from '../../src/modules/archive-engine/index.js';
import { ManifestManager } from '../../src/modules/change-manifest/index.js';
import { ContextPacker } from '../../src/modules/context-packer/index.js';
import { LogReader } from '../../src/modules/log/index.js';
import { MechanicalValidator } from '../../src/modules/mechanical-validator/index.js';
import { MentionIndexer } from '../../src/modules/mention-indexer/index.js';
import { ProgressionTracker } from '../../src/modules/progression-tracker/index.js';
import { ConfigLoader } from '../../src/modules/project-config/index.js';
import { SchemaLoader } from '../../src/modules/schema-engine/index.js';
import { SyncEngine } from '../../src/modules/sync-engine/index.js';
import { WikiDiffApplier, WikiDiffParser } from '../../src/modules/wiki-diff-engine/index.js';
import { WikiEngine } from '../../src/modules/wiki-engine/index.js';
import type { ValidationResult } from '../../src/schemas/types.js';
import { fileExists, safeReadFile } from '../../src/utils/fs.js';

import { createMinimalProject } from './fixture.js';

describe('sync → archive pipeline', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
    await createMinimalProject(projectRoot);
  });

  it('24.6 full change completion updates manuscript, archives change, and logs', async () => {
    const changeId = 'ch-002';
    const changeDir = join(projectRoot, 'adab', 'changes', changeId);

    // Setup change
    const configLoader = new ConfigLoader(projectRoot);
    await configLoader.load();
    const schemaName = configLoader.getActiveSchema();
    const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
    const schemaLoader = new SchemaLoader(schemaDir);
    const schema = await schemaLoader.load();
    const manifestManager = new ManifestManager();
    const manifest = manifestManager.createManifest(changeId, schema);
    await mkdir(changeDir, { recursive: true });
    await manifestManager.writeManifest(changeDir, manifest);

    // Write all artifacts
    await writeFile(join(changeDir, 'brief.md'), '---\npov: Mara\n---\n\n# Brief\n\nSteal the jewel.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'brief', 'done', schema);
    await writeFile(join(changeDir, 'scene-plan.md'), '---\nchapter: "002"\n---\n\n# Scene Plan\n\nOne scene.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'scene-plan', 'done', schema);
    await writeFile(join(changeDir, 'draft.md'), '---\nchapter: "002"\n---\n\n# Draft\n\nMara moved.\n\n---\n\nShe opened the vault.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'draft', 'done', schema);
    await writeFile(join(changeDir, 'revision.md'), '---\nchapter: "002"\n---\n\n# Revision\n\nMara crept.\n\n---\n\nShe opened the vault door.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'revision', 'done', schema);
    await writeFile(join(changeDir, 'continuity-report.md'), '---\nchapter: "002"\n---\n\n# Continuity Report\n\nThread advanced.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'continuity-report', 'done', schema);
    await writeFile(
      join(changeDir, 'wiki-diff.md'),
      `---\nchangeId: ${changeId}\n---\n\n### [[characters/mara]]\n\nSource: ${changeId}/continuity-report.md\n\n#### Add to Current State\n\n- Ready to steal.\n`,
      'utf-8',
    );
    await manifestManager.updateArtifactStatus(changeDir, 'wiki-diff', 'done', schema);

    // Sync
    const wikiEngine = new WikiEngine(projectRoot);
    const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
    const progressionTracker = new ProgressionTracker(projectRoot);
    const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
    const syncSchemaDir = join(projectRoot, 'adab', 'schemas', configLoader.getActiveSchema());
    const syncSchemaLoader = new SchemaLoader(syncSchemaDir);
    const validator = new MechanicalValidator(syncSchemaLoader, await configLoader.load(), wikiEngine, projectRoot);
    const syncEngine = new SyncEngine(
      projectRoot,
      new WikiDiffParser(),
      new WikiDiffApplier(projectRoot, wikiEngine),
      wikiEngine,
      mentionIndexer,
      progressionTracker,
      contextPacker,
      validator,
    );
    const syncReport = await syncEngine.sync(changeId);
    expect(syncReport.changeId).toBe(changeId);

    // Archive
    const archiveEngine = new ArchiveEngine(projectRoot);
    const archiveReport = await archiveEngine.archive(changeId);
    expect(archiveReport.changeId).toBe(changeId);
    expect(archiveReport.manuscriptPath).not.toBeNull();

    // Verify manuscript updated
    const manuscriptPath = join(projectRoot, 'adab', 'manuscript', 'chapters', 'ch-002.md');
    expect(await fileExists(manuscriptPath)).toBe(true);
    const manuscriptContent = await safeReadFile(manuscriptPath);
    expect(manuscriptContent).toContain('Revision');

    // Verify change archived
    expect(await fileExists(join(projectRoot, 'adab', 'changes', 'archive', changeId, '.openadab.yaml'))).toBe(true);
    expect(await fileExists(changeDir)).toBe(false);

    // Verify log entries
    const logReader = new LogReader(projectRoot);
    const entries = await logReader.readAll();
    const syncEntry = entries.find((e) => e.op === 'sync' && e.change === changeId);
    const archiveEntry = entries.find((e) => e.op === 'archive' && e.change === changeId);
    expect(syncEntry).toBeDefined();
    expect(archiveEntry).toBeDefined();
  });

  it('24.6 edge: sync with empty wiki-diff still updates manifest and indexes', async () => {
    const changeId = 'ch-003';
    const changeDir = join(projectRoot, 'adab', 'changes', changeId);

    const configLoader = new ConfigLoader(projectRoot);
    await configLoader.load();
    const schemaName = configLoader.getActiveSchema();
    const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
    const schemaLoader = new SchemaLoader(schemaDir);
    const schema = await schemaLoader.load();
    const manifestManager = new ManifestManager();
    const manifest = manifestManager.createManifest(changeId, schema);
    await mkdir(changeDir, { recursive: true });
    await manifestManager.writeManifest(changeDir, manifest);

    await writeFile(join(changeDir, 'brief.md'), '---\npov: Mara\n---\n\n# Brief\n\nSteal.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'brief', 'done', schema);
    await writeFile(join(changeDir, 'scene-plan.md'), '---\nchapter: "003"\n---\n\n# Scene Plan\n\nOne.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'scene-plan', 'done', schema);
    await writeFile(join(changeDir, 'draft.md'), '---\nchapter: "003"\n---\n\n# Draft\n\nMara.\n\n---\n\nVault.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'draft', 'done', schema);
    await writeFile(join(changeDir, 'revision.md'), '---\nchapter: "003"\n---\n\n# Revision\n\nMara.\n\n---\n\nVault door.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'revision', 'done', schema);
    await writeFile(join(changeDir, 'continuity-report.md'), '---\nchapter: "003"\n---\n\n# Continuity Report\n\nNone.\n', 'utf-8');
    await manifestManager.updateArtifactStatus(changeDir, 'continuity-report', 'done', schema);
    // No wiki-diff.md

    const wikiEngine = new WikiEngine(projectRoot);
    const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
    const progressionTracker = new ProgressionTracker(projectRoot);
    const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
    const syncSchemaDir2 = join(projectRoot, 'adab', 'schemas', configLoader.getActiveSchema());
    const syncSchemaLoader2 = new SchemaLoader(syncSchemaDir2);
    const validator2 = new MechanicalValidator(syncSchemaLoader2, await configLoader.load(), wikiEngine, projectRoot);
    const syncEngine = new SyncEngine(
      projectRoot,
      new WikiDiffParser(),
      new WikiDiffApplier(projectRoot, wikiEngine),
      wikiEngine,
      mentionIndexer,
      progressionTracker,
      contextPacker,
      validator2,
    );
    const syncReport = await syncEngine.sync(changeId);
    expect(syncReport.wikiPagesModified.length).toBe(0);

    const syncedManifest = await manifestManager.readManifest(changeDir);
    expect(syncedManifest.status).toBe('synced');
  });

  it('regression: aggregate result errors from optional artifacts must not block sync', async () => {
    const configLoader = new ConfigLoader(projectRoot);
    await configLoader.load();
    const schemaDir = join(projectRoot, 'adab', 'schemas', configLoader.getActiveSchema());
    const schema = await new SchemaLoader(schemaDir).load();
    const manifestManager = new ManifestManager();
    const wikiEngine = new WikiEngine(projectRoot);
    const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
    const progressionTracker = new ProgressionTracker(projectRoot);
    const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);

    /**
     * Scaffold a fresh in_progress change with one `done` artifact so the
     * downstream index/manifest steps have a real surface to operate on.
     */
    const makeChange = async (changeId: string): Promise<void> => {
      const changeDir = join(projectRoot, 'adab', 'changes', changeId);
      const manifest = manifestManager.createManifest(changeId, schema);
      await mkdir(changeDir, { recursive: true });
      await manifestManager.writeManifest(changeDir, manifest);
      await writeFile(join(changeDir, 'brief.md'), '---\npov: Mara\n---\n\n# Brief\n\nSteal.\n', 'utf-8');
      await manifestManager.updateArtifactStatus(changeDir, 'brief', 'done', schema);
    };

    /**
     * Build a stubbed MechanicalValidator that returns a controlled set of
     * child results plus an aggregate (`artifactId: 'all'`) carrying the
     * caller-specified errors — exactly what the real `aggregateResults`
     * would produce given those children. The dependency and non-empty
     * checks are stubbed to pass.
     */
    const makeValidator = (aggregateErrors: string[], children: ValidationResult[]): MechanicalValidator => {
      const aggregate: ValidationResult = {
        artifactId: 'all',
        passed: aggregateErrors.length === 0,
        errors: aggregateErrors,
        warnings: [],
      };
      return {
        validateChange: vi.fn().mockResolvedValue([...children, aggregate]),
        validateDependencies: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [] }),
        requireNonEmpty: vi.fn().mockResolvedValue({ passed: true, errors: [], warnings: [], artifactId: '' }),
      } as unknown as MechanicalValidator;
    };

    const makeEngine = (validator: MechanicalValidator): SyncEngine => new SyncEngine(
      projectRoot,
      new WikiDiffParser(),
      new WikiDiffApplier(projectRoot, wikiEngine),
      wikiEngine,
      mentionIndexer,
      progressionTracker,
      contextPacker,
      validator,
    );

    const optionalFileMissing: ValidationResult = {
      artifactId: 'wiki-diff',
      passed: false,
      errors: ['File missing: wiki-diff.md'],
      warnings: [],
    };
    const nonOptionalFrontmatter: ValidationResult = {
      artifactId: 'brief',
      passed: false,
      errors: ['Frontmatter missing or empty'],
      warnings: [],
    };
    const passedChild: ValidationResult = {
      artifactId: 'brief',
      passed: true,
      errors: [],
      warnings: [],
    };

    // Angle 1: aggregate with mixed errors (some optional FILE_MISSING, some non-optional).
    // Only the non-optional error should propagate; the optional FILE_MISSING must not
    // leak back into the errors array via the aggregate's concatenated errors.
    {
      const changeId = 'ch-aggregate-mixed';
      await makeChange(changeId);
      const validator = makeValidator(
        ['File missing: wiki-diff.md', 'Frontmatter missing or empty'],
        [optionalFileMissing, nonOptionalFrontmatter],
      );
      const engine = makeEngine(validator);
      let caught: Error | undefined;
      try {
        await engine.sync(changeId);
      } catch (err) {
        caught = err as Error;
      }
      expect(caught).toBeDefined();
      expect(caught?.message).toContain('Frontmatter missing or empty');
      expect(caught?.message).not.toContain('File missing: wiki-diff.md');
    }

    // Angle 2: aggregate is empty (no errors). Sync must not fail at validation,
    // regardless of what the aggregate entry contains or doesn't contain.
    {
      const changeId = 'ch-aggregate-empty';
      await makeChange(changeId);
      const validator = makeValidator([], [passedChild]);
      const engine = makeEngine(validator);
      const report = await engine.sync(changeId);
      expect(report.changeId).toBe(changeId);
    }

    // Angle 3: aggregate's only errors are FILE_MISSING on optional artifacts.
    // Sync must not fail at validation; the per-child loop correctly filters the
    // optional FILE_MISSING, and the aggregate must not re-inject it.
    {
      const changeId = 'ch-aggregate-optional-only';
      await makeChange(changeId);
      const validator = makeValidator(
        ['File missing: wiki-diff.md'],
        [optionalFileMissing],
      );
      const engine = makeEngine(validator);
      const report = await engine.sync(changeId);
      expect(report.changeId).toBe(changeId);
    }
  });
});
