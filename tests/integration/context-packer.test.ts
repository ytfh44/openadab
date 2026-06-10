/**
 * Integration test: context packer with real wiki pages.
 *
 * Creates wiki entities, writes a scene-plan with mentions, and verifies
 * the context pack includes the correct wiki pages.
 */
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach } from 'vitest';

import { ContextPacker } from '../../src/modules/context-packer/index.js';
import { MentionIndexer } from '../../src/modules/mention-indexer/index.js';
import { ProgressionTracker } from '../../src/modules/progression-tracker/index.js';
import { ConfigLoader } from '../../src/modules/project-config/index.js';
import { WikiEngine } from '../../src/modules/wiki-engine/index.js';

import { createMinimalProject } from './fixture.js';

describe('context packer integration', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
    await createMinimalProject(projectRoot);
  });

  it('24.3 includes entity-linked wiki pages when scene-plan mentions them', async () => {
    const changeId = 'ch-002';
    const changeDir = join(projectRoot, 'adab', 'changes', changeId);
    await mkdir(changeDir, { recursive: true });

    const wikiEngine = new WikiEngine(projectRoot);
    const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);

    // Write scene-plan that mentions Mara and Docks
    const scenePlan = `---
chapter: "002"
scene_count: 1
pov: Mara
---

# Scene Plan

## Scene 1

- **Location:** Docks
- **Characters:** Mara
- **Purpose:** Stealth
- **Estimated Words:** 500
`;
    await writeFile(join(changeDir, 'scene-plan.md'), scenePlan, 'utf-8');

    // Index after scene-plan is written so context-map includes it
    await mentionIndexer.indexAll();

    const configLoader = new ConfigLoader(projectRoot);
    await configLoader.load();
    const progressionTracker = new ProgressionTracker(projectRoot);
    const packer = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);

    const pack = await packer.packContext(changeId, 'draft');

    const wikiPaths = [...pack.mustRead, ...pack.optionalRead];
    const hasMara = wikiPaths.some((p) => p.includes('characters') && p.includes('mara.md'));
    const hasDocks = wikiPaths.some((p) => p.includes('locations') && p.includes('docks.md'));

    expect(hasMara).toBe(true);
    expect(hasDocks).toBe(true);
  });

  it('24.3 edge: empty scene-plan returns pack with no entity-linked pages', async () => {
    const changeId = 'ch-003';
    const changeDir = join(projectRoot, 'adab', 'changes', changeId);
    await mkdir(changeDir, { recursive: true });

    const wikiEngine = new WikiEngine(projectRoot);
    const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
    await mentionIndexer.indexAll();

    await writeFile(join(changeDir, 'scene-plan.md'), '---\nchapter: "003"\n---\n\n# Scene Plan\n\n', 'utf-8');

    const configLoader = new ConfigLoader(projectRoot);
    await configLoader.load();
    const progressionTracker = new ProgressionTracker(projectRoot);
    const packer = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);

    const pack = await packer.packContext(changeId, 'draft');
    const wikiPaths = [...pack.mustRead, ...pack.optionalRead];
    const hasMara = wikiPaths.some((p) => p.includes('characters') && p.includes('mara.md'));
    expect(hasMara).toBe(false);
  });
});
