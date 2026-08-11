/**
 * Archive Engine — moves a completed (synced) change directory to the
 * archive, copies the final revision to the manuscript, updates the manifest,
 * and appends a log entry.
 */
import { randomUUID } from 'node:crypto';
import { copyFile, rename, mkdir, readdir, unlink, rmdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

import glob from 'fast-glob';
import YAML from 'yaml';

import { ChangeManifestSchema } from '../../schemas/change-manifest.js';
import type { ChangeManifest, LogEntry } from '../../schemas/types.js';
import { AdabError, ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, fileExists } from '../../utils/fs.js';
import { assertChangeDirSafe } from '../../utils/path.js';
import { LogWriter } from '../log/index.js';
import type { SchemaLoader } from '../schema-engine/index.js';

/**
 * Structured report returned after an archive operation.
 */
export interface ArchiveReport {
  /** The archived change identifier. */
  changeId: string;
  /** Path to the copied manuscript chapter (if any). */
  manuscriptPath: string | null;
  /** Path to the archived change directory. */
  archivePath: string;
  /** Whether a backup was created. */
  backupCreated: boolean;
  /** The log entry that was appended. */
  logEntry: LogEntry;
  /**
   * Non-fatal warnings collected during the operation.
   *
   * The archive itself still succeeds when warnings are present, but callers
   * should surface them to the user. Always defined; empty when the operation
   * completed cleanly.
   */
  warnings: string[];
}

/**
 * Archives a completed change by copying its revision to the manuscript and
 * moving the change directory to the archive.
 */
export class ArchiveEngine {
  private readonly projectRoot: string;
  private readonly schemaLoader?: SchemaLoader;

  /**
   * @param projectRoot   Absolute path to the project root.
   * @param schemaLoader  Optional schema loader for deriving revision artifact filename.
   */
  constructor(projectRoot: string, schemaLoader?: SchemaLoader) {
    this.projectRoot = projectRoot;
    this.schemaLoader = schemaLoader;
  }

  /**
   * Archive a change directory.
   *
   * Steps:
   * 1. Verify the change directory name does not escape the project boundary.
   * 2. Verify the change manifest status is "synced" or "archived" (only synced is allowed).
   * 3. Resolve the chapter identifier (manifest `chapter` when set, else
   *    inferred from the directory name) and copy the revision artifact to
   *    `manuscript/chapters/<chapter>.md`.
   * 4. Move `adab/changes/<change>/` to `adab/changes/archive/<change>/`.
   * 5. Update the archived manifest status to "archived".
   * 6. Append an archive log entry; log write failures are non-fatal.
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @param force     If `true`, rename an existing archive target to
   *                  `*.bak-{ts}-{uuid}` and proceed; otherwise an existing
   *                  target throws `ARCHIVE_DUPLICATE`.
   * @returns Structured archive report.
   * @throws {AdabError} If the change is not synced, not found, the path
   *                     escapes the project boundary, or IO fails.
   */
  async archive(changeDir: string, force = false): Promise<ArchiveReport> {
    assertChangeDirSafe(this.projectRoot, changeDir);
    const warnings: string[] = [];

    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const manifestPath = join(changePath, '.openadab.yaml');

    if (!(await fileExists(manifestPath))) {
      throw new AdabError(`Change ${changeDir} not found`, 'ARCHIVE_CHANGE_NOT_FOUND');
    }

    const manifest = await this.loadManifest(manifestPath);
    if (manifest.status === 'archived') {
      throw new AdabError(
        `Change ${changeDir} is already archived.`,
        'ARCHIVE_ALREADY_ARCHIVED',
      );
    }
    if (manifest.status !== 'synced') {
      throw new AdabError(
        `Change ${changeDir} is not synced. Run \`openadab sync --change ${changeDir}\` first.`,
        'ARCHIVE_NOT_SYNCED',
      );
    }

    // AE-12: prefer the manifest's explicit `chapter` field (set via
    // ManifestManager.createManifest, which callers can override) over the
    // directory-derived inference; the directory name may disagree with the
    // manifest (e.g. a change dir of `draft-ch-012` targeting `ch-999`).
    const manifestChapter = manifest.chapter?.trim() ?? '';
    const chapterId = manifestChapter !== '' ? manifestChapter : this.inferChapterId(changeDir);
    if (chapterId === null) {
      throw new AdabError(
        `Could not infer chapter ID from change directory: ${changeDir}. Expected pattern: ch-NNN.`,
        'ARCHIVE_INVALID_CHAPTER_ID',
      );
    }
    const conflicting = await this.findConflictingChange(changeDir, chapterId);
    if (conflicting !== null) {
      if (!force) {
        throw new AdabError(
          `Change ${conflicting} also targets ${chapterId} and is not yet archived. ` +
          `Archiving will overwrite its manuscript target. Use --force to proceed.`,
          'ARCHIVE_CONFLICT',
        );
      }
    }
    const manuscriptDir = join(this.projectRoot, 'adab', 'manuscript', 'chapters');
    await mkdir(manuscriptDir, { recursive: true });
    const manuscriptPath = join(manuscriptDir, `${chapterId}.md`);

    const revisionFileName = await this.resolveRevisionFilename(manifest);
    const revisionPath = join(changePath, revisionFileName);
    let backupCreated = false;
    let manuscriptCreated = false;
    if (await fileExists(revisionPath)) {
      if (await fileExists(manuscriptPath)) {
        warnings.push(`Overwriting existing ${manuscriptPath}`);
        const config = await this.loadProjectConfig();
        if (config.archive?.backupOnOverwrite === true) {
          const backupPath = `${manuscriptPath}.bak.${String(Date.now())}-${randomUUID()}`;
          await copyFile(manuscriptPath, backupPath);
          backupCreated = true;
        }
      }
      await copyFile(revisionPath, manuscriptPath);
      manuscriptCreated = true;
    } else {
      warnings.push(`Revision artifact not found: ${revisionPath}`);
    }

    // Mark the manifest archived BEFORE moving the directory. Every
    // failure-prone step after this point (backup drain and rename) lives
    // inside the same try/catch below so any failure reverts the status
    // back to `synced`: a change left in `changes/` with status `archived`
    // would be permanently stuck (every retry throws
    // ARCHIVE_ALREADY_ARCHIVED).
    manifest.status = 'archived';
    await this.writeManifest(manifestPath, manifest);

    const archiveDir = join(this.projectRoot, 'adab', 'changes', 'archive');
    await mkdir(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, changeDir);

    try {
      // AE-1: If an existing archive target is present, move it aside to a
      // timestamped backup location so the rename can proceed cleanly.  When
      // force is false the existence check still throws below.
      if (await fileExists(archivePath)) {
        if (!force) {
          throw new AdabError(
            `Archive target already exists: ${archivePath}. Remove it manually or use a different change ID.`,
            'ARCHIVE_DUPLICATE',
          );
        }
        const backupArchivePath = `${archivePath}.bak-${String(Date.now())}-${randomUUID()}`;
        await this.moveDirContents(archivePath, backupArchivePath);
      }
      await rename(changePath, archivePath);
    } catch (err) {
      // Revert manifest status since the drain or rename failed — the
      // directory stays in changes/ and must remain retryable.
      manifest.status = 'synced';
      await this.writeManifest(manifestPath, manifest);
      // Errors the engine already classified (ARCHIVE_DUPLICATE from the
      // force=false existence check, ARCHIVE_RENAME_FAILED from the drain)
      // are re-thrown as-is after the revert.
      if (err instanceof AdabError) {
        throw err;
      }
      // TOCTOU guard: if the archive directory appeared between our
      // fileExists check and rename, it's a duplicate.
      if (err instanceof Error && 'code' in err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === 'ENOTEMPTY' || code === 'EEXIST') {
          throw new AdabError(
            `Archive target already exists: ${archivePath}. ` +
            `This may have been created concurrently. Use --force to overwrite.`,
            'ARCHIVE_DUPLICATE',
            { cause: err },
          );
        }
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdabError(`Failed to move change directory to archive: ${msg}`, 'ARCHIVE_RENAME_FAILED', { cause: err });
    }

    const logEntry: LogEntry = {
      ts: new Date().toISOString(),
      op: 'archive',
      change: changeDir,
      result: 'success',
      details: {
        chapter: chapterId,
        manuscriptPath,
        archivePath,
        backupCreated,
      },
    };
    try {
      await this.appendLog(logEntry);
    } catch (err) {
      // AE-2: log write failures must NOT abort the archive. The change has
      // already been moved and the manuscript written; the only thing lost is
      // the audit-trail line, which we surface as a warning.
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`Failed to append archive log entry: ${msg}`);
    }

    return {
      changeId: changeDir,
      manuscriptPath: manuscriptCreated ? manuscriptPath : null,
      archivePath,
      backupCreated,
      logEntry,
      warnings,
    };
  }

  /**
   * Load and parse a change manifest.
   */
  private async loadManifest(path: string): Promise<ChangeManifest> {
    const raw = await safeReadFile(path);
    if (raw === null) {
      throw new AdabError(`Manifest not found: ${path}`, 'ARCHIVE_MANIFEST_MISSING');
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdabError(`Failed to parse manifest: ${msg}`, 'ARCHIVE_MANIFEST_INVALID', { cause: err });
    }
    const result = ChangeManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Manifest validation failed: ${issues}`);
    }
    return result.data;
  }

  /**
   * Write a manifest back to disk.
   */
  private async writeManifest(path: string, manifest: ChangeManifest): Promise<void> {
    await atomicWriteFile(path, YAML.stringify(manifest, { indent: 2, lineWidth: 0 }));
  }

  /**
   * Load project config to check archive settings.
   *
   * @throws {AdabError} with code `CONFIG_INVALID` if `config.yaml` exists
   *                     but cannot be parsed. A missing file is treated as
   *                     default (no archive overrides).
   */
  private async loadProjectConfig(): Promise<{ archive?: { backupOnOverwrite?: boolean } }> {
    const configPath = join(this.projectRoot, 'adab', 'config.yaml');
    const raw = await safeReadFile(configPath);
    if (raw === null) {return {};}
    try {
      return YAML.parse(raw) as { archive?: { backupOnOverwrite?: boolean } };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdabError(`Failed to parse project config: ${msg}`, 'CONFIG_INVALID', { cause: err });
    }
  }


  /**
   * Infer the chapter identifier from the change directory name.
   *
   * Looks for the `ch-NNN` segment (e.g. `draft-ch-012` → `ch-012`) and
   * returns the full slug including the `ch-` prefix, preserving any
   * leading zeros. The match is case-insensitive so `DRAFT-CH-012` and
   * `Draft-Ch-012` are normalised to the same chapter identifier.
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @returns Full chapter slug in the form `ch-NNN` (preserves leading
   *          zeros), or `null` if no `ch-NNN` segment is found.
   */
  private inferChapterId(changeDir: string): string | null {
    const match = /ch-(\d+)/i.exec(changeDir);
    if (!match) {return null;}
    return `ch-${match[1]}`;
  }

  /**
   * Resolve the revision artifact filename from the manifest's schema.
   *
   * Uses the schema's apply section (typically the last artifact in the
   * dependency chain) to determine which file to copy to manuscript.
   * Falls back to `revision.md` when schema is unavailable.
   *
   * @param manifest The change manifest.
   * @returns The filename of the revision artifact.
   */
  private async resolveRevisionFilename(manifest: ChangeManifest): Promise<string> {
    if (this.schemaLoader) {
      try {
        const schema = await this.schemaLoader.load();
        if (schema.apply?.requires && schema.apply.requires.length > 0) {
          const lastRequiredId = schema.apply.requires[schema.apply.requires.length - 1];
          const lastArt = schema.artifacts.find((a) => a.id === lastRequiredId);
          if (lastArt) {
            return lastArt.generates;
          }
        }
      } catch (err) {
        console.warn('[ArchiveEngine] Failed to load schema for revision resolution:', err instanceof Error ? err.message : String(err));
      }
    }
    return 'revision.md';
  }

  /**
   * Scan `adab/changes/` for another in-progress change targeting the same chapter.
   *
   * The `archive/` subdirectory is intentionally excluded by the glob
   * pattern `star-slash-.openadab.yaml` (only matches direct children of
   * `changes/`, not `changes/archive/`).  Comparison of directory names is
   * case-insensitive so that `DRAFT-CH-012` and `draft-ch-012` are treated
   * as the same change for self-exclusion purposes.
   *
   * @param currentChange The change being archived (excluded from scan).
   * @param chapterId     The inferred chapter identifier.
   * @returns The conflicting change directory name, or `null` if none.
   */
  private async findConflictingChange(currentChange: string, chapterId: string | null): Promise<string | null> {
    if (!chapterId) {return null;}
    const changesDir = join(this.projectRoot, 'adab', 'changes');
    const manifestPaths = await glob('*/.openadab.yaml', {
      cwd: changesDir,
      onlyFiles: true,
      absolute: true,
    });

    const normalizedCurrent = currentChange.toLowerCase();
    for (const path of manifestPaths) {
      const dirName = basename(dirname(path));
      if (dirName.toLowerCase() === normalizedCurrent) {continue;}
      const otherChapter = this.inferChapterId(dirName);
      if (otherChapter !== chapterId) {continue;}

      try {
        const raw = await safeReadFile(path);
        if (raw === null) {continue;}
        const other = YAML.parse(raw) as ChangeManifest;
        if (other.status === 'in_progress' || other.status === 'synced') {
          return dirName;
        }
      } catch (err) {
        console.warn('[ArchiveEngine] Skipped unreadable manifest during conflict scan:', err instanceof Error ? err.message : String(err));
      }
    }
    return null;
  }

  /**
   * Move every entry inside `srcDir` into `destDir`, then remove the now
   * empty source directory.  Used to relocate an existing archive target
   * before the change directory is renamed into its place.
   *
   * @param srcDir  Source directory to drain.
   * @param destDir Destination directory to receive the entries.
   */
  private async moveDirContents(srcDir: string, destDir: string): Promise<void> {
    await mkdir(destDir, { recursive: true });
    const entries = await readdir(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const from = join(srcDir, entry.name);
      const to = join(destDir, entry.name);
      if (entry.isDirectory()) {
        await this.moveDirContents(from, to);
        continue;
      }
      if (entry.isSymbolicLink()) {
        // Best-effort: unlink and re-create; symlinks are rare in change dirs.
        try { await unlink(from); } catch { /* ignore */ }
        continue;
      }
      await rename(from, to);
    }
    // The source directory should be empty now; remove it.
    try {
      await rmdir(srcDir);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'ENOENT') {
        // Surface non-empty leftovers as a warning via the error chain.
        throw new AdabError(
          `Failed to remove original archive target ${srcDir} after backup: ${err instanceof Error ? err.message : String(err)}`,
          'ARCHIVE_RENAME_FAILED',
          { cause: err },
        );
      }
    }
  }

  /**
   * Append a log entry to `adab/log.md`.
   */
  private async appendLog(entry: LogEntry): Promise<void> {
    const writer = new LogWriter(this.projectRoot);
    await writer.append(entry);
  }
}
