import { mkdtempSync, writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

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
});
