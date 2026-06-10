import { isAbsolute, join, resolve, relative } from 'node:path';
import { AdabError } from './errors.js';

export function resolveFromProjectRoot(projectRoot: string, ...segments: string[]): string {
  return join(projectRoot, ...segments);
}

export function resolveSchemaTemplate(projectRoot: string, schemaName: string, templateName: string): string {
  return join(projectRoot, 'adab', 'schemas', schemaName, 'templates', templateName);
}

export function resolveChangeArtifact(projectRoot: string, changeId: string, artifactName: string): string {
  return join(projectRoot, 'adab', 'changes', changeId, artifactName);
}

export class PathTraversalError extends AdabError {
  constructor(requestedPath: string, boundary: string) {
    super(
      `Path traversal detected: "${requestedPath}" escapes boundary "${boundary}"`,
      'PATH_TRAVERSAL'
    );
    this.name = 'PathTraversalError';
  }
}

/**
 * Resolve a path and verify it stays within the given boundary directory.
 * Throws {@link PathTraversalError} if the resolved path escapes the boundary.
 */
export function resolveWithinBoundary(pwd: string, ...segments: string[]): string {
  const resolved = resolve(pwd, ...segments);
  const normPwd = resolve(pwd);  // Normalize to match format (adds drive letter on Windows)
  const rel = relative(normPwd, resolved);
  // If relative path starts with .. or is absolute (different drive), it's an escape
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new PathTraversalError(segments.join('/'), pwd);
  }
  return resolved;
}

export function resolveWikiPage(projectRoot: string, pagePath: string): string {
  const wikiRoot = join(projectRoot, 'adab', 'wiki');
  return resolveWithinBoundary(wikiRoot, pagePath);
}

export function resolveManuscriptChapter(projectRoot: string, chapterId: string): string {
  return join(projectRoot, 'adab', 'manuscript', 'chapters', `${chapterId}.md`);
}
