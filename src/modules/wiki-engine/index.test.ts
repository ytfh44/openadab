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
    it('generates index.md grouped by type', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara\nA courtier.');
      await engine.writePage('locations/east-gate.md', { type: 'location', name: 'East Gate', location_type: 'gate', status: 'canon' }, '# East Gate\nA gate.');
      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('# Wiki Index');
      expect(index).toContain('## Character');
      expect(index).toContain('## Location');
      expect(index).toContain('[[character/Mara]]');
      expect(index).toContain('[[location/East Gate]]');
    });

    it('includes summary from first heading', async () => {
      await engine.writePage('characters/mara.md', { type: 'character', name: 'Mara', status: 'canon' }, '# Mara the Courtier\nText.');
      await engine.generateIndex();
      const index = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
      expect(index).toContain('Mara the Courtier');
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
      expect(() => readFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'))).toThrow();
    });
  });
});
