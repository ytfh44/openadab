/**
 * Unit tests for the Project Init module.
 */
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import { AdabError } from '../../utils/errors.js';
import * as hostAdapters from '../host-adapters/index.js';

import { ProjectInitializer } from './index.js';

describe('ProjectInitializer — half-initialized recovery', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-half-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Simulates a half-initialized state: adab/ directory exists but config.yaml is missing.
   * This can happen if init was interrupted or manually created the directory.
   */
  function setupHalfInitializedState(projectRoot: string): void {
    mkdirSync(join(projectRoot, 'adab', 'manuscript'), { recursive: true });
    mkdirSync(join(projectRoot, 'adab', 'wiki'), { recursive: true });
    mkdirSync(join(projectRoot, 'adab', 'raw'), { recursive: true });
    // Intentionally do NOT create config.yaml
  }

  it('recovers when adab/ exists but config.yaml is missing', async () => {
    setupHalfInitializedState(tempDir);
    const initializer = new ProjectInitializer(tempDir);
    // Should NOT throw — should recover automatically
    await expect(initializer.init()).resolves.toBeUndefined();
    // Verify config.yaml was created
    expect(existsSync(join(tempDir, 'adab', 'config.yaml'))).toBe(true);
  });

  it('recovers when config.yaml exists but schemas are missing (crash between config write and schema copy)', async () => {
    // Simulates the pre-fix crash window: an init that wrote config.yaml
    // (then the marker of a full init) but died before copying built-in
    // schemas. The old isFullInit check treated this state as fully
    // initialized and permanently blocked recovery.
    const adabDir = join(tempDir, 'adab');
    mkdirSync(adabDir, { recursive: true });
    writeFileSync(join(adabDir, 'config.yaml'), 'schema: chapter-draft\n', 'utf-8');
    const initializer = new ProjectInitializer(tempDir);
    // Should NOT throw PROJECT_ALREADY_INITIALIZED - recovery proceeds.
    await expect(initializer.init()).resolves.toBeUndefined();
    // The pre-existing config.yaml is user content (PI-1): left untouched.
    expect(readFileSync(join(adabDir, 'config.yaml'), 'utf-8')).toBe('schema: chapter-draft\n');
    // Missing schemas are filled in by the recovery scaffold.
    const schemasDir = join(adabDir, 'schemas');
    expect(existsSync(schemasDir)).toBe(true);
    expect(readdirSync(schemasDir).some((e) => e !== '.gitkeep')).toBe(true);
  });

  it('still throws when adab/ exists AND config.yaml is present (fully initialized)', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const secondInitializer = new ProjectInitializer(tempDir);
    // Full init should still throw PROJECT_ALREADY_INITIALIZED
    await expect(secondInitializer.init()).rejects.toBeInstanceOf(AdabError);
    await expect(secondInitializer.init()).rejects.toThrow(/Project already initialized/);
  });

  it('creates all required subdirectories when recovering from half-initialized state', async () => {
    setupHalfInitializedState(tempDir);
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    // Verify key directories exist with .gitkeep files
    expect(existsSync(join(tempDir, 'adab', 'manuscript', 'chapters', '.gitkeep'))).toBe(true);
    expect(existsSync(join(tempDir, 'adab', 'wiki', 'characters', '.gitkeep'))).toBe(true);
    expect(existsSync(join(tempDir, 'adab', 'schemas', '.gitkeep'))).toBe(true);
  });

  it('creates config.yaml with default values when recovering', async () => {
    setupHalfInitializedState(tempDir);
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const configRaw = readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8');
    expect(configRaw).toContain('schema: chapter-draft');
    expect(configRaw).toContain('title: Untitled Novel');
    expect(configRaw).toContain('language: zh-CN');
  });

  it('does not create duplicate directories when recovering (no error)', async () => {
    setupHalfInitializedState(tempDir);
    const initializer = new ProjectInitializer(tempDir);
    // Should not throw even though some directories already exist
    await expect(initializer.init()).resolves.toBeUndefined();
    // Verify directories still exist
    expect(existsSync(join(tempDir, 'adab', 'manuscript'))).toBe(true);
    expect(existsSync(join(tempDir, 'adab', 'wiki'))).toBe(true);
  });
});

describe('ProjectInitializer', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-init-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('creates all required directories on fresh init', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const expectedDirs = [
      'adab/manuscript/chapters',
      'adab/manuscript/scenes',
      'adab/wiki/characters',
      'adab/wiki/locations',
      'adab/wiki/factions',
      'adab/wiki/objects',
      'adab/wiki/timeline',
      'adab/wiki/threads',
      'adab/wiki/motifs',
      'adab/wiki/style',
      'adab/raw/notes',
      'adab/raw/research',
      'adab/raw/imported-drafts',
      'adab/raw/references',
      'adab/changes/archive',
      'adab/schemas',
    ];
    // adab/index/ is NOT in gitkeepDirs (gitignored, .gitkeep would be noise)
    for (const rel of expectedDirs) {
      const stat = readFileSync(join(tempDir, rel, '.gitkeep'), 'utf-8');
      expect(stat).toBe('');
    }
    // Verify adab/index exists but has NO .gitkeep
    const indexPath = join(tempDir, 'adab', 'index');
    expect(existsSync(indexPath)).toBe(true);
    // index JSON files should still be created
    expect(readFileSync(join(indexPath, 'mentions.json'), 'utf-8').trim()).toBe('{}');
  });

  it('creates default wiki templates with frontmatter', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const indexMd = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
    expect(indexMd).toContain('type: index');
    expect(indexMd).toContain('# Wiki Index');
    const overviewMd = readFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), 'utf-8');
    expect(overviewMd).toContain('type: overview');
    expect(overviewMd).toContain('## Setting');
    const contradictionsMd = readFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), 'utf-8');
    expect(contradictionsMd).toContain('type: contradictions');
    expect(contradictionsMd).toContain('# Contradictions');
  });

  it('creates default config.yaml with sensible defaults', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const configRaw = readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8');
    expect(configRaw).toContain('schema: chapter-draft');
    expect(configRaw).toContain('title: Untitled Novel');
    expect(configRaw).toContain('language: zh-CN');
    expect(configRaw).toContain('maxTokens: 18000');
  });

  it('supports custom schema selection', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init({ schema: 'chapter-revision' });
    const configRaw = readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8');
    expect(configRaw).toContain('schema: chapter-revision');
  });

  it('copies built-in schemas when available', async () => {
    const builtInDir = join(tempDir, 'src', 'schemas', 'built-in');
    const schemas = ['chapter-draft', 'chapter-revision', 'wiki-ingest'];
    for (const s of schemas) {
      const d = join(builtInDir, s, 'templates');
      mkdirSync(d, { recursive: true });
      writeFileSync(join(d, 'brief.md'), `# ${s}\n`, 'utf-8');
    }
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    for (const s of schemas) {
      const destDir = join(tempDir, 'adab', 'schemas', s);
      expect(readdirSync(destDir)).toContain('templates');
      // Verify at least one expected template file was copied
      const templateFiles = readdirSync(join(destDir, 'templates'));
      expect(templateFiles.length).toBeGreaterThan(0);
    }
  });

  it('copyBuiltInSchemas finds and copies schemas even when process.cwd() differs from project root', async () => {
    const fakeCwd = mkdtempSync(join(tmpdir(), 'openadab-fake-cwd-'));
    const originalCwd = process.cwd();
    try {
      process.chdir(fakeCwd);
      const initializer = new ProjectInitializer(tempDir);
      await initializer.init();
      const schemasDir = join(tempDir, 'adab', 'schemas');
      const entries = readdirSync(schemasDir);
      expect(entries.length).toBeGreaterThan(0);
      // Verify at least chapter-draft was copied and has templates
      expect(entries).toContain('chapter-draft');
      const templateFiles = readdirSync(join(schemasDir, 'chapter-draft', 'templates'));
      expect(templateFiles.length).toBeGreaterThan(0);
    } finally {
      process.chdir(originalCwd);
      rmSync(fakeCwd, { recursive: true, force: true });
    }
  });

  it('creates or updates .gitignore with index exclusion', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('adab/index/*.json');
  });

  it('appends to existing .gitignore without duplicates', async () => {
    writeFileSync(join(tempDir, '.gitignore'), 'node_modules/\n', 'utf-8');
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    const lines = gitignore.split('\n').filter((l) => l.trim() === 'adab/index/*.json');
    expect(lines).toHaveLength(1);
  });

  it('creates log.md with initial init entry', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const log = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    expect(log).toContain('init');
    expect(log).toContain('success');
  });

  it('creates empty index JSON files', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    for (const f of ['mentions.json', 'wikilinks.json', 'progressions.json', 'context-map.json']) {
      const content = readFileSync(join(tempDir, 'adab', 'index', f), 'utf-8');
      expect(content.trim()).toBe('{}');
    }
  });

  it('throws AdabError on re-init', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    await expect(initializer.init()).rejects.toBeInstanceOf(AdabError);
  });

  it('error message suggests openadab update on re-init', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    await expect(initializer.init()).rejects.toThrow('openadab update');
  });

  it('generates host adapters when host is explicitly specified', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init({ host: 'generic' });
    const agentsMd = readFileSync(join(tempDir, 'AGENTS.md'), 'utf-8');
    expect(agentsMd).toContain('OpenAdab Workflow');
  });

  it('does not fail init when detectHost throws', async () => {
    vi.spyOn(hostAdapters, 'detectHost').mockRejectedValue(new Error('boom'));
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init()).resolves.toBeUndefined();
    expect(readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8')).toContain('schema:');
  });

  it('does not fail init when CommandDefLoader.loadAll throws', async () => {
    vi.spyOn(hostAdapters.CommandDefLoader.prototype, 'loadAll').mockRejectedValue(new Error('boom'));
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init({ host: 'generic' })).resolves.toBeUndefined();
    expect(readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8')).toContain('schema:');
  });

  it('does not fail init when adapter.generate throws', async () => {
    vi.spyOn(hostAdapters.GenericAdapter.prototype, 'generate').mockImplementation(() => {
      throw new Error('boom');
    });
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init({ host: 'generic' })).resolves.toBeUndefined();
    expect(readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8')).toContain('schema:');
  });

  it('does not fail init when writeGeneratedFiles throws', async () => {
    vi.spyOn(hostAdapters, 'writeGeneratedFiles').mockRejectedValue(new Error('boom'));
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init({ host: 'generic' })).resolves.toBeUndefined();
    expect(readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8')).toContain('schema:');
  });

  it('creates .gitignore when it does not exist', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    expect(gitignore).toContain('adab/index/*.json');
  });

  it('overwrites existing index JSON files on re-init after cleanup', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    // Simulate stale content
    writeFileSync(join(tempDir, 'adab', 'index', 'mentions.json'), '{"old":true}', 'utf-8');
    // Re-create empty index files directly
    await (initializer as any).createEmptyIndexFiles(join(tempDir, 'adab'));
    for (const f of ['mentions.json', 'wikilinks.json', 'progressions.json', 'context-map.json']) {
      const content = readFileSync(join(tempDir, 'adab', 'index', f), 'utf-8');
      expect(content.trim()).toBe('{}');
    }
  });

  it('throws PROJECT_ALREADY_INITIALIZED when second instance targets same directory', async () => {
    const initializer1 = new ProjectInitializer(tempDir);
    await initializer1.init();
    const initializer2 = new ProjectInitializer(tempDir);
    await expect(initializer2.init()).rejects.toBeInstanceOf(AdabError);
    await expect(initializer2.init()).rejects.toThrow(/Project already initialized/);
    await expect(initializer2.init()).rejects.toSatisfy((err: unknown) => err instanceof AdabError && err.code === 'PROJECT_ALREADY_INITIALIZED');
  });

  it('creates config.yaml with complete structure', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const configRaw = readFileSync(join(tempDir, 'adab', 'config.yaml'), 'utf-8');
    expect(configRaw).toContain('version:');
    expect(configRaw).toContain('project:');
    expect(configRaw).toContain('title:');
    expect(configRaw).toContain('genre:');
    expect(configRaw).toContain('pov:');
    expect(configRaw).toContain('language:');
    expect(configRaw).toContain('context:');
    expect(configRaw).toContain('maxTokens:');
    expect(configRaw).toContain('tokenHeuristic:');
    expect(configRaw).toContain('alwaysInclude:');
    expect(configRaw).toContain('rules:');
  });

  it('creates log.md with HTML comment JSON payload containing type init and timestamp', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const log = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    expect(log).toMatch(/<!-- log-entry \{[^}]*"op":"init"[^}]*\} -->/);
    expect(log).toMatch(/<!-- log-entry \{[^}]*"ts":"[^"]+"[^}]*\} -->/);
    expect(log).toContain('`init`');
    expect(log).toContain('success');
  });

  it('half-init recovery does not overwrite pre-existing user content (PI-1)', async () => {
    // User already has wiki/index.md (e.g. a real index they curated), log.md,
    // and an index JSON. Recovery must NOT clobber them.
    const adabDir = join(tempDir, 'adab');
    mkdirSync(adabDir, { recursive: true });
    mkdirSync(join(adabDir, 'manuscript'), { recursive: true });
    mkdirSync(join(adabDir, 'wiki'), { recursive: true });
    mkdirSync(join(adabDir, 'index'), { recursive: true });
    const userIndex = '---\ntype: index\ncreated: 2020-01-01\n---\n# My Custom Wiki Index\n';
    writeFileSync(join(adabDir, 'wiki', 'index.md'), userIndex, 'utf-8');
    const userLog = '<!-- log-entry {"ts":"2020-01-01","op":"init"} -->\n- **2020-01-01** `init` — legacy\n';
    writeFileSync(join(adabDir, 'log.md'), userLog, 'utf-8');
    const userMentions = '{"legacy":true}';
    writeFileSync(join(adabDir, 'index', 'mentions.json'), userMentions, 'utf-8');
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    // User content must survive.
    expect(readFileSync(join(adabDir, 'wiki', 'index.md'), 'utf-8')).toBe(userIndex);
    expect(readFileSync(join(adabDir, 'log.md'), 'utf-8')).toBe(userLog);
    expect(readFileSync(join(adabDir, 'index', 'mentions.json'), 'utf-8')).toBe(userMentions);
  });

  it('half-init recovery does not overwrite a user-forked schema (PI-1)', async () => {
    // A schema dir with `forked_from` in schema.yaml is user-owned — the
    // recovery must NOT copy the built-in version over it.
    const adabDir = join(tempDir, 'adab');
    mkdirSync(adabDir, { recursive: true });
    const schemasDir = join(adabDir, 'schemas');
    const chapterDir = join(schemasDir, 'chapter-draft');
    mkdirSync(chapterDir, { recursive: true });
    mkdirSync(join(chapterDir, 'templates'), { recursive: true });
    const forkedYaml = 'name: chapter-draft\nforked_from: chapter-draft\nforked_version: 1\nartifacts: []\n';
    writeFileSync(join(chapterDir, 'schema.yaml'), forkedYaml, 'utf-8');
    const userTemplate = '# User-edited template\n';
    writeFileSync(join(chapterDir, 'templates', 'draft.md'), userTemplate, 'utf-8');
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    expect(readFileSync(join(chapterDir, 'schema.yaml'), 'utf-8')).toBe(forkedYaml);
    expect(readFileSync(join(chapterDir, 'templates', 'draft.md'), 'utf-8')).toBe(userTemplate);
  });

  it('refuses concurrent init attempts with INIT_LOCKED error (PI-2)', async () => {
    // Hold the lock manually to simulate a concurrent init running.
    // The lock is the very first thing init() checks, so no other state
    // needs to be set up for this test.
    const lockPath = join(tempDir, '.openadab-init.lock');
    writeFileSync(lockPath, 'someone-else', 'utf-8');
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init()).rejects.toBeInstanceOf(AdabError);
    await expect(initializer.init()).rejects.toThrow(/in progress/i);
  });

  it('all three wiki templates share the same timestamp (PI-3)', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const indexMd = readFileSync(join(tempDir, 'adab', 'wiki', 'index.md'), 'utf-8');
    const overviewMd = readFileSync(join(tempDir, 'adab', 'wiki', 'overview.md'), 'utf-8');
    const contradictionsMd = readFileSync(join(tempDir, 'adab', 'wiki', 'contradictions.md'), 'utf-8');
    const tsRe = /^created:\s*(.+)$/m;
    const a = (tsRe.exec(indexMd))?.[1];
    const b = (tsRe.exec(overviewMd))?.[1];
    const c = (tsRe.exec(contradictionsMd))?.[1];
    expect(a).toBeDefined();
    expect(b).toBe(a);
    expect(c).toBe(a);
  });

  it('gitignore ignores the real index marker filenames (PI-4)', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    // The marker files actually written by the indexers are
    // .last-mention-indexed (mention-indexer) and
    // .last-progression-indexed (progression-tracker); the legacy spec
    // name `.last-indexed` is written by no module and must not be the
    // only ignored entry.
    expect(gitignore).toContain('adab/index/.last-mention-indexed');
    expect(gitignore).toContain('adab/index/.last-progression-indexed');
    expect(gitignore).not.toContain('adab/index/.last-indexed');
  });

  it('rejects unknown --schema values with SCHEMA_NOT_FOUND (PI-6)', async () => {
    const initializer = new ProjectInitializer(tempDir);
    await expect(initializer.init({ schema: 'no-such-schema-xyz' })).rejects.toThrow(/no-such-schema-xyz/);
  });

  it('logs a warning to adab/log.md when host adapter generation fails (PI-8)', async () => {
    // Force adapter.generate to throw — init should still succeed and record
    // the failure into adab/log.md rather than just console.warn it.
    // Clear any prior spy stubs that earlier tests left on CommandDefLoader
    // so the failure originates from the adapter, not from the loader.
    vi.restoreAllMocks();
    vi.spyOn(hostAdapters.GenericAdapter.prototype, 'generate').mockImplementation(() => {
      throw new Error('adapter boom');
    });
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init({ host: 'generic' });
    const log = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    expect(log).toContain('adapter');
    expect(log.toLowerCase()).toContain('warning');
  });

  it('reports duplicate gitignore lines instead of silently skipping (PI-7)', async () => {
    // Pre-seed a .gitignore that already contains one of the canonical lines.
    writeFileSync(join(tempDir, '.gitignore'), 'adab/log.md\n', 'utf-8');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const initializer = new ProjectInitializer(tempDir);
    await initializer.init();
    const gitignore = readFileSync(join(tempDir, '.gitignore'), 'utf-8');
    const occurrences = gitignore.split('\n').filter((l) => l.trim() === 'adab/log.md');
    expect(occurrences).toHaveLength(1);
    // Duplicate detection also surfaces a warning so the user can audit.
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
