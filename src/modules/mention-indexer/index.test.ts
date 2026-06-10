import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { WikiEngine } from '../wiki-engine/index.js';

import { MentionIndexer } from './index.js';



describe('MentionIndexer', () => {
  function setupIndexer(pages: { path: string; frontmatter: Record<string, unknown>; body: string }[]) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-mi-'));
    const wikiEngine = {
      listPages: vi.fn().mockResolvedValue(pages.map((p) => p.path)),
      readPage: vi.fn().mockImplementation((path: string) => {
        const page = pages.find((p) => p.path === path);
        if (!page) {throw new Error('Not found');}
        return Promise.resolve(page);
      }),
    } as unknown as WikiEngine;

    const indexer = new MentionIndexer(root, wikiEngine);
    return { root, indexer, wikiEngine };
  }

  it('exact name match', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'Alice walked into the room.');
    const results = await indexer.scanFile(file);
    expect(results.has('Alice')).toBe(true);
  });

  it('alias match', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character', aliases: ['Alicia'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'Alicia walked into the room.');
    const results = await indexer.scanFile(file);
    expect(results.has('Alice')).toBe(true);
  });

  it('enforces word boundaries for English', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/al.md', frontmatter: { name: 'Al', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'Alice walked into the room.');
    const results = await indexer.scanFile(file);
    expect(results.has('Al')).toBe(false);
  });

  it('multi-entity per file', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
      { path: 'characters/bob.md', frontmatter: { name: 'Bob', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'Alice and Bob went hiking.');
    const results = await indexer.scanFile(file);
    expect(results.has('Alice')).toBe(true);
    expect(results.has('Bob')).toBe(true);
  });

  it('incremental update removes stale appearances', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manuscriptDir = join(root, 'adab', 'manuscript');
    mkdirSync(manuscriptDir, { recursive: true });
    const file = join(manuscriptDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();
    let entry = (indexer as any).entityRegistry.get('Alice');
    expect(entry.appearances.length).toBeGreaterThan(0);

    writeFileSync(file, 'Bob walked.');
    await indexer.incrementalIndex();
    entry = (indexer as any).entityRegistry.get('Alice');
    expect(entry.appearances.some((a: any) => a.file === file)).toBe(false);
  });

  it('context-map inversion is correct', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manuscriptDir = join(root, 'adab', 'manuscript');
    mkdirSync(manuscriptDir, { recursive: true });
    const file = join(manuscriptDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();
    await indexer.generateContextMap();
    const mapPath = join(root, 'adab', 'index', 'context-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    expect(map[file]).toBeDefined();
    expect(Array.isArray(map[file])).toBe(true);
    expect(map[file]).toContain('Alice');
  });

  it('excludes archived changes from index', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);

    // Create active change file (should be indexed)
    const activeDir = join(root, 'adab', 'changes', 'ch-001');
    mkdirSync(activeDir, { recursive: true });
    const activeFile = join(activeDir, 'draft.md');
    writeFileSync(activeFile, 'Alice entered the tavern.');

    // Create archived change file (should NOT be indexed)
    const archiveDir = join(root, 'adab', 'changes', 'archive', 'ch-000');
    mkdirSync(archiveDir, { recursive: true });
    const archiveFile = join(archiveDir, 'draft.md');
    writeFileSync(archiveFile, 'Alice left the village.');

    await indexer.indexAll();

    // Active change should appear in mentions.json
    const mentionsPath = join(root, 'adab', 'index', 'mentions.json');
    const mentions = JSON.parse(readFileSync(mentionsPath, 'utf-8'));
    const aliceEntry = mentions['Alice'];
    expect(aliceEntry).toBeDefined();
    const activeMatch = aliceEntry.appearances.find((a: any) => a.file === activeFile);
    expect(activeMatch).toBeDefined();
    const archiveMatch = aliceEntry.appearances.find((a: any) => a.file === archiveFile);
    expect(archiveMatch).toBeUndefined();

    // Active change should appear in context-map; archived should not
    const mapPath = join(root, 'adab', 'index', 'context-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    expect(map[activeFile]).toBeDefined();
    expect(map[archiveFile]).toBeUndefined();
  });

  it('indexAll writes timestamp to .last-mention-indexed, not .last-indexed', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();

    const oldPath = join(root, 'adab', 'index', '.last-indexed');
    const newPath = join(root, 'adab', 'index', '.last-mention-indexed');

    // Old shared file must NOT be created by mention-indexer
    expect(existsSync(oldPath)).toBe(false);
    // New dedicated file must exist with a valid timestamp
    const ts = readFileSync(newPath, 'utf-8').trim();
    const parsed = parseInt(ts, 10);
    expect(Number.isNaN(parsed)).toBe(false);
    expect(parsed).toBeGreaterThan(0);
  });

  it('incrementalIndex writes timestamp to .last-mention-indexed', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);

    // First run: full index; then modify a file and run incremental
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();

    // Modify the file
    writeFileSync(file, 'Alice ran.');

    await indexer.incrementalIndex();

    const oldPath = join(root, 'adab', 'index', '.last-indexed');
    const newPath = join(root, 'adab', 'index', '.last-mention-indexed');

    // Old shared file must NOT be created by mention-indexer
    expect(existsSync(oldPath)).toBe(false);
    // New dedicated file must exist
    expect(existsSync(newPath)).toBe(true);
  });

  it('mention-indexer and progression-tracker timestamps are independent', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);

    await indexer.indexAll();
    const miPath = join(root, 'adab', 'index', '.last-mention-indexed');
    const miTs1 = parseInt(readFileSync(miPath, 'utf-8').trim(), 10);

    // Simulate progression-tracker writing its own timestamp (different file)
    const ptPath = join(root, 'adab', 'index', '.last-progression-indexed');
    const ptExpected = Date.now() + 5000;
    writeFileSync(ptPath, String(ptExpected));

    // Now re-run mention-indexer — it should update ONLY .last-mention-indexed
    // but .last-progression-indexed should be untouched
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    writeFileSync(join(manDir, 'ch-001.md'), 'Alice walked.');
    await indexer.indexAll();

    const miTs2 = parseInt(readFileSync(miPath, 'utf-8').trim(), 10);
    const ptTs = parseInt(readFileSync(ptPath, 'utf-8').trim(), 10);

    // Mention timestamp updated
    expect(miTs2).toBeGreaterThan(miTs1);
    // Progression timestamp unchanged (mock value from earlier)
    expect(ptTs).toBe(ptExpected);
  });

  it('rejects whitespace-only entity name', async () => {
    const { indexer } = setupIndexer([
      { path: 'characters/ghost.md', frontmatter: { name: '   ', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    // Whitespace-only "   " must not be registered
    expect(reg.has('   ')).toBe(false);
    expect(reg.size).toBe(0);
  });

  it('accepts valid entity name', async () => {
    const { indexer } = setupIndexer([
      { path: 'characters/mara.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    expect(reg.has('Mara')).toBe(true);
    expect(reg.size).toBe(1);
  });

  it('rejects empty entity name', async () => {
    const { indexer } = setupIndexer([
      { path: 'characters/nobody.md', frontmatter: { name: '', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    expect(reg.has('')).toBe(false);
    expect(reg.size).toBe(0);
  });
});
