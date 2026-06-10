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
});
