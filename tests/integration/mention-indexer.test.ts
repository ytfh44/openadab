/**
 * Integration test: mention indexer with real manuscript.
 *
 * Writes a chapter with entity mentions, runs the indexer, and verifies
 * the generated mentions.json and context-map.json.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { MentionIndexer } from '../../src/modules/mention-indexer/index.js';
import { WikiEngine } from '../../src/modules/wiki-engine/index.js';
import { safeReadFile } from '../../src/utils/fs.js';

import { createMinimalProject } from './fixture.js';

describe('mention indexer integration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
    await createMinimalProject(projectRoot);
  });

  it('24.5 indexes entity mentions from manuscript chapter', async () => {
    const chapterDir = join(projectRoot, 'adab', 'manuscript', 'chapters');
    await mkdir(chapterDir, { recursive: true });
    const chapter = `---
chapter: "002"
title: "The Heist Begins"
---

# Chapter 2

Mara the Swift moved through the Docks like a shadow.
She had planned The Heist for months.
`;
    await writeFile(join(chapterDir, 'ch-002.md'), chapter, 'utf-8');

    const wikiEngine = new WikiEngine(projectRoot);
    const indexer = new MentionIndexer(projectRoot, wikiEngine);
    await indexer.indexAll();

    const mentionsRaw = await safeReadFile(join(projectRoot, 'adab', 'index', 'mentions.json'));
    expect(mentionsRaw).not.toBeNull();
    const mentions = JSON.parse(mentionsRaw ?? '{}');

    expect(mentions.Mara).toBeDefined();
    const maraAppearances = mentions.Mara.appearances as { file: string }[];
    expect(maraAppearances.length).toBeGreaterThan(0);
    const inCh002 = maraAppearances.some((a) => a.file.includes('ch-002.md'));
    expect(inCh002).toBe(true);

    const contextMapRaw = await safeReadFile(join(projectRoot, 'adab', 'index', 'context-map.json'));
    expect(contextMapRaw).not.toBeNull();
    const contextMap = JSON.parse(contextMapRaw ?? '{}');
    const ch002Key = Object.keys(contextMap).find((k) => k.includes('ch-002.md'));
    expect(ch002Key).toBeDefined();
    expect(contextMap[ch002Key ?? '']).toContain('Mara');
  });

  it('24.5 edge: chapter with no mentions produces empty entries', async () => {
    const chapterDir = join(projectRoot, 'adab', 'manuscript', 'chapters');
    await mkdir(chapterDir, { recursive: true });
    const chapter = `---
chapter: "003"
---

# Chapter 3

The weather was calm and uneventful.
`;
    await writeFile(join(chapterDir, 'ch-003.md'), chapter, 'utf-8');

    const wikiEngine = new WikiEngine(projectRoot);
    const indexer = new MentionIndexer(projectRoot, wikiEngine);
    await indexer.indexAll();

    const mentionsRaw = await safeReadFile(join(projectRoot, 'adab', 'index', 'mentions.json'));
    expect(mentionsRaw).not.toBeNull();
    const contextMapRaw = await safeReadFile(join(projectRoot, 'adab', 'index', 'context-map.json'));
    const contextMap = JSON.parse(contextMapRaw ?? '{}') as Record<string, unknown[]>;

    const ch003Key = Object.keys(contextMap).find((k) => k.includes('ch-003.md'));
    if (ch003Key !== undefined) {
      expect(contextMap[ch003Key].length).toBe(0);
    }
  });
});
