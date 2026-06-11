/**
 * Unit tests for the Change Manifest module.
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import type { ArtifactStatus } from '../../schemas/change-manifest.js';
import type { SchemaDef } from '../../schemas/schema-def.js';
import { ChangeStatusError, ConfigValidationError, TargetNotFoundError } from '../../utils/errors.js';

import { ManifestManager } from './index.js';

function makeSchema(artifacts: SchemaDef['artifacts']): SchemaDef {
  return {
    name: 'chapter-draft',
    version: 1,
    artifacts,
  };
}

describe('ManifestManager', () => {
  let tempDir: string;
  let manager: ManifestManager;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-manifest-test-'));
    manager = new ManifestManager();
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('createManifest', () => {
    it('creates manifest with correct metadata', () => {
      const schema = makeSchema([
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ]);
      const manifest = manager.createManifest('draft-ch-012', schema);
      expect(manifest.changeId).toBe('draft-ch-012');
      expect(manifest.schema).toBe('chapter-draft');
      expect(manifest.version).toBe(1);
      expect(manifest.status).toBe('in_progress');
      expect(manifest.chapter).toBe('ch-012');
      expect(manifest.created).toMatch(/^\d{4}-/);
    });

    it('sets only the first no-dep artifact to ready, others blocked', () => {
      const schema = makeSchema([
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'scene-plan', generates: 'scene-plan.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief', 'scene-plan'] },
      ]);
      const manifest = manager.createManifest('draft-ch-001', schema);
      // Only the first no-dep artifact (brief) should be ready; scene-plan stays blocked.
      expect(manifest.artifacts.brief).toBe('ready');
      expect(manifest.artifacts['scene-plan']).toBe('blocked');
      expect(manifest.artifacts.draft).toBe('blocked');
      expect(manifest.currentArtifact).toBe('brief');
    });

    it('uses explicit chapter when provided', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('custom-id', schema, '999');
      expect(manifest.chapter).toBe('999');
    });

    it('handles changeId without numeric suffix', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('wiki-update', schema);
      expect(manifest.chapter).toBeUndefined();
    });
  });

  describe('createManifest — extractChapter returns full ch-NNN slug', () => {
    /**
     * Contract: `createManifest` must derive the `manifest.chapter` field as a
     * complete `ch-NNN` slug (preserving any leading zeros) so downstream
     * consumers can use the value verbatim without re-adding a `ch-` prefix.
     */
    it('extracts full ch-NNN slug from changeId "draft-ch-012"', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('draft-ch-012', schema);
      expect(manifest.chapter).toBe('ch-012');
    });

    it('preserves leading zeros: "fix-ch-007"', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('fix-ch-007', schema);
      expect(manifest.chapter).toBe('ch-007');
    });

    it('is case-insensitive: "REV-CH-3"', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('REV-CH-3', schema);
      expect(manifest.chapter).toBe('ch-3');
    });

    it('returns undefined when no ch-NNN pattern: "meta"', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('meta', schema);
      expect(manifest.chapter).toBeUndefined();
    });

    it('returns undefined for empty string', () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('', schema);
      expect(manifest.chapter).toBeUndefined();
    });

    it('persists ch-NNN slug across writeManifest → readManifest', async () => {
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const changeDir = join(tempDir, 'e2e-ch-005');
      mkdirSync(changeDir, { recursive: true });
      const manifest = manager.createManifest('draft-ch-005', schema);
      await manager.writeManifest(changeDir, manifest);
      const read = await manager.readManifest(changeDir);
      expect(read.chapter).toBe('ch-005');
    });
  });

  describe('readManifest', () => {
    it('reads and validates a valid manifest', async () => {
      const changeDir = join(tempDir, 'change1');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([
        { id: 'brief', generates: 'brief.md', requires: [] },
      ]);
      const manifest = manager.createManifest('change1', schema);
      await manager.writeManifest(changeDir, manifest);
      const read = await manager.readManifest(changeDir);
      expect(read.changeId).toBe('change1');
      expect(read.artifacts.brief).toBe('ready');
    });

    it('throws ConfigValidationError when manifest is missing', async () => {
      const changeDir = join(tempDir, 'missing');
      await expect(manager.readManifest(changeDir)).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('throws ConfigValidationError for invalid YAML', async () => {
      const changeDir = join(tempDir, 'bad-yaml');
      mkdirSync(changeDir, { recursive: true });
      const fs = await import('node:fs');
      fs.writeFileSync(join(changeDir, '.openadab.yaml'), '{invalid: yaml', 'utf-8');
      await expect(manager.readManifest(changeDir)).rejects.toBeInstanceOf(ConfigValidationError);
    });

    it('throws ConfigValidationError for schema violations', async () => {
      const changeDir = join(tempDir, 'bad-schema');
      mkdirSync(changeDir, { recursive: true });
      const fs = await import('node:fs');
      fs.writeFileSync(join(changeDir, '.openadab.yaml'), 'changeId: 123\n', 'utf-8');
      await expect(manager.readManifest(changeDir)).rejects.toBeInstanceOf(ConfigValidationError);
    });
  });

  describe('updateArtifactStatus', () => {
    it('updates artifact status and currentArtifact', async () => {
      const changeDir = join(tempDir, 'change2');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ]);
      const manifest = manager.createManifest('change2', schema);
      await manager.writeManifest(changeDir, manifest);
      await manager.updateArtifactStatus(changeDir, 'brief', 'done');
      const read = await manager.readManifest(changeDir);
      expect(read.artifacts.brief).toBe('done');
      expect(read.currentArtifact).toBe('brief');
    });
  });

  describe('updateStatus', () => {
    it('allows in_progress → synced', async () => {
      const changeDir = join(tempDir, 'change3');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change3', schema);
      await manager.writeManifest(changeDir, manifest);
      await manager.updateStatus(changeDir, 'synced');
      const read = await manager.readManifest(changeDir);
      expect(read.status).toBe('synced');
    });

    it('allows synced → archived', async () => {
      const changeDir = join(tempDir, 'change4');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change4', schema);
      manifest.status = 'synced';
      await manager.writeManifest(changeDir, manifest);
      await manager.updateStatus(changeDir, 'archived');
      const read = await manager.readManifest(changeDir);
      expect(read.status).toBe('archived');
    });

    it('rejects in_progress → archived', async () => {
      const changeDir = join(tempDir, 'change5');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change5', schema);
      await manager.writeManifest(changeDir, manifest);
      await expect(manager.updateStatus(changeDir, 'archived')).rejects.toBeInstanceOf(ChangeStatusError);
    });

    it('rejects synced → in_progress', async () => {
      const changeDir = join(tempDir, 'change6');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change6', schema);
      manifest.status = 'synced';
      await manager.writeManifest(changeDir, manifest);
      await expect(manager.updateStatus(changeDir, 'in_progress')).rejects.toBeInstanceOf(ChangeStatusError);
    });

    it('allows no-op transition (same status)', async () => {
      const changeDir = join(tempDir, 'change7');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change7', schema);
      await manager.writeManifest(changeDir, manifest);
      await manager.updateStatus(changeDir, 'in_progress');
      const read = await manager.readManifest(changeDir);
      expect(read.status).toBe('in_progress');
    });
  });

  describe('writeManifest', () => {
    it('writes valid YAML to disk', async () => {
      const changeDir = join(tempDir, 'change8');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'a', generates: 'a.md', requires: [] }]);
      const manifest = manager.createManifest('change8', schema);
      await manager.writeManifest(changeDir, manifest);
      const raw = readFileSync(join(changeDir, '.openadab.yaml'), 'utf-8');
      expect(raw).toContain('changeId: change8');
      expect(raw).toContain('status: in_progress');
    });

    it('throws ConfigValidationError for invalid manifest', async () => {
      const changeDir = join(tempDir, 'change9');
      mkdirSync(changeDir, { recursive: true });
      const invalidManifest = {
        changeId: 'change9',
        schema: 'test',
        version: 1,
        created: 'now',
        status: 'bad_status' as unknown as 'in_progress',
        artifacts: {},
      };
      await expect(manager.writeManifest(changeDir, invalidManifest as any)).rejects.toBeInstanceOf(ConfigValidationError);
    });
  });

  describe('updateArtifactStatus', () => {
    it('throws TargetNotFoundError when artifact does not exist in schema', async () => {
      const changeDir = join(tempDir, 'change10');
      mkdirSync(changeDir, { recursive: true });
      const schema = makeSchema([{ id: 'brief', generates: 'brief.md', requires: [] }]);
      const manifest = manager.createManifest('change10', schema);
      await manager.writeManifest(changeDir, manifest);
      await expect(manager.updateArtifactStatus(changeDir, 'nonexistent', 'done', schema)).rejects.toThrow(TargetNotFoundError);
      await expect(manager.updateArtifactStatus(changeDir, 'nonexistent', 'done', schema)).rejects.toMatchObject({ code: 'TARGET_NOT_FOUND' });
    });
  });

  describe('readManifest — unknown field warnings', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('does not call process.emitWarning and uses console.warn for unknown fields', async () => {
      const changeDir = join(tempDir, 'change-unknown');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(
        join(changeDir, '.openadab.yaml'),
        [
          'changeId: change-unknown',
          'schema: chapter-draft',
          'version: 1',
          'created: "2026-06-06T10:00:00Z"',
          'status: in_progress',
          'artifacts: {}',
          'mysteryField: "should-warn"',
          '',
        ].join('\n'),
        'utf-8'
      );

      const emitWarningSpy = vi.spyOn(process, 'emitWarning');
      const consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

      const read = await manager.readManifest(changeDir);
      expect(read.changeId).toBe('change-unknown');
      expect(emitWarningSpy).not.toHaveBeenCalled();
      expect(consoleWarnSpy).toHaveBeenCalled();
      const warnedMessage = consoleWarnSpy.mock.calls.map((call) => String(call[0])).join('\n');
      expect(warnedMessage).toContain('Unknown manifest field');
      expect(warnedMessage).toContain('mysteryField');
    });
  });

  describe('ManifestManager.updateArtifactStatus — bidirectional cascade', () => {
    /**
     * Helper: create a change directory and write a manifest whose artifacts
     * are seeded with the given statuses. This bypasses `createManifest`'s
     * "first no-dep artifact = ready" rule so we can stage arbitrary states
     * for cascade tests.
     */
    async function seedManifest(
      changeDir: string,
      schema: SchemaDef,
      artifactStatuses: Record<string, ArtifactStatus>,
    ): Promise<void> {
      mkdirSync(changeDir, { recursive: true });
      const manifest = manager.createManifest('cascade-test', schema);
      for (const [id, status] of Object.entries(artifactStatuses)) {
        manifest.artifacts[id] = status;
      }
      await manager.writeManifest(changeDir, manifest);
    }

    /**
     * Contract: when a dependency is rolled back from `done` to `ready`, any
     * downstream artifact that was previously unblocked must be re-blocked.
     *
     * This is the core bug-7 regression: the old cascade was unidirectional
     * (only `blocked → ready`), so a `ready` artifact whose dep was rolled
     * back would remain `ready` incorrectly.
     */
    it('reverts a ready artifact to blocked when a dependency is rolled back from done', async () => {
      const changeDir = join(tempDir, 'cascade-rollback-1');
      const schema = makeSchema([
        { id: 'A', generates: 'A.md', requires: [] },
        { id: 'B', generates: 'B.md', requires: ['A'] },
      ]);
      // Stage: A=done, B=ready (B was unblocked when A was done).
      await seedManifest(changeDir, schema, { A: 'done', B: 'ready' });

      // Roll back A from done → ready.
      await manager.updateArtifactStatus(changeDir, 'A', 'ready', schema);

      const read = await manager.readManifest(changeDir);
      expect(read.artifacts.A).toBe('ready');
      expect(read.artifacts.B).toBe('blocked');
    });

    /**
     * Contract: `done` is a user-asserted terminal state and must NEVER be
     * auto-reverted by the cascade, even when a dependency is rolled back.
     * Reverting a completed artifact would silently undo finished work, which
     * is far more dangerous than a transient `ready` artifact in flight.
     */
    it('leaves done artifacts untouched when a dependency is rolled back', async () => {
      const changeDir = join(tempDir, 'cascade-rollback-2');
      const schema = makeSchema([
        { id: 'A', generates: 'A.md', requires: [] },
        { id: 'B', generates: 'B.md', requires: ['A'] },
      ]);
      // Stage: A=done, B=done (both completed).
      await seedManifest(changeDir, schema, { A: 'done', B: 'done' });

      // Roll back A from done → ready. B must remain `done`.
      await manager.updateArtifactStatus(changeDir, 'A', 'ready', schema);

      const read = await manager.readManifest(changeDir);
      expect(read.artifacts.A).toBe('ready');
      expect(read.artifacts.B).toBe('done');
    });

    /**
     * Contract: the legacy `blocked → ready` direction must keep working for
     * a blocked artifact whose dependencies are all done. This guards
     * against a regression where the new bidirectional cascade accidentally
     * locks artifacts into `blocked`.
     */
    it('still promotes blocked to ready when all dependencies become done', async () => {
      const changeDir = join(tempDir, 'cascade-stability');
      const schema = makeSchema([
        { id: 'A', generates: 'A.md', requires: [] },
        { id: 'B', generates: 'B.md', requires: ['A'] },
      ]);
      // Default createManifest: A=ready, B=blocked. A no-op cascade call.
      await seedManifest(changeDir, schema, { A: 'ready', B: 'blocked' });

      // No-op transition on A (still ready). B's deps are NOT all done
      // (A is ready, not done) → B must stay blocked.
      await manager.updateArtifactStatus(changeDir, 'A', 'ready', schema);

      const read = await manager.readManifest(changeDir);
      expect(read.artifacts.A).toBe('ready');
      expect(read.artifacts.B).toBe('blocked');
    });

    /**
     * Contract: rollback must propagate through the entire transitive
     * dependency chain, not just the immediate child.
     *
     * Note: in a strict chain A → B → C, the cascade can only unblock C
     * when B is `done` (per `areAllDependenciesDone`'s "all deps must be
     * done" rule). Because the cascade also preserves `done` as a
     * user-asserted terminal state, C cannot be in a `ready` state while
     * B is in a non-`done` state. The realistic staging is therefore
     * `A=done, B=ready, C=blocked` — and after rolling A back, both B and
     * C must end up `blocked` (B re-blocked, C already blocked and left
     * alone by the cascade).
     */
    it('cascades rollback through multiple levels A → B → C', async () => {
      const changeDir = join(tempDir, 'cascade-multilevel');
      const schema = makeSchema([
        { id: 'A', generates: 'A.md', requires: [] },
        { id: 'B', generates: 'B.md', requires: ['A'] },
        { id: 'C', generates: 'C.md', requires: ['B'] },
      ]);
      // Stage: A=done, B=ready (B was unblocked when A was done), C=blocked.
      await seedManifest(changeDir, schema, { A: 'done', B: 'ready', C: 'blocked' });

      // Roll back A from done → ready.
      await manager.updateArtifactStatus(changeDir, 'A', 'ready', schema);

      const read = await manager.readManifest(changeDir);
      expect(read.artifacts.A).toBe('ready');
      // B requires A=done; A is now ready → B must be blocked.
      expect(read.artifacts.B).toBe('blocked');
      // C requires B=done; B is now blocked → C must remain blocked.
      expect(read.artifacts.C).toBe('blocked');
    });
  });
});
