/**
 * Integration test fixture helpers.
 *
 * Provides {@link createMinimalProject} to scaffold a temporary OpenAdab
 * project with config, wiki pages, manuscript chapter, and built-in schemas.
 */
import { join } from 'node:path';
import { ProjectInitializer } from '../../src/modules/project-init/index.js';
import { atomicWriteFile, ensureDir } from '../../src/utils/fs.js';
/**
 * Create a minimal OpenAdab project suitable for integration tests.
 *
 * Scaffolds the `adab/` directory with a test config, built-in schemas,
 * sample wiki pages (character, location, thread), a sample manuscript
 * chapter, and empty index files.
 *
 * @param root Absolute path to the temporary project root.
 * @returns The project root path (same as input).
 */
export async function createMinimalProject(root) {
    const initializer = new ProjectInitializer(root);
    await initializer.init({ schema: 'chapter-draft' });
    const adabDir = join(root, 'adab');
    await writeTestConfig(adabDir);
    await writeTestWikiPages(adabDir);
    await writeTestManuscript(adabDir);
    await writeTestIndexFiles(adabDir);
    return root;
}
/**
 * Overwrite the default config with test-specific values.
 *
 * @param adabDir Absolute path to `adab/`.
 */
async function writeTestConfig(adabDir) {
    const configPath = join(adabDir, 'config.yaml');
    const config = {
        schema: 'chapter-draft',
        version: 1,
        project: {
            title: 'Test Novel',
            language: 'zh-CN',
            genre: 'fantasy',
            tense: 'past',
            pov: 'limited-third',
        },
        context: {
            maxTokens: 8000,
            alwaysInclude: [],
            tokenHeuristic: 'chars-per-token',
            excludePatterns: [],
        },
        rules: {
            draft: ['Show, do not tell.'],
        },
        archive: {
            backupOnOverwrite: true,
        },
    };
    const YAML = await import('yaml');
    await atomicWriteFile(configPath, YAML.stringify(config, { indent: 2, lineWidth: 0 }));
}
/**
 * Write sample wiki pages for integration tests.
 *
 * @param adabDir Absolute path to `adab/`.
 */
async function writeTestWikiPages(adabDir) {
    const charPage = `---
type: character
name: Mara
status: alive
aliases: ["Mara the Swift"]
---

# Mara

A skilled thief with a hidden past.

## Current State

- Hiding in the docks.

## Knowledge Timeline

| Chapter | Knowledge |
|---------|-----------|
`;
    const locPage = `---
type: location
name: Docks
status: active
location_type: district
---

# Docks

The harbor district, full of smugglers and secrets.
`;
    const threadPage = `---
type: thread
name: The Heist
status: open
---

# The Heist

Mara plans to steal the Crown Jewel.

## Evidence

- Overheard guards discussing the vault layout.
`;
    await atomicWriteFile(join(adabDir, 'wiki', 'characters', 'mara.md'), charPage);
    await atomicWriteFile(join(adabDir, 'wiki', 'locations', 'docks.md'), locPage);
    await atomicWriteFile(join(adabDir, 'wiki', 'threads', 'the-heist.md'), threadPage);
}
/**
 * Write a sample manuscript chapter for integration tests.
 *
 * @param adabDir Absolute path to `adab/`.
 */
async function writeTestManuscript(adabDir) {
    const chapterDir = join(adabDir, 'manuscript', 'chapters');
    await ensureDir(chapterDir);
    const chapter = `---
chapter: "001"
title: "The Beginning"
---

# Chapter 1

Mara stood at the edge of the Docks, watching the fog roll in.
`;
    await atomicWriteFile(join(chapterDir, 'ch-001.md'), chapter);
}
/**
 * Overwrite index files with empty but valid JSON objects.
 *
 * @param adabDir Absolute path to `adab/`.
 */
async function writeTestIndexFiles(adabDir) {
    const indexDir = join(adabDir, 'index');
    await ensureDir(indexDir);
    for (const f of ['mentions.json', 'wikilinks.json', 'progressions.json', 'context-map.json']) {
        await atomicWriteFile(join(indexDir, f), '{}');
    }
}
//# sourceMappingURL=fixture.js.map