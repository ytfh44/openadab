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
  validateSubScope,
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


describe('validateSubScope', () => {
  // ── Read scope ───────────────────────────────────────
  it('allows read within project root', () => {
    const result = validateSubScope('file.txt', root, 'read');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'file.txt'));
    expect(result.error).toBeUndefined();
  });

  it('allows read of deeply nested file within project root', () => {
    const result = validateSubScope('subdir/nested.txt', root, 'read');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'subdir', 'nested.txt'));
  });

  it('rejects read outside project root via parent traversal', () => {
    const result = validateSubScope('../outside.txt', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('outside');
  });

  it('rejects read via absolute path outside root', () => {
    const result = validateSubScope('C:/Windows/System32', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── Write scope ──────────────────────────────────────
  it('allows write within project root subdirectory', () => {
    const result = validateSubScope('subdir/new-file.md', root, 'write');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'subdir', 'new-file.md'));
  });

  it('allows write to non-existent nested path within root', () => {
    const result = validateSubScope('adab/.temp/draft.json', root, 'write');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'adab', '.temp', 'draft.json'));
  });

  it('rejects write outside project root', () => {
    const result = validateSubScope('../../outside/write.txt', root, 'write');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects write via absolute path outside root', () => {
    const result = validateSubScope('/etc/malicious.sh', root, 'write');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── List scope ───────────────────────────────────────
  it('allows directory listing within project root', () => {
    const result = validateSubScope('subdir', root, 'list');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'subdir'));
  });

  it('allows directory listing at project root', () => {
    const result = validateSubScope('.', root, 'list');
    expect(result.valid).toBe(true);
  });

  it('rejects directory listing outside project root', () => {
    const result = validateSubScope('../../../', root, 'list');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── Temp scope ───────────────────────────────────────
  it('allows temp artifact within adab/.temp subdirectory', () => {
    mkdirSync(join(root, 'adab/.temp'), { recursive: true });
    writeFileSync(join(root, 'adab/.temp', 'diff.json'), '{}');
    const result = validateSubScope('adab/.temp/diff.json', root, 'temp');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'adab/.temp', 'diff.json'));
  });

  it('allows non-existent temp artifact within adab/.temp', () => {
    mkdirSync(join(root, 'adab/.temp'), { recursive: true });
    const result = validateSubScope('adab/.temp/new-artifact.md', root, 'temp');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'adab/.temp', 'new-artifact.md'));
  });

  it('rejects temp artifact outside adab/.temp', () => {
    const result = validateSubScope('subdir/temp-file.txt', root, 'temp');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.error).toContain('adab/.temp');
  });

  it('rejects temp artifact at project root', () => {
    const result = validateSubScope('temp-artifact.json', root, 'temp');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('adab/.temp');
  });

  // ── Path traversal attacks ───────────────────────────
  it('rejects dot-dot-slash traversal to /etc/passwd', () => {
    const result = validateSubScope('../../etc/passwd', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects encoded traversal attempt', () => {
    const result = validateSubScope('..%2F..%2Fetc%2Fpasswd', root, 'read');
    expect(result.valid).toBe(false);
  });

  it('rejects deep traversal with many ../ segments', () => {
    const result = validateSubScope('../../../../../../../../etc/passwd', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── Absolute path attacks ────────────────────────────
  it('rejects absolute Unix-style path', () => {
    const result = validateSubScope('/etc/passwd', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('rejects absolute Windows-style path', () => {
    const result = validateSubScope('D:/secret/data.txt', root, 'read');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });

  // ── Symlink traversal ────────────────────────────────
  if (process.platform !== 'win32' || hasSymlinkSupport()) {
    it('rejects absolute symlink traversal', () => {
      const outsideDir = resolve(tmpdir(), 'openadab-symscope-' + Date.now());
      mkdirSync(outsideDir, { recursive: true });
      writeFileSync(join(outsideDir, 'secret.txt'), 'stolen');
      try {
        symlinkSync(outsideDir, join(root, 'escape-link'), 'dir');
        const result = validateSubScope('escape-link/secret.txt', root, 'read');
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
      } finally {
        try {
          rmSync(outsideDir, { recursive: true, force: true });
        } catch { /* best-effort */ }
      }
    });

    it('rejects non-existent write below escaping symlink', () => {
      const outsideDir = resolve(tmpdir(), 'openadab-symscope-write-' + Date.now());
      mkdirSync(outsideDir, { recursive: true });
      try {
        symlinkSync(outsideDir, join(root, 'escape-link'), 'dir');
        const result = validateSubScope('escape-link/new-file.md', root, 'write');
        expect(result.valid).toBe(false);
        expect(result.error).toBeTruthy();
      } finally {
        try {
          rmSync(outsideDir, { recursive: true, force: true });
        } catch { /* best-effort */ }
      }
    });

    it('allows symlink that stays inside project root', () => {
      symlinkSync(join(root, 'subdir'), join(root, 'safe-link'), 'dir');
      const result = validateSubScope('safe-link/nested.txt', root, 'read');
      expect(result.valid).toBe(true);
      expect(result.resolvedPath).toBe(resolve(root, 'subdir', 'nested.txt'));
    });
  } else {
    it.skip('symlink traversal tests — symlink creation not available on this platform', () => {});
  }

  // ── Edge cases ───────────────────────────────────────
  it('handles empty string (resolves to root)', () => {
    const result = validateSubScope('', root, 'read');
    expect(result.valid).toBe(true);
  });

  it('handles dot-only path (current directory)', () => {
    const result = validateSubScope('.', root, 'read');
    expect(result.valid).toBe(true);
  });

  it('handles paths with spaces', () => {
    const result = validateSubScope('spaces in path/spaced.txt', root, 'read');
    expect(result.valid).toBe(true);
    expect(result.resolvedPath).toBe(resolve(root, 'spaces in path', 'spaced.txt'));
  });

  it('returns structured result with valid=true and no error on success', () => {
    const result = validateSubScope('file.txt', root, 'read');
    expect(result).toHaveProperty('valid', true);
    expect(result).toHaveProperty('resolvedPath');
    expect(result).not.toHaveProperty('error');
  });

  it('returns structured result with valid=false and error on failure', () => {
    const result = validateSubScope('../outside', root, 'read');
    expect(result).toHaveProperty('valid', false);
    expect(result).toHaveProperty('error');
    expect(typeof result.error).toBe('string');
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
