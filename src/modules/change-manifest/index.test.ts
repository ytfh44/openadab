/**
 * Unit tests for the Change Manifest module.
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


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
      expect(manifest.chapter).toBe('012');
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
});
