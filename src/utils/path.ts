import { lstat, realpath } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import { AdabError } from './errors.js';

/**
 * Build an absolute path by joining `projectRoot` with the supplied
 * relative segments.  Pure path-join; no boundary checking.
 *
 * @param projectRoot Absolute path to the project root.
 * @param segments    Path segments relative to the project root.
 * @returns Joined absolute path.
 */
export function resolveFromProjectRoot(projectRoot: string, ...segments: string[]): string {
  return join(projectRoot, ...segments);
}

/**
 * Build the absolute path of a template file inside a schema's
 * `templates/` directory.
 *
 * @param projectRoot   Absolute path to the project root.
 * @param schemaName    Schema name.
 * @param templateName  Template file name.
 * @returns Absolute path to the schema template.
 */
export function resolveSchemaTemplate(projectRoot: string, schemaName: string, templateName: string): string {
  return join(projectRoot, 'adab', 'schemas', schemaName, 'templates', templateName);
}

/**
 * Build the absolute path of an artifact file inside a change directory.
 *
 * @param projectRoot    Absolute path to the project root.
 * @param changeId       Change identifier (e.g. `ch-012`).
 * @param artifactName   Artifact file name (e.g. `brief.md`).
 * @returns Absolute path to the change artifact.
 */
export function resolveChangeArtifact(projectRoot: string, changeId: string, artifactName: string): string {
  return join(projectRoot, 'adab', 'changes', changeId, artifactName);
}

/**
 * Thrown when a resolved path escapes its declared boundary directory.
 *
 * The error carries no payload beyond the human-readable message; the
 * AdabError `code` (`PATH_TRAVERSAL`) is what callers should match on.
 */
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
 * Resolve `realpath` for a path, falling back to the input path when
 * the path genuinely does not exist (realpath throws ENOENT and lstat
 * confirms there is no entry at all).
 *
 * A DANGLING symlink — an entry lstat sees as a symlink whose target
 * is missing — is NOT treated as "does not exist": the realpath ENOENT
 * is rethrown so the caller fails closed instead of later writing
 * through the link.
 *
 * Any other error (permission denied, loop, etc.) is rethrown so the
 * caller can decide whether to fail closed or open.
 *
 * @param p Path to resolve.
 * @returns Real path on success, original path on genuine ENOENT.
 * @throws {NodeJS.ErrnoException} The original ENOENT when `p` is a
 *         dangling symlink.
 */
async function safeRealPath(p: string): Promise<string> {
  try {
    return await realpath(p);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code !== 'ENOENT') {
      throw err;
    }
    // realpath ENOENT means either "no entry at all" or "dangling
    // symlink" (the symlink entry exists but its target does not).
    // lstat distinguishes the two: a symlink entry is visible even
    // when its target is missing.
    let isSymlink = false;
    try {
      isSymlink = (await lstat(p)).isSymbolicLink();
    } catch (lstatErr) {
      const le = lstatErr as NodeJS.ErrnoException;
      if (le.code !== 'ENOENT') {
        throw lstatErr;
      }
      return p; // genuinely missing — fall back
    }
    if (isSymlink) {
      throw err; // dangling symlink — do NOT fall back
    }
    return p;
  }
}

/**
 * Resolve a path against `pwd` and verify it stays within the `pwd`
 * boundary directory, both lexically and after following any symlinks.
 *
 * Two layers of defence:
 *  1. **Lexical check** — the segments, after `resolve(pwd, ...segments)`,
 *     must not produce a relative path that begins with `..` (the
 *     boundary's parent). File names that simply start with `..` but
 *     are not the `..` segment itself (e.g. `..bar.md`) are accepted.
 *  2. **Symlink check** — when the resolved path exists on disk, its
 *     `realpath` is computed and must also lie inside the boundary's
 *     own realpath. This stops attacks of the form
 *     `adab/wiki/page.md → /etc/passwd` from passing the lexical check.
 *
 * If `realpath` cannot be computed because the file does not exist,
 * the lexical result is returned (callers commonly resolve a path
 * before creating it).
 *
 * @param pwd      Boundary directory (absolute path expected).
 * @param segments Path segments relative to `pwd`.
 * @returns The absolute, resolved path on success.
 * @throws {PathTraversalError} When the resolved path escapes the boundary.
 */
export async function resolveWithinBoundary(pwd: string, ...segments: string[]): Promise<string> {
  const resolved = resolve(pwd, ...segments);
  const normPwd = resolve(pwd);
  let realResolved: string;
  try {
    realResolved = await safeRealPath(resolved);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      // safeRealPath rethrows ENOENT only for a dangling symlink: the
      // lexical path lies inside the boundary, but a write through it
      // would follow the link to a (missing) target outside.
      throw new PathTraversalError(segments.join('/'), pwd);
    }
    throw err;
  }
  const realPwd = await safeRealPath(normPwd);
  const rel = relative(realPwd, realResolved);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new PathTraversalError(segments.join('/'), pwd);
  }
  return resolved;
}

/**
 * Resolve a wiki page path under `<projectRoot>/adab/wiki/`.
 *
 * @param projectRoot Absolute path to the project root.
 * @param pagePath    Wiki page path relative to `adab/wiki/`
 *                    (e.g. `characters/alice.md`).
 * @returns Absolute, boundary-checked wiki page path.
 * @throws {PathTraversalError} When the page escapes the wiki root.
 */
export async function resolveWikiPage(projectRoot: string, pagePath: string): Promise<string> {
  const wikiRoot = join(projectRoot, 'adab', 'wiki');
  return resolveWithinBoundary(wikiRoot, pagePath);
}

/**
 * Validate that a change directory name stays within the project boundary.
 *
 * Rejects empty names, absolute paths, parent-directory traversal (`..`),
 * and any separator characters. The check is purely lexical — the resolved
 * path is also compared to the expected `changes/` parent to defend against
 * platforms where `..` does not collapse (e.g. Windows with mixed
 * separators).
 *
 * @param projectRoot Absolute path to the project root.
 * @param changeDir   Change directory name supplied by the caller.
 * @throws {AdabError} with code `PATH_TRAVERSAL` if the name is unsafe.
 */
export function assertChangeDirSafe(projectRoot: string, changeDir: string): void {
  if (changeDir.length === 0) {
    throw new AdabError('Change directory name is empty', 'PATH_TRAVERSAL');
  }
  if (isAbsolute(changeDir)) {
    throw new AdabError(`Change directory escapes project boundary: ${changeDir}`, 'PATH_TRAVERSAL');
  }
  if (changeDir.includes('..') || changeDir.includes('/') || changeDir.includes('\\') || changeDir.includes('\0')) {
    throw new AdabError(`Change directory escapes project boundary: ${changeDir}`, 'PATH_TRAVERSAL');
  }
  const expected = join(projectRoot, 'adab', 'changes', changeDir);
  const resolvedExpected = resolve(expected);
  const changesRoot = resolve(join(projectRoot, 'adab', 'changes')) + sep;
  if (!resolvedExpected.startsWith(changesRoot)) {
    throw new AdabError(`Change directory escapes project boundary: ${changeDir}`, 'PATH_TRAVERSAL');
  }
}

/**
 * Build the absolute path of a manuscript chapter under
 * `<projectRoot>/adab/manuscript/chapters/`. No boundary check; this
 * helper is for trusted, schema-derived IDs.
 *
 * @param projectRoot Absolute path to the project root.
 * @param chapterId   Chapter identifier (e.g. `ch-001`).
 * @returns Absolute path to the chapter markdown file.
 */
export function resolveManuscriptChapter(projectRoot: string, chapterId: string): string {
  return join(projectRoot, 'adab', 'manuscript', 'chapters', `${chapterId}.md`);
}
