/**
 * Sync Engine — orchestrates the full change synchronization workflow:
 * validation, wiki-diff application, index regeneration, logging, and
 * manifest updates.
 */
import { join } from 'node:path';

import YAML from 'yaml';

import type { ChangeManifest, LogEntry } from '../../schemas/types.js';
import { ChangeManifestSchema } from '../../schemas/change-manifest.js';
import { AdabError, ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, fileExists } from '../../utils/fs.js';
import type { ContextPacker } from '../context-packer/index.js';
import { LogWriter } from '../log/index.js';
import type { MechanicalValidator } from '../mechanical-validator/index.js';
import type { MentionIndexer } from '../mention-indexer/index.js';
import type { ProgressionTracker } from '../progression-tracker/index.js';
import type { WikiDiffParser, WikiDiffApplier } from '../wiki-diff-engine/index.js';
import type { WikiEngine } from '../wiki-engine/index.js';

/**
 * Structured report returned after a sync operation.
 */
export interface SyncReport {
  /** The synced change identifier. */
  changeId: string;
  /** List of wiki pages modified by wiki-diff application. */
  wikiPagesModified: string[];
  /** Number of new contradictions flagged. */
  contradictionsFlagged: number;
  /** List of regenerated index files. */
  indexesRegenerated: string[];
  /** Index regeneration errors (if any); wiki-diff changes are kept. */
  indexErrors: string[];
  /** The log entry that was appended. */
  logEntry: LogEntry;
}

/**
 * Orchestrates full change synchronization.
 */
export class SyncEngine {
  private readonly projectRoot: string;
  private readonly wikiDiffParser: WikiDiffParser;
  private readonly wikiDiffApplier: WikiDiffApplier;
  private readonly wikiEngine: WikiEngine;
  private readonly mentionIndexer: MentionIndexer;
  private readonly progressionTracker: ProgressionTracker;
  private readonly contextPacker: ContextPacker;
  private readonly validator: MechanicalValidator;

  /**
   * @param projectRoot        Absolute path to the project root.
   * @param wikiDiffParser     Wiki diff parser instance.
   * @param wikiDiffApplier    Wiki diff applier instance.
   * @param wikiEngine         Wiki engine instance.
   * @param mentionIndexer     Mention indexer instance.
   * @param progressionTracker Progression tracker instance.
   * @param contextPacker      Context packer instance.
   * @param validator          Mechanical validator instance.
   */
  constructor(
    projectRoot: string,
    wikiDiffParser: WikiDiffParser,
    wikiDiffApplier: WikiDiffApplier,
    wikiEngine: WikiEngine,
    mentionIndexer: MentionIndexer,
    progressionTracker: ProgressionTracker,
    contextPacker: ContextPacker,
    validator: MechanicalValidator,
  ) {
    this.projectRoot = projectRoot;
    this.wikiDiffParser = wikiDiffParser;
    this.wikiDiffApplier = wikiDiffApplier;
    this.wikiEngine = wikiEngine;
    this.mentionIndexer = mentionIndexer;
    this.progressionTracker = progressionTracker;
    this.contextPacker = contextPacker;
    this.validator = validator;
  }

  /**
   * Run the full sync workflow for a change directory.
   *
   * Steps:
   * 1. Pre-sync mechanical validation (abort on errors).
   * 2. Parse and apply wiki-diff (skip if empty / missing).
   * 3. Regenerate mentions, wikilinks, progressions, context-map.
   * 4. Update wiki index.
   * 5. Append structured log entry.
   * 6. Update change manifest status to "synced".
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @returns Structured sync report.
   * @throws {AdabError} If validation fails or a required step errors.
   */
  async sync(changeDir: string, full = false): Promise<SyncReport> {
    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const manifestPath = join(changePath, '.openadab.yaml');

    const manifest = await this.loadManifest(manifestPath);

    // Guard: only sync changes that are in_progress.
    if (manifest.status !== 'in_progress') {
      throw new AdabError(
        `Change ${changeDir} is already ${manifest.status}. Only in_progress changes can be synced.`,
        'SYNC_INVALID_STATUS',
      );
    }

    const validationErrors = await this.runPreSyncValidation(changePath, manifest);
    if (validationErrors.length > 0) {
      throw new AdabError(
        `Pre-sync validation failed for ${changeDir}:\n${validationErrors.join('\n')}`,
        'SYNC_VALIDATION_FAILED',
      );
    }

    let wikiPagesModified: string[] = [];
    let contradictionsFlagged = 0;

    const diffPath = join(changePath, 'wiki-diff.md');
    const diffRaw = await safeReadFile(diffPath);
    if (diffRaw !== null) {
      const doc = await this.wikiDiffParser.parse(diffRaw);
      if (doc.operations.length > 0) {
        const applyResult = await this.wikiDiffApplier.apply(doc, false);
        if (!applyResult.success) {
          throw new AdabError(
            `Wiki-diff application failed for ${changeDir}: ${applyResult.summary}`,
            'SYNC_WIKIDIFF_FAILED',
          );
        }
        wikiPagesModified = Array.from(new Set(doc.operations.filter((o) => o.type !== 'flag_contradiction').map((o) => o.target)));
        contradictionsFlagged = doc.operations.filter((o) => o.type === 'flag_contradiction').length;
      }
    }

    // Run each index step in its own try-block so partial failures don't block
    // subsequent steps. Wiki-diff has already been applied at this point (per spec:
    // wiki-diff changes are kept on index failure, user should run `wiki index` manually).
    let lastIndexError: unknown = null;
    let lastIndexErrorMessage = '';
    const indexesRegenerated: string[] = [];

    const indexSteps: Array<{ label: string; fn: () => Promise<void> }> = [
      { label: 'adab/index/mentions.json', fn: () => full ? this.mentionIndexer.indexAll() : this.mentionIndexer.incrementalIndex() },
      { label: 'adab/index/wikilinks.json', fn: () => this.wikiEngine.generateWikilinks() },
      { label: 'adab/index/progressions.json', fn: () => this.progressionTracker.generateProgressionsJson() },
      { label: 'adab/index/context-map.json', fn: () => this.mentionIndexer.generateContextMap() },
      { label: 'adab/wiki/index.md', fn: () => this.wikiEngine.generateIndex() },
    ];

    const indexErrors: string[] = [];
    for (const step of indexSteps) {
      try {
        await step.fn();
        indexesRegenerated.push(step.label);
      } catch (indexErr) {
        lastIndexError = indexErr;
        lastIndexErrorMessage = indexErr instanceof Error ? indexErr.message : String(indexErr);
        console.warn(`[SyncEngine] Failed to regenerate ${step.label}:`, lastIndexErrorMessage);
        indexErrors.push(`${step.label}: ${lastIndexErrorMessage}`);
        // Continue with remaining steps; don't abort the entire sync.
      }
    }

    if (lastIndexError !== null) {
      console.error(
        `[SyncEngine] Index regeneration partially failed after wiki-diff was applied.\n` +
        `Wiki-diff changes have been kept. Regenerated indexes: ${indexesRegenerated.join(', ') || 'none'}.\n` +
        `Run \`openadab wiki index\` manually to regenerate missing indexes.`,
      );
    }

    const logEntry = this.buildLogEntry(changeDir, wikiPagesModified, contradictionsFlagged, indexesRegenerated);
    await this.appendLog(logEntry);

    manifest.status = 'synced';
    await this.writeManifest(manifestPath, manifest);

    return {
      changeId: changeDir,
      wikiPagesModified,
      contradictionsFlagged,
      indexesRegenerated,
      indexErrors,
      logEntry,
    };
  }

  /**
   * Load and parse the change manifest.
   */
  private async loadManifest(path: string): Promise<ChangeManifest> {
    const raw = await safeReadFile(path);
    if (raw === null) {
      throw new AdabError(`Change manifest not found: ${path}`, 'SYNC_MANIFEST_MISSING');
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new AdabError(`Failed to parse change manifest: ${msg}`, 'SYNC_MANIFEST_INVALID', { cause: err });
    }
    const result = ChangeManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Manifest validation failed: ${issues}`);
    }
    return result.data;
  }

  /**
   * Write the updated change manifest back to disk.
   */
  private async writeManifest(path: string, manifest: ChangeManifest): Promise<void> {
    await atomicWriteFile(path, YAML.stringify(manifest, { indent: 2, lineWidth: 0 }));
  }

  /**
   * Run mechanical validation on all artifacts in the change directory.
   *
   * Checks that required artifact files exist and have non-empty content.
   *
   * @param changePath Absolute path to the change directory.
   * @param manifest   Parsed change manifest.
   * @returns Array of validation error messages (empty if all pass).
   */
  private async runPreSyncValidation(changePath: string, manifest: ChangeManifest): Promise<string[]> {
    const errors: string[] = [];
    const OPTIONAL_ARTIFACTS = ['wiki-diff', 'brief', 'scene-plan'] as const;
    const validationResults = await this.validator.validateChange(changePath);
    for (const result of validationResults) {
      if (!result.passed) {
        const isOptionalMissing = OPTIONAL_ARTIFACTS.includes(result.artifactId as typeof OPTIONAL_ARTIFACTS[number]) &&
          result.errors.some((e) => e.startsWith('File missing:'));
        if (isOptionalMissing) {
          console.warn(`[SyncEngine] wiki/${result.artifactId}.md not found — proceeding without it.`);
        } else {
          errors.push(...result.errors);
        }
      }
    }

    const depResult = await this.validator.validateDependencies(manifest.artifacts);
    if (!depResult.passed) {
      errors.push(...depResult.errors);
    }
    for (const [artifactId, status] of Object.entries(manifest.artifacts)) {
      if (status === 'done') {
        // Delegate to the validator which correctly uses art.generates from the schema
        const nonEmptyResult = await this.validator.requireNonEmpty(changePath, artifactId);
        if (!nonEmptyResult.passed) {
          errors.push(...nonEmptyResult.errors);
        }
      }
    }
    return errors;
  }

  /**
   * Build a structured log entry describing the sync operation.
   */
  private buildLogEntry(
    changeId: string,
    wikiPagesModified: string[],
    contradictionsFlagged: number,
    indexesRegenerated: string[],
  ): LogEntry {
    return {
      ts: new Date().toISOString(),
      op: 'sync',
      change: changeId,
      result: 'success',
      details: {
        wikiPagesModified,
        contradictionsFlagged,
        indexesRegenerated,
      },
    };
  }

  /**
   * Append a log entry to `adab/log.md`.
   */
  private async appendLog(entry: LogEntry): Promise<void> {
    const writer = new LogWriter(this.projectRoot);
    await writer.append(entry);
  }
}
