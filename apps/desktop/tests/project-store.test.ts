/**
 * Unit tests for project-store.ts pure functions.
 *
 * Covers project detection, config reading, and recent-projects
 * list management. Electron-specific UI functions
 * (`showOpenProjectDialog`, `recentProjectsPath`) are not tested
 * here because they require a running Electron instance.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import {
  detectProject,
  isOpenAdabProject,
  readProjectConfig,
  validateProjectRoot,
  loadRecentProjects,
  saveRecentProjects,
  addRecentProject,
} from '../electron/project-store.js';
import type { RecentProject } from '../shared/ipc-types.js';

/** Base temp directory for all test fixtures. */
let tmpRoot: string;

beforeEach(() => {
  tmpRoot = resolve(
    tmpdir(),
    `openadab-project-store-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpRoot, { recursive: true });
});

afterEach(() => {
  try {
    rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

// ─── Helpers ────────────────────────────────────────────────

function createProject(
  dir: string,
  config: Record<string, unknown> = {},
): string {
  const adabDir = join(dir, 'adab');
  mkdirSync(adabDir, { recursive: true });
  writeFileSync(join(adabDir, 'config.yaml'), stringifyYaml(config), 'utf-8');
  return dir;
}

describe('isOpenAdabProject', () => {
  it('returns true when adab/config.yaml exists', () => {
    createProject(tmpRoot);
    expect(isOpenAdabProject(tmpRoot)).toBe(true);
  });

  it('returns false when adab/config.yaml is missing', () => {
    mkdirSync(join(tmpRoot, 'adab'), { recursive: true });
    expect(isOpenAdabProject(tmpRoot)).toBe(false);
  });

  it('returns false when adab/ directory is missing', () => {
    expect(isOpenAdabProject(tmpRoot)).toBe(false);
  });

  it('returns false for a file that is not a directory', () => {
    writeFileSync(join(tmpRoot, 'adab'), 'not-a-dir');
    // `join(tmpRoot, 'adab/config.yaml')` will fail existence check
    expect(isOpenAdabProject(tmpRoot)).toBe(false);
  });
});

describe('readProjectConfig', () => {
  it('reads title from config.yaml', () => {
    createProject(tmpRoot, { title: 'My Novel' });
    const config = readProjectConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.title).toBe('My Novel');
  });

  it('reads language and schema from config.yaml', () => {
    createProject(tmpRoot, { language: 'zh', schema: 'chapter-draft' });
    const config = readProjectConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.language).toBe('zh');
    expect(config!.schema).toBe('chapter-draft');
  });

  it('reads host from config.yaml', () => {
    createProject(tmpRoot, { host: 'opencode' });
    const config = readProjectConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.host).toBe('opencode');
  });

  it('passes through unknown keys', () => {
    createProject(tmpRoot, { title: 'Test', custom_field: 42, nested: { a: 1 } });
    const config = readProjectConfig(tmpRoot);
    expect(config).not.toBeNull();
    expect(config!.custom_field).toBe(42);
    expect(config!.nested).toEqual({ a: 1 });
  });

  it('returns null when config.yaml is missing', () => {
    const config = readProjectConfig(tmpRoot);
    expect(config).toBeNull();
  });

  it('returns null when config.yaml contains invalid YAML', () => {
    const adabDir = join(tmpRoot, 'adab');
    mkdirSync(adabDir, { recursive: true });
    writeFileSync(join(adabDir, 'config.yaml'), 'invalid: [unclosed', 'utf-8');
    const config = readProjectConfig(tmpRoot);
    expect(config).toBeNull();
  });
});

describe('detectProject', () => {
  it('returns ProjectInfo for a valid project', () => {
    createProject(tmpRoot, {
      title: 'Epic Saga',
      language: 'en',
      schema: 'chapter-draft',
      host: 'opencode',
    });
    const info = detectProject(tmpRoot);
    expect(info).not.toBeNull();
    expect(info!.projectRoot).toBe(resolve(tmpRoot));
    expect(info!.title).toBe('Epic Saga');
    expect(info!.language).toBe('en');
    expect(info!.activeSchema).toBe('chapter-draft');
    expect(info!.host).toBe('opencode');
  });

  it('returns null for a non-project directory', () => {
    const info = detectProject(tmpRoot);
    expect(info).toBeNull();
  });

  it('handles missing optional fields', () => {
    createProject(tmpRoot, {});
    const info = detectProject(tmpRoot);
    expect(info).not.toBeNull();
    expect(info!.title).toBeUndefined();
    expect(info!.language).toBeUndefined();
    expect(info!.activeSchema).toBeUndefined();
  });

  it('resolves the project root to an absolute path', () => {
    createProject(join(tmpRoot, 'nested'));
    const info = detectProject(join(tmpRoot, 'nested'));
    expect(info).not.toBeNull();
    expect(info!.projectRoot).toBe(resolve(tmpRoot, 'nested'));
  });
});

describe('validateProjectRoot', () => {
  it('returns valid for a directory containing adab/config.yaml', () => {
    createProject(tmpRoot);
    const result = validateProjectRoot(tmpRoot);
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.projectRoot).toBe(resolve(tmpRoot));
    }
  });

  it('returns valid and resolves relative paths', () => {
    createProject(join(tmpRoot, 'nested'));
    const result = validateProjectRoot(join(tmpRoot, 'nested', '.'));
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.projectRoot).toBe(resolve(tmpRoot, 'nested'));
    }
  });

  it('returns not_a_project when adab/config.yaml is missing', () => {
    mkdirSync(join(tmpRoot, 'adab'), { recursive: true });
    const result = validateProjectRoot(tmpRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('not_a_project');
    }
  });

  it('returns not_a_project when adab/ directory is missing entirely', () => {
    const result = validateProjectRoot(tmpRoot);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('not_a_project');
    }
  });

  it('returns not_found for a non-existent directory', () => {
    const result = validateProjectRoot(join(tmpRoot, 'does-not-exist'));
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('not_found');
    }
  });

  it('returns not_a_directory for a file path', () => {
    const filePath = join(tmpRoot, 'plain-file.txt');
    writeFileSync(filePath, 'hello', 'utf-8');
    const result = validateProjectRoot(filePath);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.reason).toBe('not_a_directory');
    }
  });
});
describe('recent-projects persistence', () => {
  let recentFile: string;

  beforeEach(() => {
    recentFile = join(tmpRoot, 'recent-projects.json');
  });

  describe('loadRecentProjects', () => {
    it('returns empty array when file does not exist', () => {
      expect(loadRecentProjects(recentFile)).toEqual([]);
    });

    it('loads a valid recent-projects file', () => {
      const projects: RecentProject[] = [
        { projectRoot: '/a/b', title: 'Project A', lastOpenedAt: '2025-01-01T00:00:00.000Z' },
        { projectRoot: '/c/d', lastOpenedAt: '2025-06-01T00:00:00.000Z' },
      ];
      writeFileSync(recentFile, JSON.stringify(projects), 'utf-8');
      const loaded = loadRecentProjects(recentFile);
      expect(loaded).toHaveLength(2);
      expect(loaded[0]!.projectRoot).toBe('/a/b');
      expect(loaded[0]!.title).toBe('Project A');
      expect(loaded[1]!.lastOpenedAt).toBe('2025-06-01T00:00:00.000Z');
    });

    it('returns empty array for malformed JSON', () => {
      writeFileSync(recentFile, 'not-json', 'utf-8');
      expect(loadRecentProjects(recentFile)).toEqual([]);
    });

    it('filters out entries missing required fields', () => {
      writeFileSync(
        recentFile,
        JSON.stringify([
          { projectRoot: '/valid', lastOpenedAt: '2025-01-01T00:00:00.000Z' },
          { title: 'Missing root' },
          { projectRoot: '/valid2' },
          'not-an-object',
          42,
        ]),
        'utf-8',
      );
      const loaded = loadRecentProjects(recentFile);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.projectRoot).toBe('/valid');
    });
  });

  describe('saveRecentProjects', () => {
    it('persists the list to disk', () => {
      const projects: RecentProject[] = [
        { projectRoot: '/x', lastOpenedAt: '2025-01-01T00:00:00.000Z' },
      ];
      saveRecentProjects(recentFile, projects);
      const raw = readFileSync(recentFile, 'utf-8');
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(projects);
    });

    it('creates parent directories when needed', () => {
      const deepFile = join(tmpRoot, 'deep', 'nested', 'recent.json');
      saveRecentProjects(deepFile, []);
      expect(existsSync(deepFile)).toBe(true);
    });

    it('overwrites existing file', () => {
      writeFileSync(recentFile, 'old content', 'utf-8');
      saveRecentProjects(recentFile, []);
      expect(readFileSync(recentFile, 'utf-8')).toBe('[]');
    });
  });

  describe('addRecentProject', () => {
    it('adds a new project to an empty list', () => {
      const result = addRecentProject(
        recentFile,
        '/projects/novel',
        'My Novel',
      );
      expect(result).toHaveLength(1);
      expect(result[0]!.projectRoot).toBe('/projects/novel');
      expect(result[0]!.title).toBe('My Novel');
      expect(result[0]!.lastOpenedAt).toBeTruthy();
    });

    it('moves an existing project to the front', () => {
      addRecentProject(recentFile, '/a', 'A');
      addRecentProject(recentFile, '/b', 'B');
      const result = addRecentProject(recentFile, '/a', 'A');
      expect(result).toHaveLength(2);
      expect(result[0]!.projectRoot).toBe('/a');
      expect(result[1]!.projectRoot).toBe('/b');
    });

    it('bumps the timestamp on re-open', () => {
      const first = addRecentProject(recentFile, '/a', 'A');
      const firstTime = first[0]!.lastOpenedAt;
      // Tiny delay to ensure different timestamp
      const second = addRecentProject(recentFile, '/a', 'A');
      expect(second[0]!.lastOpenedAt).not.toBe(firstTime);
    });

    it('adds a project without a title', () => {
      const result = addRecentProject(recentFile, '/bare');
      expect(result[0]!.title).toBeUndefined();
    });

    it('persists to disk so subsequent loads see the update', () => {
      addRecentProject(recentFile, '/p', 'P');
      const loaded = loadRecentProjects(recentFile);
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.projectRoot).toBe('/p');
    });
  });
});

// ─── project:open result shape (using pure functions) ─────

describe('project:open IPC result shape', () => {
  it('returns success project for a valid project directory', () => {
    createProject(tmpRoot, { title: 'Valid Project', language: 'en' });
    const validated = validateProjectRoot(tmpRoot);
    expect(validated.valid).toBe(true);
    if (validated.valid) {
      const info = detectProject(validated.projectRoot);
      expect(info).not.toBeNull();
      const result = { success: true as const, project: info! };
      expect(result.success).toBe(true);
      expect(result.project.title).toBe('Valid Project');
      expect(result.project.projectRoot).toBe(resolve(tmpRoot));
    }
  });

  it('returns not_a_project for a directory without adab/config.yaml', () => {
    mkdirSync(join(tmpRoot, 'some-dir'), { recursive: true });
    const validated = validateProjectRoot(tmpRoot);
    expect(validated.valid).toBe(false);
    if (!validated.valid) {
      const result = { success: false as const, reason: validated.reason };
      expect(result.success).toBe(false);
      expect(result.reason).toBe('not_a_project');
    }
  });

  it('returns not_found for a non-existent path', () => {
    const validated = validateProjectRoot(join(tmpRoot, 'does-not-exist'));
    expect(validated.valid).toBe(false);
    if (!validated.valid) {
      const result = { success: false as const, reason: validated.reason };
      expect(result.success).toBe(false);
      expect(result.reason).toBe('not_found');
    }
  });

  it('returns not_a_directory for a file path', () => {
    const filePath = join(tmpRoot, 'just-a-file.txt');
    writeFileSync(filePath, 'contents', 'utf-8');
    const validated = validateProjectRoot(filePath);
    expect(validated.valid).toBe(false);
    if (!validated.valid) {
      const result = { success: false as const, reason: validated.reason };
      expect(result.success).toBe(false);
      expect(result.reason).toBe('not_a_directory');
    }
  });

  it('detectProject returns null for a non-project, keeping reason from validation', () => {
    mkdirSync(tmpRoot, { recursive: true });
    const validated = validateProjectRoot(tmpRoot);
    // validateProjectRoot should already reject it, but defensively:
    if (validated.valid) {
      const info = detectProject(validated.projectRoot);
      expect(info).toBeNull();
    } else {
      expect(validated.reason).toBe('not_a_project');
    }
  });
});