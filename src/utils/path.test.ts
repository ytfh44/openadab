import { join, resolve } from 'node:path';

import { describe, it, expect } from 'vitest';

import {
  resolveFromProjectRoot,
  resolveSchemaTemplate,
  resolveChangeArtifact,
  resolveWikiPage,
  resolveManuscriptChapter,
  PathTraversalError,
} from './path.js';
import { AdabError } from './errors.js';

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
  it('should resolve wiki page path', () => {
    expect(resolveWikiPage('/proj', 'characters/alice.md')).toBe(
      resolve('/proj', 'adab', 'wiki', 'characters/alice.md')
    );
  });

  it('should handle root wiki page', () => {
    expect(resolveWikiPage('/proj', 'index.md')).toBe(
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
