/**
 * Integration test: full chapter-draft workflow.
 *
 * Covers init → new chapter → write brief → status → write scene-plan →
 * draft → revision → continuity-report → wiki-diff → sync → archive.
 */
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { ArchiveEngine } from '../../src/modules/archive-engine/index.js';
import { ArtifactGraph } from '../../src/modules/artifact-graph/index.js';
import { ManifestManager } from '../../src/modules/change-manifest/index.js';
import { ContextPacker } from '../../src/modules/context-packer/index.js';
import { MechanicalValidator } from '../../src/modules/mechanical-validator/index.js';
import { MentionIndexer } from '../../src/modules/mention-indexer/index.js';
import { ProgressionTracker } from '../../src/modules/progression-tracker/index.js';
import { ConfigLoader } from '../../src/modules/project-config/index.js';
import { SchemaLoader } from '../../src/modules/schema-engine/index.js';
import { SyncEngine } from '../../src/modules/sync-engine/index.js';
import { WikiDiffApplier, WikiDiffParser } from '../../src/modules/wiki-diff-engine/index.js';
import { WikiEngine } from '../../src/modules/wiki-engine/index.js';
import { fileExists } from '../../src/utils/fs.js';
import { createMinimalProject } from './fixture.js';
describe('chapter-draft workflow', () => {
    let projectRoot;
    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
        await createMinimalProject(projectRoot);
    });
    it('24.2 runs full workflow from init to archive', async () => {
        const changeId = 'ch-002';
        const changeDir = join(projectRoot, 'adab', 'changes', changeId);
        // new chapter
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
        // write brief
        const briefPath = join(changeDir, 'brief.md');
        await writeFile(briefPath, `---\npov: Mara\ntone: tense\nchapter_goal: Introduce the heist.\n---\n\n# Brief\n\nGoal: steal the jewel.\n`, 'utf-8');
        // status after brief
        const graph = new ArtifactGraph(schema);
        const status = await graph.toJson(changeDir);
        expect(status.artifacts.find((a) => a.id === 'brief')?.status).toBe('done');
        expect(status.artifacts.find((a) => a.id === 'scene-plan')?.status).toBe('ready');
        // write scene-plan
        const scenePlanPath = join(changeDir, 'scene-plan.md');
        await writeFile(scenePlanPath, `---\nchapter: "002"\nscene_count: 1\n---\n\n# Scene Plan\n\n## Scene 1\n\n- **Location:** Docks\n- **Characters:** Mara\n- **Purpose:** Setup\n- **Estimated Words:** 500\n`, 'utf-8');
        // write draft
        const draftPath = join(changeDir, 'draft.md');
        await writeFile(draftPath, `---\nchapter: "002"\nword_count: 1200\n---\n\n# Draft\n\nMara crept through the Docks under moonlight.\n\n---\n\nShe reached the vault.\n`, 'utf-8');
        // write revision
        const revisionPath = join(changeDir, 'revision.md');
        await writeFile(revisionPath, `---\nchapter: "002"\nword_count: 1300\n---\n\n# Revision\n\nMara crept through the Docks under pale moonlight.\n\n---\n\nShe reached the vault door.\n`, 'utf-8');
        // write continuity-report
        const reportPath = join(changeDir, 'continuity-report.md');
        await writeFile(reportPath, `---\nchapter: "002"\n---\n\n# Continuity Report\n\n- Thread "The Heist" advanced.\n- Mara now knows the guard schedule.\n`, 'utf-8');
        // write wiki-diff
        const wikiDiffPath = join(changeDir, 'wiki-diff.md');
        await writeFile(wikiDiffPath, `---\nchangeId: ${changeId}\n---\n\n### [[characters/mara]]\n\nSource: ${changeId}/continuity-report.md\n\n#### Add to Current State\n\n- Planning the heist at the Docks.\n\n#### Add to Knowledge Timeline\n\n| Chapter | Knowledge |\n|---------|-----------|\n| 002 | Knows guard schedule |\n`, 'utf-8');
        // sync
        const wikiEngine = new WikiEngine(projectRoot);
        const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
        const progressionTracker = new ProgressionTracker(projectRoot);
        const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
        const syncSchemaDir = join(projectRoot, 'adab', 'schemas', configLoader.getActiveSchema());
        const syncSchemaLoader = new SchemaLoader(syncSchemaDir);
        const validator = new MechanicalValidator(syncSchemaLoader, await configLoader.load(), wikiEngine, projectRoot);
        const syncEngine = new SyncEngine(projectRoot, new WikiDiffParser(), new WikiDiffApplier(projectRoot, wikiEngine), wikiEngine, mentionIndexer, progressionTracker, contextPacker, validator);
        const syncReport = await syncEngine.sync(changeId);
        expect(syncReport.changeId).toBe(changeId);
        expect(syncReport.wikiPagesModified.length).toBeGreaterThan(0);
        // manifest status synced
        const syncedManifest = await manifestManager.readManifest(changeDir);
        expect(syncedManifest.status).toBe('synced');
        // archive
        const archiveEngine = new ArchiveEngine(projectRoot);
        const archiveReport = await archiveEngine.archive(changeId);
        expect(archiveReport.changeId).toBe(changeId);
        expect(archiveReport.manuscriptPath).not.toBeNull();
        expect(await fileExists(archiveReport.archivePath)).toBe(true);
        expect(await fileExists(join(projectRoot, 'adab', 'manuscript', 'chapters', 'ch-002.md'))).toBe(true);
    });
    it('24.2 edge: archiving unsynced change throws', async () => {
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
        const archiveEngine = new ArchiveEngine(projectRoot);
        await expect(archiveEngine.archive(changeId)).rejects.toThrow('not synced');
    });
});
//# sourceMappingURL=chapter-draft-workflow.test.js.map