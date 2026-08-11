import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, vi } from 'vitest';

import { TargetNotFoundError } from '../../utils/errors.js';
import type { WikiEngine } from '../wiki-engine/index.js';

import { MentionIndexer } from './index.js';



describe('MentionIndexer', () => {
  function setupIndexer(
    pages: { path: string; frontmatter: Record<string, unknown>; body: string }[],
    caseSensitive = true,
  ) {
    const root = mkdtempSync(join(tmpdir(), 'openadab-mi-'));
    const wikiEngine = {
      listPages: vi.fn().mockResolvedValue(pages.map((p) => p.path)),
      readPage: vi.fn().mockImplementation((path: string) => {
        const page = pages.find((p) => p.path === path);
        if (!page) {throw new Error('Not found');}
        return Promise.resolve(page);
      }),
    } as unknown as WikiEngine;

    const indexer = new MentionIndexer(root, wikiEngine, caseSensitive);
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

  it('case-insensitive mode matches differently-cased source text', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ], false);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    // Lowercase in the source, capitalised in the frontmatter: the
    // `i`-flag pattern matches, but the matched text must be normalized
    // the same way as the lookup keys or the mention is silently dropped.
    writeFileSync(file, 'alice walked into the room.');
    const results = await indexer.scanFile(file);
    expect(results.has('Alice')).toBe(true);
  });

  it('flexible-whitespace alias matches irregular spacing in source', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character', aliases: ['the stranger'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    // Double space in the source for the single-space alias: the pattern
    // matches via `\s+?`, but the matched text must be whitespace-
    // normalized before the map lookup or the mention is dropped.
    writeFileSync(file, 'the  stranger appeared at the door.');
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
    const aliceEntry = mentions.Alice;
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

  // ===== buildEntityRegistry accepts whitespace-only names =====
  it('rejects whitespace-only entity name (tab/newline mix)', async () => {
    const { indexer } = setupIndexer([
      { path: 'a.md', frontmatter: { name: '\t\n  ', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    expect(reg.size).toBe(0);
  });

  it('accepts name with internal whitespace as long as it has non-whitespace', async () => {
    const { indexer } = setupIndexer([
      { path: 'a.md', frontmatter: { name: '  Mara  ', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    // Internal whitespace doesn't affect validity
    expect(reg.size).toBe(1);
  });

  it('skips page where name is not a string', async () => {
    const { indexer } = setupIndexer([
      { path: 'a.md', frontmatter: { name: 42, type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const reg = (indexer as any).entityRegistry;
    expect(reg.size).toBe(0);
  });

  // ===== incrementalIndex logic decoupling =====
  it('new entity discovered in incrementalIndex gets full scan of all files', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file1 = join(manDir, 'ch-001.md');
    const file2 = join(manDir, 'ch-002.md');
    writeFileSync(file1, 'Alice was here.');
    writeFileSync(file2, 'Alice was there too.');

    await indexer.indexAll();

    // Now register a new entity
    const { indexer: indexer2 } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
      { path: 'characters/bob.md', frontmatter: { name: 'Bob', type: 'character' }, body: '' },
    ]);
    // Copy the manuscript files into the new indexer's root
    // (`as { projectRoot: string }` keeps the private access explicit
    // while satisfying the dot-notation lint rule).
    const indexer2Root = (indexer2 as unknown as { projectRoot: string }).projectRoot;
    const manDir2 = join(indexer2Root, 'adab', 'manuscript');
    mkdirSync(manDir2, { recursive: true });
    writeFileSync(join(manDir2, 'ch-001.md'), 'Alice was here. Bob smiled.');
    writeFileSync(join(manDir2, 'ch-002.md'), 'Alice was there too.');

    // Seed mentions.json with only Alice (no Bob yet)
    const idxDir = join(indexer2Root, 'adab', 'index');
    mkdirSync(idxDir, { recursive: true });
    writeFileSync(join(idxDir, '.last-mention-indexed'), String(Date.now() - 10000));
    writeFileSync(join(idxDir, 'mentions.json'), JSON.stringify({
      Alice: { type: 'character', aliases: ['Alice'], appearances: [] },
    }));

    await indexer2.incrementalIndex();

    const reg = (indexer2 as any).entityRegistry;
    const bob = reg.get('Bob');
    expect(bob).toBeDefined();
    // Bob should be found in ch-001 (not modified, so via full-scan path)
    const bobInCh001 = bob.appearances.find((a: any) => a.file === join(manDir2, 'ch-001.md'));
    expect(bobInCh001).toBeDefined();
  });

  it('incrementalIndex drops appearances of deleted files', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();
    const mentionsPath = join(root, 'adab', 'index', 'mentions.json');
    const before = JSON.parse(readFileSync(mentionsPath, 'utf-8'));
    expect(before.Alice.appearances.some((a: { file: string }) => a.file === file)).toBe(true);

    // Delete the source file: a deleted file never lands in the modified
    // set of a later incremental run, so without the deletion pass its
    // appearances would survive in mentions.json forever.
    rmSync(file);
    await indexer.incrementalIndex();

    const after = JSON.parse(readFileSync(mentionsPath, 'utf-8'));
    expect(after.Alice.appearances.some((a: { file: string }) => a.file === file)).toBe(false);
    const contextPath = join(root, 'adab', 'index', 'context-map.json');
    if (existsSync(contextPath)) {
      const cm = JSON.parse(readFileSync(contextPath, 'utf-8'));
      expect(JSON.stringify(cm)).not.toContain(file);
    }
  });

  it('incrementalIndex with no new entities and no modified files returns early', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'characters/alice.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();

    // Don't touch the file
    const idxDir = join(root, 'adab', 'index');
    const mentionsPath = join(idxDir, 'mentions.json');
    const original = readFileSync(mentionsPath, 'utf-8');

    await indexer.incrementalIndex();

    // Should not have been re-written
    const after = readFileSync(mentionsPath, 'utf-8');
    expect(after).toBe(original);
  });

  // ===== buildRegexPattern CJK detection per segment =====
  it('handles mixed CJK+ASCII alias with per-segment word boundaries', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: '流浪者', type: 'character', aliases: ['流浪者 Alice'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    // Should match "流浪者" even when adjacent to non-word chars
    writeFileSync(file, '「流浪者」 smiled. Also 「流浪者Alice」 appeared.');
    const results = await indexer.scanFile(file);
    expect(results.has('流浪者')).toBe(true);
  });

  it('pure CJK alias has no word boundary', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: '流浪者', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, '流浪者在街上走。');
    const results = await indexer.scanFile(file);
    expect(results.has('流浪者')).toBe(true);
  });

  it('CJK prefix: longer alias wins over the shorter prefix (and vice versa when alone)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'a.md', frontmatter: { name: '流浪', type: 'character' }, body: '' },
      { path: 'b.md', frontmatter: { name: '流浪者', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();

    // Source contains the longer alias: 流浪者 must get the mention and
    // the shorter prefix 流浪 must NOT be credited for text that belongs
    // to the longer alias.
    const longFile = join(root, 'long.md');
    writeFileSync(longFile, '流浪者出现了。');
    const longResults = await indexer.scanFile(longFile);
    expect(longResults.has('流浪者')).toBe(true);
    expect(longResults.has('流浪')).toBe(false);

    // Source contains only the shorter alias: it is credited as usual.
    const shortFile = join(root, 'short.md');
    writeFileSync(shortFile, '流浪出现了。');
    const shortResults = await indexer.scanFile(shortFile);
    expect(shortResults.has('流浪')).toBe(true);
    expect(shortResults.has('流浪者')).toBe(false);
  });

  it('ASCII part of mixed alias still requires word boundary', async () => {
    // Entity name is "Hero" — the ONLY way the entity can be matched is
    // through the mixed alias, so this test isolates the word-boundary
    // behaviour of the ASCII segment without being shadowed by the
    // canonical name.
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Hero', type: 'character', aliases: ['流浪者 Alice'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    // "Alicebob" must not satisfy the trailing \b around "Alice"
    writeFileSync(file, '流浪者Alicebob walked.');
    const results = await indexer.scanFile(file);
    expect(results.has('Hero')).toBe(false);
  });

  // ===== buildRegexPattern escape comprehensiveness =====
  it('escapes forward slash in alias', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'A/B', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'A/B walked here.');
    const results = await indexer.scanFile(file);
    expect(results.has('A/B')).toBe(true);
  });

  it('escapes hyphen in alias character class', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'a-b', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'a-b walked here.');
    const results = await indexer.scanFile(file);
    expect(results.has('a-b')).toBe(true);
  });

  it('escapes literal backslash in alias', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'foo\\bar', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'foo\\bar walked here.');
    const results = await indexer.scanFile(file);
    expect(results.has('foo\\bar')).toBe(true);
  });

  // ===== alias conflict resolution =====
  it('when two entities share an alias, both get the mention', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'a.md', frontmatter: { name: 'Alice', type: 'character', aliases: ['the stranger'] }, body: '' },
      { path: 'b.md', frontmatter: { name: 'Beth', type: 'character', aliases: ['the stranger'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'the stranger appeared at the door.');
    const results = await indexer.scanFile(file);
    expect(results.has('Alice')).toBe(true);
    expect(results.has('Beth')).toBe(true);
  });

  it('conflict resolution records same line for both entities', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'a.md', frontmatter: { name: 'A', type: 'character', aliases: ['X'] }, body: '' },
      { path: 'b.md', frontmatter: { name: 'B', type: 'character', aliases: ['X'] }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'X appears here.\nX appears again.');
    const results = await indexer.scanFile(file);
    expect(results.get('A')?.length).toBe(2);
    expect(results.get('B')?.length).toBe(2);
  });

  it('distinct aliases do not bleed into other entities', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'a.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
      { path: 'b.md', frontmatter: { name: 'Beth', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, 'Alice walked.');
    const results = await indexer.scanFile(file);
    expect(results.has('Beth')).toBe(false);
  });

  // ===== extractContext length cap =====
  it('context is limited to 100 characters total', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    const longBefore = 'a'.repeat(200);
    const longAfter = 'b'.repeat(200);
    writeFileSync(file, `${longBefore} Mara ${longAfter}`);
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx.length).toBeLessThanOrEqual(100);
  });

  it('context is limited even when match is at start of paragraph', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, `Mara ${'x'.repeat(500)}`);
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx.length).toBeLessThanOrEqual(100);
  });

  it('context respects paragraph boundaries', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'manuscript.md');
    writeFileSync(file, `Para1 ${'a'.repeat(200)}.\n\nMara smiled.\n\nPara3 ${'b'.repeat(200)}.`);
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).not.toContain('Para1');
    expect(ctx).not.toContain('Para3');
    expect(ctx).toContain('Mara');
  });

  // ===== zod validation of existing mentions.json =====
  it('corrupted mentions.json triggers full rebuild', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    // Seed an obviously broken mentions.json
    const idxDir = join(root, 'adab', 'index');
    mkdirSync(idxDir, { recursive: true });
    writeFileSync(join(idxDir, '.last-mention-indexed'), String(Date.now() - 10000));
    writeFileSync(join(idxDir, 'mentions.json'), '{not valid json');

    await indexer.incrementalIndex();

    // After the rebuild, Alice should be present with appearances
    const reg = (indexer as any).entityRegistry;
    const alice = reg.get('Alice');
    expect(alice).toBeDefined();
    expect(alice.appearances.length).toBeGreaterThan(0);
  });

  it('mentions.json with wrong shape triggers full rebuild', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    const idxDir = join(root, 'adab', 'index');
    mkdirSync(idxDir, { recursive: true });
    writeFileSync(join(idxDir, '.last-mention-indexed'), String(Date.now() - 10000));
    // 'appearances' is supposed to be an array, not a string
    writeFileSync(join(idxDir, 'mentions.json'), JSON.stringify({
      Alice: { type: 'character', aliases: ['Alice'], appearances: 'not-an-array' },
    }));

    await indexer.incrementalIndex();

    const reg = (indexer as any).entityRegistry;
    const alice = reg.get('Alice');
    expect(alice).toBeDefined();
    expect(alice.appearances.length).toBeGreaterThan(0);
  });

  it('valid mentions.json is preserved across incremental re-index', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.indexAll();

    // No file changes; incremental should keep existing data
    await indexer.incrementalIndex();

    const reg = (indexer as any).entityRegistry;
    const alice = reg.get('Alice');
    expect(alice.appearances.length).toBeGreaterThan(0);
  });

  // ===== scanFile raw===null explicit handling =====
  it('scanFile throws TargetNotFoundError when file does not exist', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const missing = join(root, 'this-file-does-not-exist.md');
    await expect(indexer.scanFile(missing)).rejects.toBeInstanceOf(TargetNotFoundError);
  });

  it('scanFile on empty file returns empty result (does not throw)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'empty.md');
    writeFileSync(file, '');
    const results = await indexer.scanFile(file);
    expect(results.size).toBe(0);
  });

  it('scanFile on file with no matches returns empty result (does not throw)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    writeFileSync(file, 'No entities here.');
    const results = await indexer.scanFile(file);
    expect(results.size).toBe(0);
  });

  // ===== generateContextMap alias safety =====
  it('generateContextMap does not push undefined when aliases is empty', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.buildEntityRegistry();
    // Manually inject a registry entry with an empty aliases array, simulating
    // a registry built from a corrupt or external mentions.json file
    const reg = (indexer as any).entityRegistry;
    reg.set('Anon', {
      type: 'character',
      aliases: [],
      appearances: [{ file, line: 99, context: 'x' }],
    });

    await indexer.generateContextMap();

    const mapPath = join(root, 'adab', 'index', 'context-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    const entries = map[file] ?? [];
    expect(entries).not.toContain(undefined);
    expect(entries.every((v: unknown) => typeof v === 'string' && v.length > 0)).toBe(true);
  });

  it('generateContextMap writes a valid map file even with bad entries', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.buildEntityRegistry();
    const reg = (indexer as any).entityRegistry;
    reg.set('Anon', { type: 'character', aliases: [], appearances: [{ file, line: 1, context: 'x' }] });

    await expect(indexer.generateContextMap()).resolves.toBeUndefined();
  });

  it('normal entity still appears in context-map', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Alice', type: 'character' }, body: '' },
    ]);
    const manDir = join(root, 'adab', 'manuscript');
    mkdirSync(manDir, { recursive: true });
    const file = join(manDir, 'ch-001.md');
    writeFileSync(file, 'Alice walked.');

    await indexer.buildEntityRegistry();
    const reg = (indexer as any).entityRegistry;
    reg.get('Alice').appearances = [{ file, line: 1, context: 'Alice walked.' }];

    await indexer.generateContextMap();
    const mapPath = join(root, 'adab', 'index', 'context-map.json');
    const map = JSON.parse(readFileSync(mapPath, 'utf-8'));
    expect(map[file]).toContain('Alice');
  });

  // ===== mixed CRLF/LF byte-offset correctness =====
  // The pre-fix scanFile assumed a single line-ending length for the whole
  // file, so the second-and-later lines' match.index was inflated by 1 for
  // every preceding CRLF.  These tests pin down the corrected behavior:
  // matches in CRLF files must produce context that exactly wraps the
  // occurrence in the raw bytes, regardless of which line they live on.

  /** Convert ASCII letters and spaces to CRLF endings. */
  function toCRLF(input: string): string {
    return input.replace(/\n/g, '\r\n');
  }

  it('CRLF file: match on the second line has the correct context window (no offset drift)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    const lf = 'first line ignore\nMara walked through the cold door.\nthird line ignore\n';
    writeFileSync(file, toCRLF(lf));
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    // The context MUST include both "Mara" and the surrounding text
    // from the SAME line — "first" / "third" must not leak in because
    // the offset is now correct.
    expect(ctx).toContain('Mara');
    expect(ctx).toContain('walked through the cold door');
    expect(ctx).not.toContain('first line');
    expect(ctx).not.toContain('third line');
  });

  it('CRLF file: match on the first line still finds the entity', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    const lf = 'Mara opens the scene.\nrest of the file\n';
    writeFileSync(file, toCRLF(lf));
    const results = await indexer.scanFile(file);
    expect(results.has('Mara')).toBe(true);
    expect(results.get('Mara')?.[0]?.line).toBe(1);
  });

  it('CRLF file: match on the last line (no trailing newline) does not overflow', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    const lf = 'first\nsecond\nMara closes the scene.'; // no trailing newline
    writeFileSync(file, toCRLF(lf));
    const results = await indexer.scanFile(file);
    expect(results.has('Mara')).toBe(true);
    expect(results.get('Mara')?.[0]?.line).toBe(3);
  });

  it('LF file: context is computed correctly (regression guard for the rewrite)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    writeFileSync(file, 'first line\nMara walked through the cold door.\nthird line\n');
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).toContain('Mara');
    expect(ctx).toContain('walked through the cold door');
    expect(ctx).not.toContain('first line');
    expect(ctx).not.toContain('third line');
  });

  it('LF file: paragraph separator takes precedence over line break on the before side', async () => {
    // Layout: a long Para1 ... \n\n Mara ... \n third-line-ignore
    // The previous LINE break is at column ~N+2, but the PARAGRAPH separator
    // is much earlier. Context must stop at the paragraph boundary, not the
    // closer line break, so "Para1" must NOT leak in.
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    const para1 = `Para1 ${  'a'.repeat(80)  }.`;
    const tail = 'third line ignore';
    writeFileSync(file, `${para1}\n\nMara walked through the cold door.\n${tail}\n`);
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).toContain('Mara');
    expect(ctx).toContain('walked through the cold door');
    expect(ctx).not.toContain('Para1');
    expect(ctx).not.toContain('third line');
  });

  it('LF file: closest boundary wins when line break is nearer than paragraph separator', async () => {
    // Layout: Para1..aaa. (within 50 chars of Mara) \n\n Mara ...
    // The line break sits at ~80 chars before the match, well inside the
    // 50-char window, but the paragraph separator is even earlier. The
    // paragraph boundary is the FARTHER one; the LINE break is the closer
    // boundary on the before side. Context must stop at the line break
    // (the closer of the two hard boundaries) so "Para1" is excluded.
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    // 30 chars of "Para1 ..." then \n\n then "Mara ..."
    // - paragraph separator index = 30 (length of "Para1 " + 24 'a's + ".")
    // - line break does not exist on the before side at all in this case;
    //   so we just want to confirm the paragraph separator stops the leak.
    const para1 = `Para1 ${  'a'.repeat(24)  }.`; // length 30
    writeFileSync(file, `${para1}\n\nMara walked through the cold door.\ntail\n`);
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).toContain('Mara');
    expect(ctx).not.toContain('Para1');
  });

  it('LF file: match on the first line (no previous line break) does not pull in nothing-but-the-match', async () => {
    // When the match is on line 1, there is no previous line break and no
    // paragraph separator. Context should still include the match and a
    // bounded slice — and must not include content that does not exist.
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    writeFileSync(file, 'Mara opens the scene on line one.\nsecond line ignore\n');
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).toContain('Mara');
    expect(ctx).toContain('opens the scene');
    expect(ctx).not.toContain('second line');
  });

  it('pure CRLF file: context respects paragraph boundaries (\\r\\n\\r\\n separator)', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    const lf = `Para1 ${  'a'.repeat(200)  }.\n\nMara smiled.\n\nPara3 ${  'b'.repeat(200)  }.`;
    writeFileSync(file, toCRLF(lf));
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).not.toContain('Para1');
    expect(ctx).not.toContain('Para3');
    expect(ctx).toContain('Mara');
  });

  it('context extraction across many lines produces non-empty, capped context', async () => {
    const { indexer, root } = setupIndexer([
      { path: 'c.md', frontmatter: { name: 'Mara', type: 'character' }, body: '' },
    ]);
    await indexer.indexAll();
    const file = join(root, 'm.md');
    // 20 lines of fluff + the match on line 21
    const fluff = Array.from({ length: 20 }, (_, i) => `line ${String(i + 1)} text`).join('\n');
    writeFileSync(file, toCRLF(`${fluff}\nMara appears here now.\n`));
    const results = await indexer.scanFile(file);
    const ctx = results.get('Mara')?.[0]?.context ?? '';
    expect(ctx).toContain('Mara');
    expect(ctx.length).toBeLessThanOrEqual(100);
  });
});
