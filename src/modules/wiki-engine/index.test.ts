/**
 * Unit tests for the Wiki Engine module.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { TargetNotFoundError, AdabError } from '../../utils/errors.js';

import { WikiEngine, type WikilinkGraph } from './index.js';


describe('WikiEngine', () => {
  let tempDir: string;
  let engine: WikiEngine;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-wiki-test-'));
    mkdirSync(join(tempDir, 'adab', 'wiki'), { recursive: true });
    mkdirSync(join(tempDir, 'adab', 'index'), { recursive: true });
    engine = new WikiEngine(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('readPage', () => {
    it('reads a page with valid frontmatter', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'characters');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: character\nname: Mara\nstatus: canon\n---\n# Mara\nA courtier.`;
      writeFileSync(join(dir, 'mara.md'), content, 'utf-8');
      const page = await engine.readPage('characters/mara.md');
      expect(page.frontmatter.name).toBe('Mara');
      expect(page.body.trim()).toBe('# Mara\nA courtier.');
    });

    it('throws TargetNotFoundError for missing page', async () => {
      await expect(engine.readPage('missing.md')).rejects.toBeInstanceOf(TargetNotFoundError);
    });

    it('throws AdabError for invalid frontmatter', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'characters');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: character\n---\n# Mara\n`;
      writeFileSync(join(dir, 'mara.md'), content, 'utf-8');
      await expect(engine.readPage('characters/mara.md')).rejects.toBeInstanceOf(AdabError);
    });

    it('validates location frontmatter requires name and location_type', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'locations');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: location\nname: East Gate\nlocation_type: gate\nstatus: canon\n---\n# East Gate\n`;
      writeFileSync(join(dir, 'east-gate.md'), content, 'utf-8');
      const page = await engine.readPage('locations/east-gate.md');
      expect(page.frontmatter.location_type).toBe('gate');
    });

    it('validates thread frontmatter requires enum status', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'threads');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: thread\nname: Betrayal\nstatus: open\n---\n# Betrayal\n`;
      writeFileSync(join(dir, 'betrayal.md'), content, 'utf-8');
      const page = await engine.readPage('threads/betrayal.md');
      expect(page.frontmatter.status).toBe('open');
    });

    it('rejects thread with invalid status string', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'threads');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: thread\nname: Betrayal\nstatus: invalid\n---\n# Betrayal\n`;
      writeFileSync(join(dir, 'betrayal.md'), content, 'utf-8');
      await expect(engine.readPage('threads/betrayal.md')).rejects.toBeInstanceOf(AdabError);
    });

    it('falls back to synthetic frontmatter when page has no frontmatter markers at all', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '# A Plain Page\nSome text without any frontmatter.';
      writeFileSync(join(dir, 'plain-page.md'), content, 'utf-8');
      const page = await engine.readPage('misc/plain-page.md');
      expect(page.frontmatter.type).toBe('unknown');
      expect(page.frontmatter._synthetic).toBe(true);
      expect(page.body.trim()).toBe('# A Plain Page\nSome text without any frontmatter.');
    });

    it('falls back to synthetic frontmatter when page has only empty frontmatter delimiters', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '---\n---\n# Empty Frontmatter\nJust text.';
      writeFileSync(join(dir, 'empty-fm.md'), content, 'utf-8');
      const page = await engine.readPage('misc/empty-fm.md');
      expect(page.frontmatter.type).toBe('unknown');
      expect(page.frontmatter._synthetic).toBe(true);
    });

    it('uses fallbackType option when provided', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '# No Type Page\n';
      writeFileSync(join(dir, 'no-type.md'), content, 'utf-8');
      const page = await engine.readPage('misc/no-type.md', { fallbackType: 'other' });
      expect(page.frontmatter.type).toBe('other');
      expect(page.frontmatter._synthetic).toBe(true);
    });

    it('normal page with valid frontmatter does not have _synthetic', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'characters');
      mkdirSync(dir, { recursive: true });
      const content = `---\ntype: character\nname: Mara\nstatus: canon\n---\n# Mara\n`;
      writeFileSync(join(dir, 'mara.md'), content, 'utf-8');
      const page = await engine.readPage('characters/mara.md');
      expect(page.frontmatter._synthetic).toBeUndefined();
      expect(page.frontmatter.type).toBe('character');
    });

    // type === '' or null triggers synthetic fallback
    it('synthetic fallback when frontmatter has empty type string', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '---\ntype: ""\n---\n# Empty Type\n';
      writeFileSync(join(dir, 'empty-type.md'), content, 'utf-8');
      const page = await engine.readPage('misc/empty-type.md');
      expect(page.frontmatter._synthetic).toBe(true);
      expect(page.frontmatter.type).toBe('unknown');
    });

    it('synthetic fallback when frontmatter type is explicitly null', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '---\ntype:\n---\n# Null Type\n';
      writeFileSync(join(dir, 'null-type.md'), content, 'utf-8');
      const page = await engine.readPage('misc/null-type.md');
      expect(page.frontmatter._synthetic).toBe(true);
      expect(page.frontmatter.type).toBe('unknown');
    });

    it('synthetic fallback for type === "" honors fallbackType option', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'misc');
      mkdirSync(dir, { recursive: true });
      const content = '---\ntype: ""\n---\n# Empty Type\n';
      writeFileSync(join(dir, 'empty-type.md'), content, 'utf-8');
      const page = await engine.readPage('misc/empty-type.md', { fallbackType: 'other' });
      expect(page.frontmatter._synthetic).toBe(true);
      expect(page.frontmatter.type).toBe('other');
    });
  });

  describe('writePage', () => {
    it('writes a page and updates last_updated', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nA courtier.');
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      expect(raw).toContain('type: character');
      expect(raw).toContain('last_updated:');
    });

    it('throws for invalid frontmatter', async () => {
      await expect(
        engine.writePage('characters/mara.md', { type: 'character' }, '# Mara')
      ).rejects.toBeInstanceOf(AdabError);
    });

    it('preserves extra frontmatter fields', async () => {
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', first_seen: 'ch-001', tags: ['court'] },
        '# Mara'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      expect(raw).toContain('first_seen: ch-001');
      expect(raw).toContain('tags:');
    });

    // unknown frontmatter fields are preserved (passthrough)
    it('preserves unknown scalar custom frontmatter fields on first write', async () => {
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', custom_field: 'secret-value' },
        '# Mara'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      expect(raw).toContain('custom_field: secret-value');
    });

    it('preserves unknown array custom frontmatter fields on first write', async () => {
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', affiliations: ['house-a', 'house-b'] },
        '# Mara'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      expect(raw).toContain('affiliations:');
      expect(raw).toContain('house-a');
      expect(raw).toContain('house-b');
    });

    it('preserves custom fields across a subsequent update', async () => {
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', custom_field: 'first' },
        '# Mara'
      );
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'advanced' },
        '# Mara updated'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      expect(raw).toContain('custom_field: first');
      expect(raw).toContain('status: advanced');
    });

    // empty or null type must be rejected by validation
    it('throws AdabError when type is empty string in frontmatter', async () => {
      await expect(
        engine.writePage('characters/mara.md', { type: '', name: 'Mara', status: 'canon' }, '# Mara')
      ).rejects.toBeInstanceOf(AdabError);
    });

    it('throws AdabError when type is null in frontmatter', async () => {
      await expect(
        engine.writePage('characters/mara.md', { type: null, name: 'Mara', status: 'canon' } as unknown as Record<string, unknown>, '# Mara')
      ).rejects.toBeInstanceOf(AdabError);
    });

    // concurrent writes all eventually reach the index
    it('concurrent writes are all eventually indexed', async () => {
      const p1 = engine.writePage('characters/a.md', { type: 'character', name: 'A', status: 'canon' }, '# A');
      const p2 = engine.writePage('characters/b.md', { type: 'character', name: 'B', status: 'canon' }, '# B');
      await Promise.all([p1, p2]);
      // Allow any pending re-regen triggered by the dirty flag to finish
      await new Promise((resolve) => setTimeout(resolve, 200));
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('[[characters/a]]');
      expect(index).toContain('[[characters/b]]');
    });

    // P0-3 regression: callers (notably WikiDiffApplier) supply a semantic
    // `last_updated` value (e.g., the operation's source path) and writePage
    // must preserve it instead of always overwriting with the wall clock.
    it('preserves caller-supplied last_updated value (does not overwrite)', async () => {
      const semanticStamp = 'manuscript/chapters/ch-014.md';
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', last_updated: semanticStamp },
        '# Mara'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      // Accept either bare or YAML-quoted serialization of the semantic
      // stamp (gray-matter may single-quote strings starting with a slash
      // path, depending on version).
      const hasBare = raw.includes(`last_updated: ${semanticStamp}`);
      const hasSingle = raw.includes(`last_updated: '${semanticStamp}'`);
      const hasDouble = raw.includes(`last_updated: "${semanticStamp}"`);
      expect(hasBare || hasSingle || hasDouble).toBe(true);
    });

    // P0-3 regression: when the caller does not supply `last_updated`,
    // writePage must still default to the current ISO timestamp so the
    // field remains populated for non-diff callers.
    it('defaults last_updated to current ISO only when the field is absent', async () => {
      const before = new Date().toISOString();
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon' },
        '# Mara'
      );
      const after = new Date().toISOString();
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      const match = /last_updated: (?:"([^"]+)"|'([^']+)'|(\S+))/.exec(raw);
      expect(match).not.toBeNull();
      const stamp = match?.[1] ?? match?.[2] ?? match?.[3] ?? '';
      // The defaulted stamp must be a parseable ISO string within the window
      // bracketing the call — not the synthetic source path from the diff
      // applier, and not a value pinned to caller-supplied semantics.
      expect(stamp).not.toBe('manuscript/chapters/ch-014.md');
      expect(Number.isNaN(Date.parse(stamp))).toBe(false);
      expect(Date.parse(stamp) >= Date.parse(before)).toBe(true);
      expect(Date.parse(stamp) <= Date.parse(after)).toBe(true);
    });

    // P0-3 regression: when a page already on disk carries a `last_updated`
    // (the typical case after a first write that used either a caller
    // semantic value or the default ISO) and the next caller does not
    // supply `last_updated`, writePage must preserve the on-disk value
    // rather than re-stamping it with the wall clock. This covers the
    // synthetic-fallback read path: `readPage` may produce a synthetic
    // frontmatter that omits `last_updated`, but on a subsequent
    // `writePage` round-trip we must not silently re-time-stamp the page.
    it('preserves existing last_updated from the file on disk when caller does not supply it', async () => {
      const pinnedStamp = '2024-01-15T10:00:00.000Z';
      // First write establishes the page with an explicit `last_updated`.
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'canon', last_updated: pinnedStamp },
        '# Mara v1'
      );
      // Second write omits `last_updated`. The existing on-disk value
      // (merged into the validated frontmatter) must be preserved.
      await engine.writePage(
        'characters/mara.md',
        { type: 'character', name: 'Mara', status: 'advanced' },
        '# Mara v2'
      );
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'), 'utf-8');
      // YAML may quote the ISO string on round-trip because it contains a
      // colon; accept either the bare or quoted serialization.
      const hasBare = raw.includes(`last_updated: ${pinnedStamp}`);
      const hasSingle = raw.includes(`last_updated: '${pinnedStamp}'`);
      const hasDouble = raw.includes(`last_updated: "${pinnedStamp}"`);
      expect(hasBare || hasSingle || hasDouble).toBe(true);
    });
  });

  describe('listPages', () => {
    it('lists all pages excluding derived files', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'b.md'), '---\ntype: location\nname: B\nlocation_type: city\nstatus: x\n---\n# B', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '# Index', 'utf-8');
      const pages = await engine.listPages();
      expect(pages).toContain('a.md');
      expect(pages).toContain('b.md');
      expect(pages).not.toContain('index.md');
    });

    it('lists all pages excluding overview.md and contradictions.md', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '# Overview', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '# Contradictions', 'utf-8');
      const pages = await engine.listPages();
      expect(pages).toContain('a.md');
      expect(pages).not.toContain('overview.md');
      expect(pages).not.toContain('contradictions.md');
    });

    it('filters by type', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'b.md'), '---\ntype: location\nname: B\nlocation_type: city\nstatus: x\n---\n# B', 'utf-8');
      const characters = await engine.listPages('character');
      expect(characters).toEqual(['a.md']);
    });

    it('returns empty array when no pages match type', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      const threads = await engine.listPages('thread');
      expect(threads).toEqual([]);
    });

    it('includes synthetic pages (pages without frontmatter) in full listing', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'b.md'), '# No frontmatter here\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'c.md'), '---\ntype: location\nname: C\nlocation_type: city\nstatus: x\n---\n# C', 'utf-8');
      const pages = await engine.listPages();
      expect(pages).toContain('a.md');
      expect(pages).toContain('b.md');
      expect(pages).toContain('c.md');
    });

    it('still filters by type for pages with valid frontmatter', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'b.md'), '# No frontmatter here\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'c.md'), '---\ntype: location\nname: C\nlocation_type: city\nstatus: x\n---\n# C', 'utf-8');
      const characters = await engine.listPages('character');
      expect(characters).toEqual(['a.md']);
    });
  });

  describe('deletePage', () => {
    it('deletes an existing page', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'a.md'), '---\ntype: character\nname: A\nstatus: x\n---\n# A', 'utf-8');
      await engine.deletePage('a.md');
      expect(() => readFileSync(join(tempDir, 'adab', 'wiki', 'a.md'))).toThrow();
    });

    it('throws TargetNotFoundError for missing page', async () => {
      await expect(engine.deletePage('missing.md')).rejects.toBeInstanceOf(TargetNotFoundError);
    });
  });

  describe('generateIndex', () => {
    it('generates wikilinks using lowercase page path, not frontmatter name', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nA courtier.');
      await engine.writePage('locations/east-gate.md', { type: 'location', name: 'East Gate', location_type: 'gate', status: 'canon' }, '# East Gate\nA gate.');
      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('# Wiki Index');
      expect(index).toContain('[[characters/mara]]');
      expect(index).toContain('[[locations/east-gate]]');
      // Must NOT use the original case frontmatter name in the link target
      expect(index).not.toContain('[[character/Mara]]');
      expect(index).not.toContain('[[location/East Gate]]');
    });

    it('wikilink path matches page path even when frontmatter name contains spaces or capitals', async () => {
      await engine.writePage('characters/jane-doe.md', { type: 'character', name: 'Jane Doe', status: 'canon' }, '# Jane');
      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('[[characters/jane-doe]]');
    });

    it('includes summary from first heading', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara the Courtier\nText.');
      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('Mara the Courtier');
    });

    // empty/unknown type renders as "Uncategorized"
    it('typeLabel returns "Uncategorized" for empty type', () => {
      const label = (engine as unknown as { typeLabel(t: string): string }).typeLabel('');
      expect(label).toBe('Uncategorized');
    });

    it('typeLabel returns "Uncategorized" for whitespace-only type', () => {
      const label = (engine as unknown as { typeLabel(t: string): string }).typeLabel('   ');
      expect(label).toBe('Uncategorized');
    });

    it('typeLabel still returns plural labels for known types', () => {
      const label = (engine as unknown as { typeLabel(t: string): string }).typeLabel('character');
      expect(label).toBe('Characters');
    });

    // extractSummary must not throw on empty body
    it('generateIndex does not throw when a page has an empty body', async () => {
      const dir = join(tempDir, 'adab', 'wiki', 'characters');
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, 'empty.md'),
        '---\ntype: character\nname: Empty\nstatus: canon\n---\n',
        'utf-8',
      );
      await expect(engine.generateIndex()).resolves.not.toThrow();
    });

    it('extractSummary returns empty string for empty body', () => {
      const summary = (engine as unknown as { extractSummary(b: string): string }).extractSummary('');
      expect(summary).toBe('');
    });

    it('extractSummary returns empty string for whitespace-only body', () => {
      const summary = (engine as unknown as { extractSummary(b: string): string }).extractSummary('   \n\n  \n');
      expect(summary).toBe('');
    });
  });

  describe('generateOverview', () => {
    it('generates overview with setting, characters, conflict, current state', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara');
      await engine.writePage('locations/east-gate.md', { type: 'location', name: 'East Gate', location_type: 'gate', status: 'canon' }, '# East Gate');
      await engine.writePage('threads/betrayal.md', { type: 'thread', name: 'Betrayal', status: 'open' }, '# Betrayal');
      await engine.generateOverview();
      const overview = readFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), 'utf-8');
      expect(overview).toContain('# Story Overview');
      expect(overview).toContain('East Gate');
      expect(overview).toContain('Mara');
      expect(overview).toContain('Betrayal');
      expect(overview).toContain('1 active');
    });

    it('handles empty wiki gracefully', async () => {
      await engine.generateOverview();
      const overview = readFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), 'utf-8');
      expect(overview).toContain('No locations recorded');
      expect(overview).toContain('No characters recorded');
    });
  });

  describe('generateWikilinks', () => {
    it('builds link graph with forward links and backlinks', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nSee [[locations/east-gate]].');
      await engine.writePage('locations/east-gate.md', { type: 'location', name: 'East Gate', location_type: 'gate', status: 'canon' }, '# East Gate\nSee [[characters/mara]].');
      await engine.generateWikilinks();
      const raw = readFileSync(join(tempDir, 'adab', 'index', 'wikilinks.json'), 'utf-8');
      const graph: WikilinkGraph = JSON.parse(raw);
      expect(graph['characters/mara'].links).toContain('locations/east-gate');
      expect(graph['locations/east-gate'].backlinks).toContain('characters/mara');
    });

    it('flags broken links', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nSee [[locations/missing]].');
      await engine.generateWikilinks();
      const raw = readFileSync(join(tempDir, 'adab', 'index', 'wikilinks.json'), 'utf-8');
      const graph: WikilinkGraph = JSON.parse(raw);
      expect(graph['characters/mara'].broken).toBe(true);
    });

    // redundant replace removed; behavior is correct after refactor
    it('broken detection works for links with explicit .md extension', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nSee [[locations/missing.md]].');
      await engine.generateWikilinks();
      const raw = readFileSync(join(tempDir, 'adab', 'index', 'wikilinks.json'), 'utf-8');
      const graph: WikilinkGraph = JSON.parse(raw);
      expect(graph['characters/mara'].broken).toBe(true);
      expect(graph['characters/mara'].links).toContain('locations/missing');
    });
  });

  describe('updateContradictions', () => {
    it('appends contradiction entries', async () => {
      const diff = [
        {
          type: 'flag_contradiction' as const,
          target: 'characters/mara',
          source: 'continuity-report',
          description: 'Mara knows the secret',
          sources: [{ page: 'characters/mara', claim: 'does not know' }, { page: 'ch-003', claim: 'knows' }],
          status: 'unresolved' as const,
        },
      ];
      await engine.updateContradictions(diff);
      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), 'utf-8');
      expect(raw).toContain('Mara knows the secret');
      expect(raw).toContain('does not know');
      expect(raw).toContain('Status: unresolved');
    });

    it('does nothing when no flag_contradiction operations', async () => {
      await engine.updateContradictions([]);
      // File should not be created when there are no operations
      const path = join(tempDir, 'adab', 'wiki', 'contradictions.md');
      const { fileExists } = await import('../../utils/fs.js');
      const exists = await fileExists(path);
      expect(exists).toBe(false);
    });

    // sectionRegex with g flag must update all matching sections, not just the first
    it('updates all matching unresolved sections, not just the first', async () => {
      const sameDescription = 'Mara knows the secret';
      const firstDiff = [
        {
          type: 'flag_contradiction' as const,
          target: 'characters/mara',
          source: 'continuity-report',
          description: sameDescription,
          sources: [{ page: 'ch-001', claim: 'does not know' }],
          status: 'unresolved' as const,
        },
        {
          type: 'flag_contradiction' as const,
          target: 'characters/mara',
          source: 'continuity-report',
          description: sameDescription,
          sources: [{ page: 'ch-002', claim: 'does not know' }],
          status: 'unresolved' as const,
        },
      ];
      await engine.updateContradictions(firstDiff);

      const resolveDiff = [
        {
          type: 'flag_contradiction' as const,
          target: 'characters/mara',
          source: 'continuity-report',
          description: sameDescription,
          sources: [{ page: 'ch-002', claim: 'now knows' }],
          status: 'explained' as const,
        },
      ];
      await engine.updateContradictions(resolveDiff);

      const raw = readFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), 'utf-8');
      // No "Status: unresolved" lines should remain for that description
      const matches = raw.match(/Status: unresolved/g);
      expect(matches).toBeNull();
      // At least one explained status should be present
      expect(raw).toContain('Status: explained');
    });
  });

  describe('checkSystemPages', () => {
    it('reports a warning when index.md is missing', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '---\ntype: overview\n---\n# Overview', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '---\ntype: contradictions\n---\n# Contradictions', 'utf-8');
      const issues = await engine.checkSystemPages();
      const indexIssues = issues.filter((i) => i.file === 'index.md');
      expect(indexIssues.length).toBe(1);
      expect(indexIssues[0]?.severity).toBe('warning');
    });

    it('reports a warning when overview.md is missing', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '---\ntype: index\n---\n# Index', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '---\ntype: contradictions\n---\n# Contradictions', 'utf-8');
      const issues = await engine.checkSystemPages();
      const overviewIssues = issues.filter((i) => i.file === 'overview.md');
      expect(overviewIssues.length).toBe(1);
      expect(overviewIssues[0]?.severity).toBe('warning');
    });

    it('reports a warning when contradictions.md is missing', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '---\ntype: index\n---\n# Index', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '---\ntype: overview\n---\n# Overview', 'utf-8');
      const issues = await engine.checkSystemPages();
      const contradictionsIssues = issues.filter((i) => i.file === 'contradictions.md');
      expect(contradictionsIssues.length).toBe(1);
      expect(contradictionsIssues[0]?.severity).toBe('warning');
    });

    it('returns an empty array when all three system files exist as pure markdown (no frontmatter)', async () => {
      // system files written by generateIndex/generateOverview have
      // no frontmatter markers. The synthetic-frontmatter fallback must treat
      // them as valid, so checkSystemPages returns no issues.
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '# Wiki Index\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '# Story Overview\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '# Contradictions\n', 'utf-8');
      const issues = await engine.checkSystemPages();
      expect(issues).toEqual([]);
    });

    // system files written by the engine have no frontmatter;
    // checkSystemPages must treat them as valid via synthetic fallback.
    it('treats engine-generated index.md (no frontmatter) as valid', async () => {
      // Mimic what generateIndex writes: pure markdown with no frontmatter markers
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '# Wiki Index\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '---\ntype: overview\n---\n# Overview', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '---\ntype: contradictions\n---\n# Contradictions', 'utf-8');
      const issues = await engine.checkSystemPages();
      const indexIssues = issues.filter((i) => i.file === 'index.md');
      expect(indexIssues).toEqual([]);
    });

    it('treats engine-generated overview.md (no frontmatter) as valid', async () => {
      writeFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), '---\ntype: index\n---\n# Index', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), '# Story Overview\n', 'utf-8');
      writeFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), '---\ntype: contradictions\n---\n# Contradictions', 'utf-8');
      const issues = await engine.checkSystemPages();
      const overviewIssues = issues.filter((i) => i.file === 'overview.md');
      expect(overviewIssues).toEqual([]);
    });
  });

  describe('validateFrontmatter', () => {
    it('throws AdabError when writePage is called with unknown type', async () => {
      await expect(
        engine.writePage('misc/mystery.md', { type: 'mystery', name: 'Mystery' } as unknown as Record<string, unknown>, '# Mystery')
      ).rejects.toBeInstanceOf(AdabError);
    });

    it('accepts all currently allowed types (character, location, thread, faction, timeline, style, motif, other)', async () => {
      const allowed = ['character', 'location', 'thread', 'faction', 'timeline', 'style', 'motif', 'other'] as const;
      for (const t of allowed) {
        // Build a minimal valid frontmatter for the given type
        const fm: Record<string, unknown> = { type: t };
        if (t === 'character') {
          fm.name = 'X';
          fm.status = 'canon';
        } else if (t === 'location') {
          fm.name = 'X';
          fm.location_type = 'city';
        } else if (t === 'thread') {
          fm.name = 'X';
          fm.status = 'open';
        } else {
          fm.name = 'X';
        }
        await expect(
          engine.writePage(`misc/${String(t)}-page.md`, fm, `# ${String(t)}`),
        ).resolves.not.toThrow();
      }
    });

    it('rejects type "unknown" (not a valid wiki page type)', async () => {
      await expect(
        engine.writePage('misc/foo.md', { type: 'unknown', name: 'Foo' } as unknown as Record<string, unknown>, '# Foo')
      ).rejects.toBeInstanceOf(AdabError);
    });
  });

  // ===== WE-SYSPAGES: generateIndex / generateOverview skip system files =====
  // The pre-fix implementation trusted listPages() to filter out
  // index.md, overview.md, and contradictions.md.  If any of those files
  // sneaked in (hand-authored `index.md` with valid frontmatter, a stray
  // file, etc.) it would appear as a self-referential entry.  The fix
  // adds a defensive in-loop guard.
  describe('WE-SYSPAGES system-page filtering', () => {
    beforeEach(() => {
      mkdirSync(join(tempDir, 'adab', 'wiki', 'characters'), { recursive: true });
    });

    it('generateIndex skips index.md / overview.md / contradictions.md even when listPages returns them', async () => {
      // Inject a hand-authored index.md with valid character frontmatter
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'index.md'),
        '---\ntype: character\nname: Self\nstatus: canon\n---\n# Self',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'overview.md'),
        '---\ntype: character\nname: Overview\nstatus: canon\n---\n# Overview',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'contradictions.md'),
        '---\ntype: character\nname: Contradictions\nstatus: canon\n---\n# Contradictions',
        'utf-8',
      );
      // Real page
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'),
        '---\ntype: character\nname: Mara\nstatus: canon\n---\n# Mara',
        'utf-8',
      );

      // Stub listPages to bypass the engine's built-in filter so we
      // exercise the in-loop guard in generateIndex.
      (engine as unknown as { listPages: () => Promise<string[]> }).listPages = async () => [
        'index.md',
        'overview.md',
        'contradictions.md',
        'characters/mara.md',
      ];

      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('[[characters/mara]]');
      expect(index).not.toContain('[[index]]');
      expect(index).not.toContain('[[overview]]');
      expect(index).not.toContain('[[contradictions]]');
    });

    it('generateOverview skips index.md / overview.md / contradictions.md', async () => {
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'index.md'),
        '---\ntype: character\nname: Self\nstatus: canon\n---\n# Self',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'overview.md'),
        '---\ntype: character\nname: Overview\nstatus: canon\n---\n# Overview',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'contradictions.md'),
        '---\ntype: thread\nname: Contradiction\nstatus: open\n---\n# Contradictions',
        'utf-8',
      );
      writeFileSync(
        join(tempDir, 'adab', 'wiki', 'characters', 'mara.md'),
        '---\ntype: character\nname: Mara\nstatus: canon\n---\n# Mara',
        'utf-8',
      );

      (engine as unknown as { listPages: () => Promise<string[]> }).listPages = async () => [
        'index.md',
        'overview.md',
        'contradictions.md',
        'characters/mara.md',
      ];

      await engine.generateOverview();
      const overview = readFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), 'utf-8');
      // Mara should appear; system pages should not leak their names
      expect(overview).toContain('Mara');
      // The hand-authored system files have type character with a name
      // and type thread; if the guard is missing they would be classified
      // as such and appear in the output.
      expect(overview).not.toContain('— Self');
      expect(overview).not.toContain('— Overview');
      expect(overview).not.toContain('Contradiction (open)');
    });
  });
});
