import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, resolve, sep } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// Mock node:fs/promises.realpath so the symlink-awareness tests run
// portably across operating systems without needing the OS to permit
// real symlink creation (Windows requires elevated privileges).
// The default identity implementation lets every test that does not set
// its own mockImplementation see "no symlink" (realpath(p) === p).
vi.mock('node:fs/promises', async () => {
  const actual = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');
  return {
    ...actual,
    realpath: vi.fn(async (p: unknown) => String(p)),
  };
});

import {
  resolveFromProjectRoot,
  resolveSchemaTemplate,
  resolveChangeArtifact,
  resolveWikiPage,
  resolveManuscriptChapter,
  resolveWithinBoundary,
  PathTraversalError,
} from './path.js';
import { AdabError } from './errors.js';
import { realpath } from 'node:fs/promises';

const mockedRealpath = vi.mocked(realpath);

describe('resolveFromProjectRoot', () => {
  it('should resolve single segment', () => {
    expect(resolveFromProjectRoot('/proj', 'a.txt')).toBe(join('/proj', 'a.txt'));
  });

  it('should resolve multiple segments', () => {
    expect(resolveFromProjectRoot('/proj', 'a', 'b', 'c.txt')).toBe(
      join('/proj', 'a', 'b', 'c.txt')
    );
  });

  it('should handle empty segments', () => {
    expect(resolveFromProjectRoot('/proj')).toBe(join('/proj'));
  });
});

describe('resolveSchemaTemplate', () => {
  it('should resolve schema template path', () => {
    expect(resolveSchemaTemplate('/proj', 'chapter-draft', 'brief.md')).toBe(
      join('/proj', 'adab', 'schemas', 'chapter-draft', 'templates', 'brief.md')
    );
  });
});

describe('resolveChangeArtifact', () => {
  it('should resolve change artifact path', () => {
    expect(resolveChangeArtifact('/proj', 'ch-012', 'brief.md')).toBe(
      join('/proj', 'adab', 'changes', 'ch-012', 'brief.md')
    );
  });
});

describe('resolveWikiPage', () => {
  it('should resolve wiki page path', async () => {
    expect(await resolveWikiPage('/proj', 'characters/alice.md')).toBe(
      resolve('/proj', 'adab', 'wiki', 'characters/alice.md')
    );
  });

  it('should handle root wiki page', async () => {
    expect(await resolveWikiPage('/proj', 'index.md')).toBe(
      resolve('/proj', 'adab', 'wiki', 'index.md')
    );
  });
});

describe('resolveManuscriptChapter', () => {
  it('should resolve manuscript chapter path', () => {
    expect(resolveManuscriptChapter('/proj', 'ch-001')).toBe(
      join('/proj', 'adab', 'manuscript', 'chapters', 'ch-001.md')
    );
  });
});

describe('PathTraversalError', () => {
  it('should be an instance of AdabError', () => {
    const error = new PathTraversalError('../etc/passwd', '/safe/dir');
    expect(error instanceof AdabError).toBe(true);
    expect(error instanceof Error).toBe(true);
  });

  it('should have correct name and code', () => {
    const error = new PathTraversalError('../etc/passwd', '/safe/dir');
    expect(error.name).toBe('PathTraversalError');
    expect(error.code).toBe('PATH_TRAVERSAL');
  });
});

// =============================================================================
// Lexical boundary check: file names that happen to start with ".." must not
// be flagged as traversal. Previously the implementation used
// `relative(pwd, resolved).startsWith('..')` which rejected legitimate
// filenames like "..bar.md".
// =============================================================================
describe('resolveWithinBoundary lexical edge cases', () => {
  it('accepts a leaf file whose name starts with ".." but is not "..", e.g. "..bar.md"', async () => {
    const pwd = resolve('/tmp', 'openadab-boundary-lex-1');
    const resolved = await resolveWithinBoundary(pwd, '..bar.md');
    expect(resolved).toBe(join(pwd, '..bar.md'));
  });

  it('accepts a nested file with a ".."-prefixed directory name', async () => {
    const pwd = resolve('/tmp', 'openadab-boundary-lex-2');
    const resolved = await resolveWithinBoundary(pwd, '..notes', 'readme.md');
    expect(resolved).toBe(join(pwd, '..notes', 'readme.md'));
  });

  it('rejects ".." segment (parent directory traversal)', async () => {
    const pwd = resolve('/tmp', 'openadab-boundary-parent');
    await expect(resolveWithinBoundary(pwd, '..', 'foo.md'))
      .rejects.toBeInstanceOf(PathTraversalError);
  });

  it('rejects a deeper traversal like "../etc/passwd"', async () => {
    const pwd = resolve('/tmp', 'openadab-boundary-deeper');
    await expect(resolveWithinBoundary(pwd, '..', 'etc', 'passwd'))
      .rejects.toBeInstanceOf(PathTraversalError);
  });
});

// =============================================================================
// Symlink-aware boundary check: a symlink whose target is outside the
// boundary must be rejected even though the lexical path lies inside it.
// realpath is mocked above so the test works without OS-level symlinks.
// =============================================================================
describe('resolveWithinBoundary symlink awareness (mocked realpath)', () => {
  let boundary: string;

  beforeEach(() => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-symlink-'));
    boundary = join(root, 'inside');
    mkdirSync(boundary, { recursive: true });
    mockedRealpath.mockReset();
  });

  afterEach(() => {
    rmSync(resolve(boundary, '..'), { recursive: true, force: true });
  });

  it('rejects a symlink whose realpath points outside the boundary', async () => {
    const outside = join(resolve(boundary, '..'), 'outside', 'secret.txt');
    mockedRealpath.mockImplementation((async (p: unknown) => {
      const pathStr = String(p);
      if (pathStr === boundary) {
        return boundary;
      }
      if (pathStr.endsWith('escape.md')) {
        return outside;
      }
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }) as never);
    await expect(resolveWithinBoundary(boundary, 'escape.md'))
      .rejects.toBeInstanceOf(PathTraversalError);
  });

  it('accepts a symlink whose realpath points inside the boundary', async () => {
    mockedRealpath.mockImplementation((async (p: unknown) => String(p)) as never);
    await expect(resolveWithinBoundary(boundary, 'link.txt'))
      .resolves.toBe(join(boundary, 'link.txt'));
  });

  it('falls back to lexical check when realpath rejects with ENOENT', async () => {
    mockedRealpath.mockImplementation((async () => {
      const err: NodeJS.ErrnoException = new Error('ENOENT');
      err.code = 'ENOENT';
      throw err;
    }) as never);
    await expect(resolveWithinBoundary(boundary, 'ghost.md'))
      .resolves.toBe(join(boundary, 'ghost.md'));
  });

  it('rejects lexical traversal even when realpath would resolve it back inside', async () => {
    // A boundary outside of realpath: e.g. boundary points at a child of the
    // real boundary, so a `..` segment is needed to escape.
    mockedRealpath.mockImplementation((async (p: unknown) => String(p)) as never);
    await expect(resolveWithinBoundary(boundary, '..', 'foo.md'))
      .rejects.toBeInstanceOf(PathTraversalError);
  });
});

// Use sep at least once so the import isn't tree-shaken when only async
// tests above reference it through the lexical edge-case describe blocks.
const _sepSanity = sep;
void _sepSanity;
void isAbsolute;
