import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { AdabError } from '../../utils/errors.js';

import { ArchiveEngine } from './index.js';


describe('ArchiveEngine', () => {
  function setupProject(overrides?: { manifestStatus?: string; backupOnOverwrite?: boolean; hasRevision?: boolean; existingManuscript?: boolean }) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-archive-'));
    const changesDir = join(root, 'adab', 'changes', 'draft-ch-012');
    mkdirSync(changesDir, { recursive: true });

    const manifest: Record<string, unknown> = {
      changeId: 'draft-ch-012',
      schema: 'chapter-draft',
      version: 1,
      created: new Date().toISOString(),
      status: overrides?.manifestStatus ?? 'synced',
      artifacts: {},
    };
    writeFileSync(join(changesDir, '.openadab.yaml'), JSON.stringify(manifest));

    if (overrides?.hasRevision !== false) {
      writeFileSync(join(changesDir, 'revision.md'), '---\ntitle: Ch 12\n---\n\nChapter body');
    }

    const config: Record<string, unknown> = {
      schema: 'chapter-draft',
      version: 1,
      project: { title: 'T', language: 'zh-CN', genre: 'fantasy', tense: 'past', pov: 'limited-third' },
      context: { maxTokens: 18000, alwaysInclude: [], tokenHeuristic: 'chars-per-token', excludePatterns: [] },
      rules: {},
      archive: { backupOnOverwrite: overrides?.backupOnOverwrite ?? false },
    };
    writeFileSync(join(root, 'adab', 'config.yaml'), JSON.stringify(config));

    if (overrides?.existingManuscript === true) {
      const manuscriptDir = join(root, 'adab', 'manuscript', 'chapters');
      mkdirSync(manuscriptDir, { recursive: true });
      writeFileSync(join(manuscriptDir, 'ch-012.md'), 'old content');
    }

    return { root, changesDir };
  }

  it('rejects unsynced changes', async () => {
    const { root } = setupProject({ manifestStatus: 'in_progress' });
    const engine = new ArchiveEngine(root);
    await expect(engine.archive('draft-ch-012')).rejects.toThrow(AdabError);
    await expect(engine.archive('draft-ch-012')).rejects.toThrow(/not synced/);
  });

  it('copies revision to manuscript when synced', async () => {
    const { root } = setupProject({ manifestStatus: 'synced' });
    const engine = new ArchiveEngine(root);
    const report = await engine.archive('draft-ch-012');
    expect(report.changeId).toBe('draft-ch-012');
    expect(report.manuscriptPath).toBe(join(root, 'adab', 'manuscript', 'chapters', 'ch-012.md'));
    expect(report.manuscriptPath).not.toBeNull();
    expect(existsSync(report.manuscriptPath!)).toBe(true);
    expect(readFileSync(report.manuscriptPath!, 'utf-8')).toContain('Chapter body');
  });

  it('creates backup on overwrite when config says so', async () => {
    const { root } = setupProject({ manifestStatus: 'synced', backupOnOverwrite: true, existingManuscript: true });
    const engine = new ArchiveEngine(root);
    const report = await engine.archive('draft-ch-012');
    expect(report.backupCreated).toBe(true);
    const manuscriptDir = join(root, 'adab', 'manuscript', 'chapters');
    const { readdirSync } = await import('node:fs');
    const files = readdirSync(manuscriptDir);
    expect(files.some((f: string) => f.includes('.bak.'))).toBe(true);
  });

  it('throws when change does not exist', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-archive-missing-'));
    mkdirSync(join(root, 'adab', 'changes'), { recursive: true });
    const engine = new ArchiveEngine(root);
    await expect(engine.archive('nonexistent')).rejects.toThrow(AdabError);
    await expect(engine.archive('nonexistent')).rejects.toThrow(/not found/);
  });

  it('writes manuscript as ch-NNN.md (not ch-ch-NNN.md, not bare NNN.md)', async () => {
    const { root } = setupProject({ manifestStatus: 'synced' });
    const engine = new ArchiveEngine(root);
    const report = await engine.archive('draft-ch-012');
    const expectedPath = join(root, 'adab', 'manuscript', 'chapters', 'ch-012.md');
    expect(report.manuscriptPath).toBe(expectedPath);
    expect(existsSync(expectedPath)).toBe(true);
    expect(existsSync(join(root, 'adab', 'manuscript', 'chapters', 'ch-ch-012.md'))).toBe(false);
    expect(existsSync(join(root, 'adab', 'manuscript', 'chapters', '012.md'))).toBe(false);
  });

  it('infers chapterId as the full ch-NNN slug (consumed uniformly by callers)', async () => {
    const { root } = setupProject({ manifestStatus: 'synced' });
    const engine = new ArchiveEngine(root);
    const report = await engine.archive('draft-ch-012');
    expect(report.logEntry.details?.chapter).toBe('ch-012');
    expect(report.manuscriptPath).toContain('ch-012.md');
  });

  // ==================== AE-1: force=true with archive target already exists ====================
  describe('AE-1: force+duplicate archive target', () => {
    it('force=true with existing archive target renames existing to .bak-{ts} and proceeds', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const archiveDir = join(root, 'adab', 'changes', 'archive', 'draft-ch-012');
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(join(archiveDir, 'old-marker.txt'), 'previously archived');
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012', true);
      expect(report.archivePath).toBe(archiveDir);
      expect(existsSync(archiveDir)).toBe(true);
      // The previous content should be preserved under a .bak-{ts} path
      const changesArchive = join(root, 'adab', 'changes', 'archive');
      const entries = readdirSync(changesArchive);
      const bakDirs = entries.filter((e) => e.startsWith('draft-ch-012.bak-'));
      expect(bakDirs.length).toBeGreaterThan(0);
    });

    it('force=false with existing archive target throws ARCHIVE_DUPLICATE', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const archiveDir = join(root, 'adab', 'changes', 'archive', 'draft-ch-012');
      mkdirSync(archiveDir, { recursive: true });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('draft-ch-012', false)).rejects.toMatchObject({ code: 'ARCHIVE_DUPLICATE' });
    });

    it('force=true with no existing archive target still succeeds (no bak created)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012', true);
      // Cross-platform: match either `archive/draft-ch-012` or `archive\draft-ch-012`
      expect(report.archivePath).toMatch(/archive[\\/]draft-ch-012(?:[\\/]|$)/);
      const archiveDir = join(root, 'adab', 'changes', 'archive');
      const entries = readdirSync(archiveDir);
      expect(entries.some((e) => e.startsWith('draft-ch-012.bak-'))).toBe(false);
    });
  });

  // ==================== AE-2: appendLog failure does not abort archive ====================
  describe('AE-2: appendLog failure is non-fatal', () => {
    it('when LogWriter.append throws, archive still reports success and adds warning', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      // Force log append failure by stubbing LogWriter.prototype.append
      const { LogWriter } = await import('../log/index.js');
      const originalAppend = LogWriter.prototype.append;
      const appendSpy = vi.spyOn(LogWriter.prototype, 'append').mockRejectedValueOnce(new Error('log fs full'));
      try {
        const report = await engine.archive('draft-ch-012');
        // Archive should still succeed: change moved, manuscript copied
        expect(report.changeId).toBe('draft-ch-012');
        expect(existsSync(report.archivePath)).toBe(true);
        expect(existsSync(report.manuscriptPath!)).toBe(true);
        expect(report.warnings).toBeDefined();
        expect(report.warnings!.length).toBeGreaterThan(0);
        expect(report.warnings!.join(' ')).toMatch(/log/i);
        expect(appendSpy).toHaveBeenCalledTimes(1);
      } finally {
        appendSpy.mockRestore();
        originalAppend;
      }
    });

    it('warnings field is an empty array when appendLog succeeds', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012');
      expect(report.warnings).toEqual([]);
    });

    it('archive operation completes even if log write fails repeatedly', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const { LogWriter } = await import('../log/index.js');
      const appendSpy = vi.spyOn(LogWriter.prototype, 'append').mockRejectedValue(new Error('disk error'));
      try {
        const report = await engine.archive('draft-ch-012');
        expect(report.archivePath).toBeDefined();
        expect(report.warnings!.length).toBeGreaterThan(0);
      } finally {
        appendSpy.mockRestore();
      }
    });
  });

  // ==================== AE-3: archive/ subdirectory is excluded from conflict scan ====================
  describe('AE-3: archive/ subdirectory excluded from conflict scan', () => {
    it('does NOT detect a previously-archived change as a conflict', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      // Simulate an earlier-archived change of the same chapter still on disk
      const archiveDir = join(root, 'adab', 'changes', 'archive', 'revise-ch-012');
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(
        join(archiveDir, '.openadab.yaml'),
        'changeId: revise-ch-012\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: in_progress\nartifacts: {}\n',
      );
      const engine = new ArchiveEngine(root);
      // Should NOT throw ARCHIVE_CONFLICT
      const report = await engine.archive('draft-ch-012');
      expect(report.changeId).toBe('draft-ch-012');
    });

    it('still detects a real in-progress conflict under changes/', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const otherDir = join(root, 'adab', 'changes', 'revise-ch-012');
      mkdirSync(otherDir, { recursive: true });
      writeFileSync(
        join(otherDir, '.openadab.yaml'),
        'changeId: revise-ch-012\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: in_progress\nartifacts: {}\n',
      );
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('draft-ch-012', false)).rejects.toMatchObject({ code: 'ARCHIVE_CONFLICT' });
    });

    it('archive target is not treated as a conflict for itself', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report1 = await engine.archive('draft-ch-012');
      expect(report1.archivePath).toBeDefined();
      // Re-archiving the same id (still in changes/ until renamed) would normally be
      // a no-op state; this test just verifies the archive target directory is not
      // flagged as a conflict during the scan.
      expect(existsSync(report1.archivePath)).toBe(true);
    });
  });

  // ==================== AE-4: loadProjectConfig throws on invalid YAML ====================
  describe('AE-4: config YAML parse failure throws AdabError', () => {
    it('throws AdabError with code CONFIG_INVALID when config.yaml is malformed', async () => {
      const { root } = setupProject({ manifestStatus: 'synced', existingManuscript: true });
      // Corrupt the config file with invalid YAML
      writeFileSync(join(root, 'adab', 'config.yaml'), 'archive: {backupOnOverwrite: [\n  unterminated');
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('draft-ch-012')).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
    });

    it('does not silently disable backupOnOverwrite when config is corrupt', async () => {
      const { root } = setupProject({ manifestStatus: 'synced', existingManuscript: true });
      writeFileSync(join(root, 'adab', 'config.yaml'), ': invalid: yaml: : :');
      const engine = new ArchiveEngine(root);
      // The error should propagate, not be swallowed
      await expect(engine.archive('draft-ch-012')).rejects.toBeInstanceOf(AdabError);
    });

    it('succeeds when config is missing (treated as default)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      rmSync(join(root, 'adab', 'config.yaml'));
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012');
      expect(report.changeId).toBe('draft-ch-012');
    });
  });

  // ==================== AE-6: changeDir path-traversal check ====================
  describe('AE-6: changeDir path boundary check', () => {
    it('rejects path-traversal changeDir with PATH_TRAVERSAL code', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('../escape')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
      await expect(engine.archive('../escape')).rejects.toThrow(/boundary|traversal/i);
    });

    it('rejects absolute path changeDir', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('/etc/passwd')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('accepts a normal changeDir (sanity check)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012');
      expect(report.changeId).toBe('draft-ch-012');
    });

    it('rejects empty changeDir', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects changeDir containing NUL byte (C-string truncation attack)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('foo\0bar')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects changeDir containing forward slash separator', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('sub/dir')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects changeDir containing backslash separator (Windows-style)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('sub\\dir')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects changeDir that is exactly ".."', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('..')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });

    it('rejects deeply nested traversal (../../etc/passwd)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      await expect(engine.archive('../../etc/passwd')).rejects.toMatchObject({ code: 'PATH_TRAVERSAL' });
    });
  });

  // ==================== AE-7: backup filename includes randomUUID ====================
  describe('AE-7: backup filename uses randomUUID to avoid same-ms collision', () => {
    it('backup file name contains a UUID segment (not just timestamp)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced', backupOnOverwrite: true, existingManuscript: true });
      const engine = new ArchiveEngine(root);
      await engine.archive('draft-ch-012');
      const manuscriptDir = join(root, 'adab', 'manuscript', 'chapters');
      const files = readdirSync(manuscriptDir);
      const bak = files.find((f) => f.includes('.bak.'));
      expect(bak).toBeDefined();
      // The bak filename format is ch-NNN.md.bak.{timestamp}-{uuid}
      // Verify UUID-like segment is present (8-4-4-4-12 hex pattern)
      const uuidPattern = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;
      expect(bak!).toMatch(uuidPattern);
    });

    it('two archives in quick succession produce distinct backup names', async () => {
      const { root } = setupProject({ manifestStatus: 'synced', backupOnOverwrite: true, existingManuscript: true });
      const engine = new ArchiveEngine(root);
      await engine.archive('draft-ch-012');
      // Re-setup: create new change dir
      const newChangeDir = join(root, 'adab', 'changes', 'draft-ch-013');
      mkdirSync(newChangeDir, { recursive: true });
      writeFileSync(
        join(newChangeDir, '.openadab.yaml'),
        'changeId: draft-ch-013\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: synced\nartifacts: {}\n',
      );
      writeFileSync(join(newChangeDir, 'revision.md'), '# Ch13');
      // Create existing ch-013 manuscript so backup triggers
      writeFileSync(join(root, 'adab', 'manuscript', 'chapters', 'ch-013.md'), 'old');
      await engine.archive('draft-ch-013');
      const manuscriptDir = join(root, 'adab', 'manuscript', 'chapters');
      const files = readdirSync(manuscriptDir);
      const baks = files.filter((f) => f.includes('.bak.'));
      expect(baks.length).toBe(2);
      expect(baks[0]).not.toBe(baks[1]);
    });
  });

  // ==================== AE-8: case-insensitive chapterId ====================
  describe('AE-8: case-insensitive chapterId inference', () => {
    it('uppercase changeDir produces same ch-012 chapterId as lowercase', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('DRAFT-CH-012');
      expect(report.logEntry.details?.chapter).toBe('ch-012');
      expect(report.manuscriptPath).toContain('ch-012.md');
    });

    it('mixed-case changeDir still infers ch-NNN correctly', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('Draft-Ch-012');
      expect(report.logEntry.details?.chapter).toBe('ch-012');
    });

    it('chapters with non-zero-padded numbers still parse (e.g. ch-1)', async () => {
      // Make a custom project where the change dir is "draft-ch-1"
      const root = mkdtempSync(join(tmpdir(), 'openadab-archive-case-'));
      const changeDir = join(root, 'adab', 'changes', 'draft-ch-1');
      mkdirSync(changeDir, { recursive: true });
      writeFileSync(
        join(changeDir, '.openadab.yaml'),
        'changeId: draft-ch-1\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: synced\nartifacts: {}\n',
      );
      writeFileSync(join(changeDir, 'revision.md'), '# Ch1');
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-1');
      expect(report.logEntry.details?.chapter).toBe('ch-1');
    });
  });

  // ==================== AE-9: manuscriptPath uses backupCreated flag, not TOCTOU ====================
  describe('AE-9: manuscriptPath reflects post-backup state', () => {
    it('manuscriptPath is the chapter file path when revision exists', async () => {
      const { root } = setupProject({ manifestStatus: 'synced' });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012');
      expect(report.manuscriptPath).toBe(join(root, 'adab', 'manuscript', 'chapters', 'ch-012.md'));
    });

    it('manuscriptPath is null when revision does not exist (no TOCTOU recheck)', async () => {
      const { root } = setupProject({ manifestStatus: 'synced', hasRevision: false });
      const engine = new ArchiveEngine(root);
      const report = await engine.archive('draft-ch-012');
      expect(report.manuscriptPath).toBeNull();
    });
  });

  // ==================== AE-10: distinguish in_progress vs archived ====================
  describe('AE-10: distinguish not-synced vs already-archived', () => {
    it('status=in_progress throws ARCHIVE_NOT_SYNCED with helpful message', async () => {
      const { root } = setupProject({ manifestStatus: 'in_progress' });
      const engine = new ArchiveEngine(root);
      let caught: unknown;
      try {
        await engine.archive('draft-ch-012');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AdabError);
      expect((caught as AdabError).code).toBe('ARCHIVE_NOT_SYNCED');
      expect((caught as Error).message).toMatch(/Run `openadab sync/);
    });

    it('status=archived throws ARCHIVE_ALREADY_ARCHIVED with distinct message', async () => {
      const { root } = setupProject({ manifestStatus: 'archived' });
      const engine = new ArchiveEngine(root);
      let caught: unknown;
      try {
        await engine.archive('draft-ch-012');
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(AdabError);
      expect((caught as AdabError).code).toBe('ARCHIVE_ALREADY_ARCHIVED');
      expect((caught as Error).message).toMatch(/already archived/);
    });

    it('the two errors are distinguishable by code (different code, not just message)', async () => {
      const root1 = mkdtempSync(join(tmpdir(), 'openadab-archive-archived-'));
      const cd1 = join(root1, 'adab', 'changes', 'draft-ch-001');
      mkdirSync(cd1, { recursive: true });
      writeFileSync(join(cd1, '.openadab.yaml'), 'changeId: draft-ch-001\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: archived\nartifacts: {}\n');
      const engine1 = new ArchiveEngine(root1);
      let archivedErr: AdabError | null = null;
      try { await engine1.archive('draft-ch-001'); } catch (err) { archivedErr = err as AdabError; }
      expect(archivedErr?.code).toBe('ARCHIVE_ALREADY_ARCHIVED');

      const { root: root2 } = setupProject({ manifestStatus: 'in_progress' });
      const engine2 = new ArchiveEngine(root2);
      let notSyncedErr: AdabError | null = null;
      try { await engine2.archive('draft-ch-012'); } catch (err) { notSyncedErr = err as AdabError; }
      expect(notSyncedErr?.code).toBe('ARCHIVE_NOT_SYNCED');
      expect(archivedErr?.code).not.toBe(notSyncedErr?.code);
    });
  });

  // ==================== AE-11: backup drain failure reverts manifest status ====================
  describe('AE-11: moveDirContents failure leaves change retryable', () => {
    it('reverts manifest status to synced and keeps the change in changes/ when the drain fails', async () => {
      const { root, changesDir } = setupProject({ manifestStatus: 'synced' });
      const archiveDir = join(root, 'adab', 'changes', 'archive', 'draft-ch-012');
      mkdirSync(archiveDir, { recursive: true });
      writeFileSync(join(archiveDir, 'old-marker.txt'), 'previously archived');
      const engine = new ArchiveEngine(root);

      // Simulate a failure inside the backup drain (e.g. a leftover file the
      // engine cannot move) by stubbing the drain method, mirroring the
      // LogWriter.prototype.append stub convention used in AE-2.
      const drainSpy = vi
        .spyOn(
          ArchiveEngine.prototype as unknown as { moveDirContents: (srcDir: string, destDir: string) => Promise<void> },
          'moveDirContents',
        )
        .mockRejectedValue(new Error('simulated drain failure'));

      try {
        await expect(engine.archive('draft-ch-012', true)).rejects.toThrow(/simulated drain failure/);

        // Manifest status must be reverted so the change stays retryable:
        // an `archived` manifest still sitting in changes/ would make every
        // retry throw ARCHIVE_ALREADY_ARCHIVED.
        const manifestRaw = readFileSync(join(changesDir, '.openadab.yaml'), 'utf-8');
        expect(manifestRaw).toContain('synced');
        expect(manifestRaw).not.toContain('archived');

        // The change directory was not renamed away.
        expect(existsSync(changesDir)).toBe(true);
      } finally {
        drainSpy.mockRestore();
      }
    });
  });
});
