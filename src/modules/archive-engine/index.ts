/**
 * Archive Engine — moves a completed (synced) change directory to the
 * archive, copies the final revision to the manuscript, updates the manifest,
 * and appends a log entry.
 */
import { copyFile, rename, mkdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

import YAML from 'yaml';

import type { ChangeManifest, LogEntry } from '../../schemas/types.js';
import { ChangeManifestSchema } from '../../schemas/change-manifest.js';
import { AdabError, ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, fileExists } from '../../utils/fs.js';
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
   * 1. Verify the change manifest status is "synced".
   * 2. Copy the revision artifact to `manuscript/chapters/ch-XXX.md`.
   * 3. Move `adab/changes/<change>/` to `adab/changes/archive/<change>/`.
   * 4. Update the archived manifest status to "archived".
   * 5. Append an archive log entry.
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @returns Structured archive report.
   * @throws {AdabError} If the change is not synced, not found, or IO fails.
   */
  async archive(changeDir: string, force = false): Promise<ArchiveReport> {
    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const manifestPath = join(changePath, '.openadab.yaml');

    if (!(await fileExists(manifestPath))) {
      throw new AdabError(`Change ${changeDir} not found`, 'ARCHIVE_CHANGE_NOT_FOUND');
    }

    const manifest = await this.loadManifest(manifestPath);
    if (manifest.status !== 'synced') {
      throw new AdabError(
        `Change ${changeDir} is not synced. Run \`openadab sync --change ${changeDir}\` first.`,
        'ARCHIVE_NOT_SYNCED',
      );
    }

    const chapterId = this.inferChapterId(changeDir);
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
    if (await fileExists(revisionPath)) {
      if (await fileExists(manuscriptPath)) {
        console.warn(`Overwriting existing ${manuscriptPath}`);
        const config = await this.loadProjectConfig();
        if (config.archive?.backupOnOverwrite === true) {
          const backupPath = `${manuscriptPath}.bak.${String(Date.now())}`;
          await copyFile(manuscriptPath, backupPath);
          backupCreated = true;
        }
      }
      await copyFile(revisionPath, manuscriptPath);
    } else {
      console.warn(`Revision artifact not found: ${revisionPath}`);
    }

    // Write the archived manifest BEFORE moving the directory, so that
    // if rename fails after manifest write, the archive directory is in a
    // consistent state (manifest reflects archived status, directory still
    // in changes/ — will be picked up on retry).
    manifest.status = 'archived';
    await this.writeManifest(manifestPath, manifest);

    const archiveDir = join(this.projectRoot, 'adab', 'changes', 'archive');
    await mkdir(archiveDir, { recursive: true });
    const archivePath = join(archiveDir, changeDir);

    // Move AFTER manifest is written.  If rename fails the manifest in the
    // original location still says 'archived', which is safe: a subsequent
    // archive attempt will fail the status check and instruct the user.
    if (await fileExists(archivePath)) {
      if (!force) {
        throw new AdabError(
          `Archive target already exists: ${archivePath}. Remove it manually or use a different change ID.`,
          'ARCHIVE_DUPLICATE'
        );
      }
    }
    try {
      await rename(changePath, archivePath);
    } catch (err) {
      // Revert manifest status since rename failed — directory stays in changes/
      manifest.status = 'synced';
      await this.writeManifest(manifestPath, manifest);
      // TOCTOU guard: if the archive directory appeared between our
      // fileExists check (L121) and rename (L130), it's a duplicate.
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
    await this.appendLog(logEntry);

    return {
      changeId: changeDir,
      manuscriptPath: await fileExists(manuscriptPath) ? manuscriptPath : null,
      archivePath,
      backupCreated,
      logEntry,
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
   */
  private async loadProjectConfig(): Promise<{ archive?: { backupOnOverwrite?: boolean } }> {
    const configPath = join(this.projectRoot, 'adab', 'config.yaml');
    const raw = await safeReadFile(configPath);
    if (raw === null) {return {};}
    try {
      return YAML.parse(raw) as { archive?: { backupOnOverwrite?: boolean } };
    } catch (err) {
      console.warn('[ArchiveEngine] Failed to parse config YAML for archive settings:', err instanceof Error ? err.message : String(err));
      return {};
    }
  }

  /**
   * Infer the chapter identifier from the change directory name.
   *
   * Looks for the `ch-NNN` segment (e.g. `draft-ch-012` → `ch-012`) and returns
   * the full slug including the `ch-` prefix, preserving any leading zeros.
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @returns Full chapter slug in the form `ch-NNN` (preserves leading zeros),
   *   or `null` if no `ch-NNN` segment is found.
   */
  private inferChapterId(changeDir: string): string | null {
    const match = /ch-(\d+)/i.exec(changeDir);
    return match ? `ch-${match[1]}` : null;
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
   * @param currentChange The change being archived (excluded from scan).
   * @param chapterId     The inferred chapter identifier.
   * @returns The conflicting change directory name, or `null` if none.
   */
  private async findConflictingChange(currentChange: string, chapterId: string | null): Promise<string | null> {
    if (!chapterId) {return null;}
    const changesDir = join(this.projectRoot, 'adab', 'changes');
    const { glob } = await import('fast-glob');
    const manifestPaths = await glob('*/.openadab.yaml', {
      cwd: changesDir,
      onlyFiles: true,
      absolute: true,
    });

    for (const path of manifestPaths) {
      const dirName = basename(dirname(path));
      if (dirName === currentChange) {continue;}
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
   * Append a log entry to `adab/log.md`.
   */
  private async appendLog(entry: LogEntry): Promise<void> {
    const writer = new LogWriter(this.projectRoot);
    await writer.append(entry);
  }
}
