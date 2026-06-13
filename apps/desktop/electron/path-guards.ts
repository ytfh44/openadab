/**
 * Path boundary guard for all main-process filesystem operations.
 *
 * Every file read or write requested by the renderer must pass through
 * {@link guardFilePath} before the main process touches the disk. This
 * prevents path-traversal attacks, symlink escapes, and accidental
 * writes outside the selected project root.
 */

import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { existsSync, realpathSync } from 'node:fs';

/**
 * Error thrown when a requested filesystem path resolves outside the
 * configured project root directory.
 */
export class PathEscapeError extends Error {
  constructor(
    public readonly requestedPath: string,
    public readonly projectRoot: string,
    public readonly resolvedPath: string,
  ) {
    super(
      `Path "${requestedPath}" escapes project root "${projectRoot}"` +
        ` (resolved to "${resolvedPath}")`,
    );
    this.name = 'PathEscapeError';
  }
}

/**
 * Error thrown when a requested path remains inside the project root but
 * targets a project subdirectory that the requested file operation is not
 * allowed to access.
 */
export class PathScopeError extends Error {
  constructor(
    public readonly requestedPath: string,
    public readonly projectRoot: string,
    public readonly resolvedPath: string,
    public readonly access: ProjectFileAccess,
  ) {
    super(
      `Path "${requestedPath}" is not allowed for ${access} access` +
        ` in project root "${projectRoot}" (resolved to "${resolvedPath}")`,
    );
    this.name = 'PathScopeError';
  }
}

/** Main-process file operation category used for project subdirectory checks. */
export type ProjectFileAccess = 'read' | 'write' | 'list' | 'watch';

/**
 * Validate that `requestedPath` lies within `projectRoot` after
 * normalisation and symlink resolution.
 *
 * Steps performed:
 * 1. Resolve `requestedPath` relative to `projectRoot` via
 *    {@link resolve} (handles `..`, absolute inputs, and relative
 *    segments).
 * 2. Resolve symlinks with {@link realpathSync} on both the result
 *    and the project root so that a symlink inside the root pointing
 *    outside cannot be used to escape.
 * 3. Normalise both paths and verify the guarded path starts with
 *    the project root (plus a trailing separator).
 *
 * @param requestedPath - A path that may be relative or absolute.
 * @param projectRoot   - The absolute, normalised project root.
 * @returns The absolute, canonical path safe to use for I/O.
 * @throws {PathEscapeError} When the resolved path falls outside
 *   the project root.
 */
export function guardFilePath(
  requestedPath: string,
  projectRoot: string,
): string {
  const resolvedRoot = resolve(projectRoot);

  const absolutePath = resolve(resolvedRoot, requestedPath);

  const realPath = resolveForGuard(absolutePath);
  const realRoot = tryRealpath(resolvedRoot);

  const normalisedPath = normalize(realPath);
  const normalisedRoot = normalize(realRoot);

  const rooted =
    normalisedPath === normalisedRoot ||
    normalisedPath.startsWith(normalisedRoot + sep);

  if (!rooted) {
    throw new PathEscapeError(requestedPath, projectRoot, realPath);
  }

  return realPath;
}

/**
 * Validate that a renderer-requested file path is both inside the selected
 * OpenAdab project root and inside a subdirectory permitted for the operation.
 *
 * @param requestedPath - A relative or absolute renderer-supplied path.
 * @param projectRoot - The active OpenAdab project root.
 * @param access - Operation category that determines allowed subtrees.
 * @returns The absolute canonical path safe for the requested operation.
 * @throws {PathEscapeError} When the path escapes the project root.
 * @throws {PathScopeError} When the path is inside the project but outside
 *   every permitted OpenAdab project subtree for the operation.
 */
export function guardProjectFilePath(
  requestedPath: string,
  projectRoot: string,
  access: ProjectFileAccess,
): string {
  const safePath = guardFilePath(requestedPath, projectRoot);
  const projectRelativePath = relativeProjectPath(safePath, projectRoot);
  const allowed = allowedProjectPath(projectRelativePath, access);

  if (!allowed) {
    throw new PathScopeError(requestedPath, projectRoot, safePath, access);
  }

  return safePath;
}

/**
 * Return the canonical project-relative path used by scope allow-lists.
 *
 * The returned value always uses `/` separators so allow-list checks behave the
 * same on Windows, macOS, and Linux.
 */
function relativeProjectPath(filePath: string, projectRoot: string): string {
  const realRoot = tryRealpath(resolve(projectRoot));
  const relativePath = relative(normalize(realRoot), normalize(filePath));
  const normalizedRelative = relativePath.replace(/\\/g, '/');
  return process.platform === 'win32'
    ? normalizedRelative.toLowerCase()
    : normalizedRelative;
}

/**
 * Check whether a project-relative path belongs to the OpenAdab subtree
 * permitted for a renderer file operation.
 */
function allowedProjectPath(
  projectRelativePath: string,
  access: ProjectFileAccess,
): boolean {
  const path = projectRelativePath.replace(/^\/+/, '');

  if (path.length === 0 || path.startsWith('../')) {
    return false;
  }

  if (access === 'read' || access === 'watch') {
    return (
      path === 'adab/config.yaml' ||
      path === 'adab/log.md' ||
      isWithinProjectSubtree(path, 'adab/index') ||
      isWithinProjectSubtree(path, 'adab/schemas') ||
      isWithinProjectSubtree(path, 'adab/changes') ||
      isWithinProjectSubtree(path, 'adab/wiki') ||
      isWithinProjectSubtree(path, 'adab/manuscript/chapters')
    );
  }

  if (access === 'write') {
    return (
      isWithinProjectSubtree(path, 'adab/changes') ||
      isWithinProjectSubtree(path, 'adab/schemas') ||
      isWithinProjectSubtree(path, 'adab/wiki') ||
      isWithinProjectSubtree(path, 'adab/manuscript/chapters') ||
      isWithinProjectSubtree(path, 'adab/.temp')
    );
  }

  return (
    isWithinProjectSubtree(path, 'adab/index') ||
    isWithinProjectSubtree(path, 'adab/schemas') ||
    isWithinProjectSubtree(path, 'adab/changes') ||
    isWithinProjectSubtree(path, 'adab/wiki') ||
    isWithinProjectSubtree(path, 'adab/manuscript/chapters')
  );
}

/**
 * Return whether a project-relative path is exactly a subtree root or a child
 * of that subtree root.
 */
function isWithinProjectSubtree(
  projectRelativePath: string,
  subtree: string,
): boolean {
  return (
    projectRelativePath === subtree ||
    projectRelativePath.startsWith(`${subtree}/`)
  );
}

/**
 * Resolve a path for containment checks. Existing targets use their full
 * realpath. For non-existent write targets, resolve the nearest existing
 * ancestor and append the missing path segments so parent-directory symlinks
 * cannot redirect writes outside the project root.
 */
function resolveForGuard(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return realpathNearestExistingAncestor(filePath);
  }
}

/**
 * Resolve the nearest existing ancestor for a path that does not exist yet.
 *
 * Example:
 *   project/link-out/new.md
 *
 * If `link-out` is a symlink to `/outside`, this returns
 * `/outside/new.md`, which the root containment check will reject.
 */
function realpathNearestExistingAncestor(filePath: string): string {
  const missingSegments: string[] = [];
  let current = filePath;

  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      return filePath;
    }
    missingSegments.unshift(relative(parent, current));
    current = parent;
  }

  const realAncestor = tryRealpath(current);
  return missingSegments.length > 0
    ? join(realAncestor, ...missingSegments)
    : realAncestor;
}

/**
 * Return {@link realpathSync} result when the path exists, otherwise return
 * the original path unchanged.
 */
function tryRealpath(filePath: string): string {
  try {
    return realpathSync(filePath);
  } catch {
    return filePath;
  }
}
