import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, access, unlink } from 'node:fs/promises';
import { dirname, basename } from 'node:path';

import { AdabError } from './errors.js';

/**
 * Build a redacted version of `path` suitable for inclusion in error
 * messages.  Keeps the basename so users can still tell which file
 * failed, but hides every parent segment to avoid leaking absolute
 * paths that may contain usernames, project layouts, or other
 * identifying details.
 *
 * The function degrades gracefully: a malformed input still returns
 * the original (a single-segment string has no parent to redact).
 *
 * @param path Absolute or relative path that was being accessed.
 * @returns A path with parent segments replaced by `...` when longer
 *          than one segment, otherwise the input unchanged.
 */
function redactPath(path: string): string {
  if (typeof path !== 'string' || path.length === 0) {
    return '<empty>';
  }
  if (path.includes('\u0000')) {
    // NUL bytes are never valid in filesystem paths; the path is
    // meaningless to the user.  Hide it entirely.
    return '<invalid path>';
  }
  const base = basename(path);
  const dir = dirname(path);
  if (dir === '.' || dir === '/' || dir === path) {
    // No parent to redact (e.g. `foo.txt` or `/foo.txt`).
    return base;
  }
  return `.../${base}`;
}

/**
 * Safely read a file asynchronously.
 *
 * Returns `null` if the file does not exist *or* if the path points at
 * a directory (the `EISDIR` case is intentionally swallowed so
 * directory-walk callers that probe for "file or directory?" get a
 * consistent answer across the sync and async helpers).
 *
 * Any other error (permission denied, invalid path, etc.) is wrapped
 * in an {@link AdabError} and thrown.  The error message redacts the
 * parent path so absolute paths are not echoed back to the user.
 *
 * @param path Absolute or relative path to the file.
 * @returns File contents as UTF-8 string, or `null` when missing or
 *          when the path is a directory.
 */
export async function safeReadFile(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      return null;
    }
    throw new AdabError(`Failed to read "${redactPath(path)}": ${e.message}`, 'FS_READ_ERROR', { cause: err });
  }
}

/**
 * Synchronous version of {@link safeReadFile}.
 *
 * @param path Absolute or relative path to the file.
 * @returns File contents as UTF-8 string, or `null` when missing or
 *          when the path is a directory.
 */
export function safeReadFileSync(path: string): string | null {
  try {
    return readFileSync(path, 'utf-8');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT' || e.code === 'EISDIR') {
      return null;
    }
    throw new AdabError(`Failed to read "${redactPath(path)}": ${e.message}`, 'FS_READ_ERROR', { cause: err });
  }
}

/**
 * Atomically write a file by first writing to a temporary sibling file and
 * then renaming it into place.
 *
 * This guarantees that readers never observe a partially-written file.
 *
 * Concurrency: the temp file name includes a UUID, so two concurrent
 * calls targeting the same destination will not collide on the temp
 * file.  The actual `rename` is an atomic POSIX / `MoveFileEx`
 * operation on Windows; callers that need cross-process serialisation
 * on a single destination should layer an external lock (the
 * `ProjectInitializer` does this with a `.openadab-init.lock` file).
 *
 * @param path    Destination file path.
 * @param content UTF-8 string to write.
 */
export async function atomicWriteFile(path: string, content: string): Promise<void> {
  const tempPath = `${path}.tmp.${randomUUID()}`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(tempPath, content, 'utf-8');
    await rename(tempPath, path);
  } catch (err) {
    // Best-effort cleanup of the temp file.  We deliberately log
    // (rather than silently swallow) because a stray .tmp.<uuid> file
    // left in the project tree is a sign of a real failure and an
    // operator triaging the issue should be able to find the trail.
    try {
      await unlink(tempPath);
    } catch (cleanupErr) {
      const cleanupCode = (cleanupErr as NodeJS.ErrnoException).code;
      // ENOENT is fine — the temp file never landed.
      if (cleanupCode !== 'ENOENT') {
        console.warn(
          `[fs] Failed to remove temp file "${redactPath(tempPath)}" ` +
          `after a failed write to "${redactPath(path)}": ` +
          `${(cleanupErr as Error).message}`
        );
      }
    }
    const e = err as NodeJS.ErrnoException;
    throw new AdabError(`Failed to write "${redactPath(path)}": ${e.message}`, 'FS_WRITE_ERROR', { cause: err });
  }
}

/**
 * Ensure a directory exists, creating it recursively if necessary.
 *
 * @param path Directory path.
 */
export async function ensureDir(path: string): Promise<void> {
  try {
    await mkdir(path, { recursive: true });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    throw new AdabError(`Failed to create directory "${redactPath(path)}": ${e.message}`, 'FS_MKDIR_ERROR', { cause: err });
  }
}

/**
 * Check whether a file or directory exists.
 *
 * Returns `false` only when the path is truly missing ({@code ENOENT}).
 * Permission-denied errors ({@code EACCES}, {@code EPERM}) and any other
 * I/O error are wrapped in an {@link AdabError} and thrown so callers can
 * distinguish "file does not exist" from "file exists but cannot be read".
 *
 * Implementation note: this uses `fs.access`, which is portable and
 * matches POSIX semantics.  On network filesystems (NFS, SMB) the
 * result can be slightly stale — a path that returns `false` may have
 * just been created on another node.  Callers that need a strict
 * check (e.g. locking) should layer a stronger primitive on top.
 *
 * @param path Path to check.
 * @returns `true` if the path exists, `false` when missing.
 * @throws {AdabError} On permission-denied or other I/O errors.
 */
export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      return false;
    }
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      throw new AdabError(`Permission denied accessing "${redactPath(path)}": ${e.message}`, 'FS_ACCESS_ERROR', { cause: err });
    }
    throw new AdabError(`Failed to access "${redactPath(path)}": ${e.message}`, 'FS_ACCESS_ERROR', { cause: err });
  }
}
