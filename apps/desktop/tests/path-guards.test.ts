/**
 * Unit tests for {@link guardFilePath} in path-guards.ts.
 *
 * Covers normal paths, parent-traversal attempts, symlink escapes,
 * absolute outside paths, relative segments, spaces, and non-existent
 * write targets.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import {
  guardFilePath,
  guardProjectFilePath,
  PathEscapeError,
  PathScopeError,
} from '../electron/path-guards.js';

/** Base temp directory for all test fixtures. */
let root: string;

beforeEach(() => {
  root = resolve(tmpdir(), `openadab-path-guard-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(root, { recursive: true });
  mkdirSync(join(root, 'subdir'), { recursive: true });
  mkdirSync(join(root, 'spaces in path'), { recursive: true });
  writeFileSync(join(root, 'file.txt'), 'hello');
  writeFileSync(join(root, 'subdir', 'nested.txt'), 'nested');
  writeFileSync(join(root, 'spaces in path', 'spaced.txt'), 'spaced');
  mkdirSync(join(root, 'adab', 'changes', 'ch-001'), { recursive: true });
  mkdirSync(join(root, 'adab', 'schemas', 'chapter-draft'), { recursive: true });
  mkdirSync(join(root, 'adab', 'wiki', 'characters'), { recursive: true });
  mkdirSync(join(root, 'adab', 'manuscript', 'chapters'), { recursive: true });
  mkdirSync(join(root, 'adab', 'index'), { recursive: true });
  mkdirSync(join(root, 'adab', '.temp'), { recursive: true });
  writeFileSync(join(root, 'adab', 'config.yaml'), 'schema: chapter-draft\n');
  writeFileSync(join(root, 'adab', 'log.md'), '# Log\n');
  writeFileSync(join(root, 'adab', 'index', 'mentions.json'), '[]');
  writeFileSync(join(root, 'adab', 'changes', 'ch-001', 'draft.md'), '# Draft');
  writeFileSync(join(root, 'adab', 'schemas', 'chapter-draft', 'schema.yaml'), 'name: chapter-draft\n');
  writeFileSync(join(root, 'adab', 'wiki', 'characters', 'mara.md'), '# Mara');
  writeFileSync(join(root, 'adab', 'manuscript', 'chapters', 'ch-001.md'), '# Chapter');
  writeFileSync(join(root, 'package.json'), '{}');
  writeFileSync(join(root, '.env'), 'SECRET=value');
});

describe('guardProjectFilePath', () => {
  it('allows reads from OpenAdab metadata, logs, indexes, schemas, changes, wiki, and manuscript chapters', () => {
    expect(guardProjectFilePath('adab/config.yaml', root, 'read')).toBe(
      resolve(root, 'adab', 'config.yaml'),
    );
    expect(guardProjectFilePath('adab/log.md', root, 'read')).toBe(
      resolve(root, 'adab', 'log.md'),
    );
    expect(guardProjectFilePath('adab/index/mentions.json', root, 'read')).toBe(
      resolve(root, 'adab', 'index', 'mentions.json'),
    );
    expect(guardProjectFilePath('adab/schemas/chapter-draft/schema.yaml', root, 'read')).toBe(
      resolve(root, 'adab', 'schemas', 'chapter-draft', 'schema.yaml'),
    );
    expect(guardProjectFilePath('adab/changes/ch-001/draft.md', root, 'read')).toBe(
      resolve(root, 'adab', 'changes', 'ch-001', 'draft.md'),
    );
    expect(guardProjectFilePath('adab/wiki/characters/mara.md', root, 'read')).toBe(
      resolve(root, 'adab', 'wiki', 'characters', 'mara.md'),
    );
    expect(guardProjectFilePath('adab/manuscript/chapters/ch-001.md', root, 'read')).toBe(
      resolve(root, 'adab', 'manuscript', 'chapters', 'ch-001.md'),
    );
  });

  it('rejects reads of arbitrary project-root files and secrets', () => {
    expect(() => guardProjectFilePath('package.json', root, 'read')).toThrow(
      PathScopeError,
    );
    expect(() => guardProjectFilePath('.env', root, 'read')).toThrow(
      PathScopeError,
    );
  });

  it('allows writes only to editable OpenAdab content and temporary review artifacts', () => {
    expect(guardProjectFilePath('adab/changes/ch-001/draft.md', root, 'write')).toBe(
      resolve(root, 'adab', 'changes', 'ch-001', 'draft.md'),
    );
    expect(guardProjectFilePath('adab/wiki/characters/mara.md', root, 'write')).toBe(
      resolve(root, 'adab', 'wiki', 'characters', 'mara.md'),
    );
    expect(guardProjectFilePath('adab/manuscript/chapters/ch-001.md', root, 'write')).toBe(
      resolve(root, 'adab', 'manuscript', 'chapters', 'ch-001.md'),
    );
    expect(guardProjectFilePath('adab/.temp/wiki-diff-filtered.json', root, 'write')).toBe(
      resolve(root, 'adab', '.temp', 'wiki-diff-filtered.json'),
    );
  });

  it('rejects direct writes to config, indexes, secrets, and arbitrary project files', () => {
    expect(() => guardProjectFilePath('adab/config.yaml', root, 'write')).toThrow(
      PathScopeError,
    );
    expect(() => guardProjectFilePath('adab/index/mentions.json', root, 'write')).toThrow(
      PathScopeError,
    );
    expect(() => guardProjectFilePath('.env', root, 'write')).toThrow(
      PathScopeError,
    );
    expect(() => guardProjectFilePath('package.json', root, 'write')).toThrow(
      PathScopeError,
    );
  });

  it('allows listing known content directories and rejects listing the project root', () => {
    expect(guardProjectFilePath('adab/wiki', root, 'list')).toBe(
      resolve(root, 'adab', 'wiki'),
    );
    expect(guardProjectFilePath('adab/manuscript/chapters', root, 'list')).toBe(
      resolve(root, 'adab', 'manuscript', 'chapters'),
    );
    expect(() => guardProjectFilePath('.', root, 'list')).toThrow(
      PathScopeError,
    );
  });

  it('rejects scoped paths that resolve through a symlink to an unpermitted project file', () => {
    if (process.platform === 'win32' && !hasSymlinkSupport()) {
      return;
    }

    symlinkSync(join(root, 'package.json'), join(root, 'adab', 'wiki', 'linked-package.md'), 'file');
    expect(() =>
      guardProjectFilePath('adab/wiki/linked-package.md', root, 'read'),
    ).toThrow(PathScopeError);
  });

  it('still rejects parent traversal before checking project subdirectory scope', () => {
    expect(() =>
      guardProjectFilePath('../outside/adab/wiki/page.md', root, 'read'),
    ).toThrow(PathEscapeError);
  });
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup.
  }
});

describe('guardFilePath', () => {
  // ── Normal paths ──────────────────────────────────────
  it('returns the resolved path for a file inside the root', () => {
    const result = guardFilePath('file.txt', root);
    expect(result).toBe(resolve(root, 'file.txt'));
  });

  it('returns the resolved path for a nested file', () => {
    const result = guardFilePath('subdir/nested.txt', root);
    expect(result).toBe(resolve(root, 'subdir', 'nested.txt'));
  });

  it('returns the resolved path when requested path is the root itself', () => {
    const result = guardFilePath('.', root);
    expect(result).toBe(resolve(root));
  });

  it('handles paths with spaces', () => {
    const result = guardFilePath('spaces in path/spaced.txt', root);
    expect(result).toBe(resolve(root, 'spaces in path', 'spaced.txt'));
  });

  // ── Relative segments ─────────────────────────────────
  it('resolves ./ prefix correctly', () => {
    const result = guardFilePath('./file.txt', root);
    expect(result).toBe(resolve(root, 'file.txt'));
  });

  it('resolves repeated ./ and nested paths', () => {
    const result = guardFilePath('./subdir/./nested.txt', root);
    expect(result).toBe(resolve(root, 'subdir', 'nested.txt'));
  });

  // ── Traversal rejection ───────────────────────────────
  it('rejects direct parent traversal (../)', () => {
    expect(() => guardFilePath('../secret.txt', root)).toThrow(PathEscapeError);
  });

  it('rejects multi-level parent traversal (../../etc)', () => {
    expect(() => guardFilePath('../../etc/passwd', root)).toThrow(
      PathEscapeError,
    );
  });

  it('rejects traversal nested in subdirectory', () => {
    expect(() => guardFilePath('subdir/../../../secret', root)).toThrow(
      PathEscapeError,
    );
  });

  it('rejects traversal disguised with ./ segments', () => {
    expect(() => guardFilePath('./subdir/./../../secret', root)).toThrow(
      PathEscapeError,
    );
  });

  // ── Absolute outside paths ────────────────────────────
  it('rejects an absolute path outside the root (POSIX)', () => {
    expect(() => guardFilePath('/etc/passwd', root)).toThrow(PathEscapeError);
  });

  // ── Windows-style paths ───────────────────────────────
  it('normalises backslashes on Windows', () => {
    const result = guardFilePath('subdir\\nested.txt', root);
    expect(result).toBe(resolve(root, 'subdir', 'nested.txt'));
  });

  it('rejects Windows absolute path outside root', () => {
    expect(() => guardFilePath('C:\\Windows\\System32', root)).toThrow(
      PathEscapeError,
    );
  });

  // ── Non-existent write targets ────────────────────────
  it('allows non-existent files within the root (write target)', () => {
    const result = guardFilePath('not-yet-created.txt', root);
    expect(result).toBe(resolve(root, 'not-yet-created.txt'));
  });

  it('allows non-existent nested files within the root', () => {
    const result = guardFilePath('subdir/new-file.md', root);
    expect(result).toBe(resolve(root, 'subdir', 'new-file.md'));
  });

  // ── Symlink escape ────────────────────────────────────
  if (process.platform !== 'win32' || hasSymlinkSupport()) {
    it('rejects a symlink inside root that points outside', () => {
      const outsideDir = resolve(tmpdir(), `openadab-outside-${Date.now()}`);
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'secret.txt'), 'outside');
      try {
        symlinkSync(outsideDir, join(root, 'link-out'), 'dir');
        expect(() => guardFilePath('link-out/secret.txt', root)).toThrow(
          PathEscapeError,
        );
      } finally {
        try {
          rmSync(outsideDir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      }
    });

    it('rejects a non-existent write target below an escaping symlink', () => {
      const outsideDir = resolve(tmpdir(), `openadab-outside-write-${Date.now()}`);
      mkdirSync(outsideDir, { recursive: true });
      try {
        symlinkSync(outsideDir, join(root, 'link-out'), 'dir');
        expect(() => guardFilePath('link-out/new-file.md', root)).toThrow(
          PathEscapeError,
        );
      } finally {
        try {
          rmSync(outsideDir, { recursive: true, force: true });
        } catch {
          // best-effort
        }
      }
    });

    it('resolves a symlink inside root that points inside', () => {
      symlinkSync(join(root, 'subdir'), join(root, 'link-in'), 'dir');
      const result = guardFilePath('link-in/nested.txt', root);
      expect(result).toBe(resolve(root, 'subdir', 'nested.txt'));
    });

    it('allows a non-existent write target below an internal symlink', () => {
      symlinkSync(join(root, 'subdir'), join(root, 'link-in'), 'dir');
      const result = guardFilePath('link-in/new-file.md', root);
      expect(result).toBe(resolve(root, 'subdir', 'new-file.md'));
    });
  } else {
    it.skip('symlink tests — symlink creation not available on this platform', () => {});
  }

  // ── PathEscapeError fields ────────────────────────────
  it('includes the requested path and project root in the error', () => {
    try {
      guardFilePath('../outside', root);
      expect.fail('Expected PathEscapeError');
    } catch (err) {
      expect(err).toBeInstanceOf(PathEscapeError);
      const e = err as PathEscapeError;
      expect(e.requestedPath).toBe('../outside');
      expect(e.projectRoot).toBe(root);
      expect(e.resolvedPath).toBeTruthy();
      expect(e.message).toContain('../outside');
      expect(e.message).toContain(root);
    }
  });

  // ── Edge cases ────────────────────────────────────────
  it('allows an empty string (resolves to root)', () => {
    const result = guardFilePath('', root);
    expect(result).toBe(resolve(root));
  });

  it('treats project root with trailing separator consistently', () => {
    const rootWithSep = root + sep;
    const result = guardFilePath('file.txt', rootWithSep);
    expect(result).toBe(resolve(root, 'file.txt'));
  });

  it('handles deeply nested valid paths', () => {
    const deep = join(root, 'a', 'b', 'c', 'd');
    mkdirSync(deep, { recursive: true });
    writeFileSync(join(deep, 'deep.txt'), 'deep');
    const result = guardFilePath('a/b/c/d/deep.txt', root);
    expect(result).toBe(resolve(root, 'a', 'b', 'c', 'd', 'deep.txt'));
  });
});

/**
 * Check whether the current platform supports creating symlinks
 * without elevated privileges.
 */
function hasSymlinkSupport(): boolean {
  try {
    const testDir = resolve(tmpdir(), `openadab-symtest-${Date.now()}`);
    const testLink = resolve(tmpdir(), `openadab-symlink-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    symlinkSync(testDir, testLink, 'dir');
    rmSync(testLink, { force: true });
    rmSync(testDir, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}
