/**
 * Sync Engine — orchestrates the full change synchronization workflow:
 * validation, wiki-diff application, index regeneration, logging, and
 * manifest updates.
 */
import { join } from 'node:path';

import YAML from 'yaml';

import type { ChangeManifest, LogEntry } from '../../schemas/types.js';
import type { SchemaDef } from '../../schemas/schema-def.js';
import { ChangeManifestSchema } from '../../schemas/change-manifest.js';
import { AdabError, ConfigValidationError, WikiDiffParseError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, fileExists } from '../../utils/fs.js';
import type { ContextPacker } from '../context-packer/index.js';
import { LogWriter } from '../log/index.js';
import type { MechanicalValidator } from '../mechanical-validator/index.js';
import type { MentionIndexer } from '../mention-indexer/index.js';
import type { ProgressionTracker } from '../progression-tracker/index.js';
import type { WikiDiffParser, WikiDiffApplier } from '../wiki-diff-engine/index.js';
import type { WikiEngine } from '../wiki-engine/index.js';

/**
 * Structured error code classification for validation results.
 *
 * Replaces ad-hoc string matching (e.g. `error.startsWith('File missing:')`)
 * with a finite, machine-checkable taxonomy. The {@link SyncEngine} consults
 * this when deciding whether a missing artifact is a fatal validation error
 * or a tolerated, optional-artifact gap.
 */
export type ValidationErrorCode =
  | 'FILE_MISSING'
  | 'FRONTMATTER_MISSING'
  | 'REQUIRED_FIELD_MISSING'
  | 'WORD_COUNT'
  | 'BROKEN_WIKI_LINK'
  | 'FILE_EMPTY'
  | 'DEPENDENCY_VIOLATION'
  | 'UNKNOWN';

/**
 * Classify a single validation error string into a {@link ValidationErrorCode}.
 *
 * Centralizes the "what does this error mean" logic so call sites do not
 * have to maintain parallel regex collections. New error formats should
 * extend this classifier and the {@link ValidationErrorCode} union.
 *
 * @param error Raw validation error string.
 * @returns The corresponding {@link ValidationErrorCode}.
 */
export function classifyValidationError(error: string): ValidationErrorCode {
  if (/^File missing:/.test(error)) {return 'FILE_MISSING';}
  if (/^File is empty:/.test(error)) {return 'FILE_EMPTY';}
  if (/^Frontmatter missing/.test(error)) {return 'FRONTMATTER_MISSING';}
  if (/^Required frontmatter field/.test(error)) {return 'REQUIRED_FIELD_MISSING';}
  if (/^Word count /.test(error)) {return 'WORD_COUNT';}
  if (/^Broken wiki link:/.test(error)) {return 'BROKEN_WIKI_LINK';}
  if (/"' which is not present in the change manifest/.test(error)) {return 'DEPENDENCY_VIOLATION';}
  return 'UNKNOWN';
}

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
 * Hardcoded fallback list of artifact IDs considered optional in
 * chapter-draft-style workflows when no schema loader is supplied.
 *
 * Used as a back-compat shim: legacy callers that construct
 * {@link SyncEngine} without a `schemaLoader` still get the historic
 * behavior of treating these IDs as non-fatal when missing. New code
 * should pass a `schemaLoader` and mark `required: false` in the schema
 * instead.
 */
const LEGACY_OPTIONAL_ARTIFACTS = ['wiki-diff', 'brief', 'scene-plan'] as const;

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
  private readonly schemaLoader: { load: () => Promise<SchemaDef> } | undefined;

  /**
   * @param projectRoot        Absolute path to the project root.
   * @param wikiDiffParser     Wiki diff parser instance.
   * @param wikiDiffApplier    Wiki diff applier instance.
   * @param wikiEngine         Wiki engine instance.
   * @param mentionIndexer     Mention indexer instance.
   * @param progressionTracker Progression tracker instance.
   * @param contextPacker      Context packer instance.
   * @param validator          Mechanical validator instance.
   * @param schemaLoader       Optional schema loader; when present the engine
   *                           derives the optional-artifact set from
   *                           `artifact.required === false` rather than the
   *                           hardcoded legacy list.
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
    schemaLoader?: { load: () => Promise<SchemaDef> },
  ) {
    this.projectRoot = projectRoot;
    this.wikiDiffParser = wikiDiffParser;
    this.wikiDiffApplier = wikiDiffApplier;
    this.wikiEngine = wikiEngine;
    this.mentionIndexer = mentionIndexer;
    this.progressionTracker = progressionTracker;
    this.contextPacker = contextPacker;
    this.validator = validator;
    this.schemaLoader = schemaLoader;
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
   * Failure semantics:
   * - Pre-sync validation failure throws {@link AdabError} `SYNC_VALIDATION_FAILED`.
   * - Wiki-diff parse failure throws {@link WikiDiffParseError} with `cause`.
   * - Any index step failure is collected; if at least one fails, the engine
   *   throws {@link AdabError} `SYNC_INDEX_FAILED` and the manifest status
   *   is preserved as `in_progress` (no rollback of wiki-diff).
   * - When `--full` is set, all five index steps are forced to a full rebuild;
   *   otherwise mentions use incremental indexing.
   *
   * @param changeDir Change directory name (e.g. `draft-ch-012`).
   * @param full      When `true`, force full rebuild for all indexes.
   * @returns Structured sync report.
   * @throws {AdabError} If validation fails or a required step errors.
   * @throws {WikiDiffParseError} If `wiki-diff.md` is malformed.
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

    const optionalArtifactIds = await this.resolveOptionalArtifactIds();
    const validationErrors = await this.runPreSyncValidation(changePath, manifest, optionalArtifactIds);
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
      let doc;
      try {
        doc = await this.wikiDiffParser.parse(diffRaw);
      } catch (err) {
        const cause = err instanceof Error ? err : new Error(String(err));
        throw new WikiDiffParseError(
          `Failed to parse wiki-diff.md for ${changeDir}: ${cause.message}`,
          { cause: err },
        );
      }
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
      { label: 'adab/index/mentions.json', fn: full ? () => this.mentionIndexer.indexAll() : () => this.mentionIndexer.incrementalIndex() },
      { label: 'adab/index/wikilinks.json', fn: full ? () => this.wikiEngine.generateWikilinks() : () => this.wikiEngine.generateWikilinks() },
      { label: 'adab/index/progressions.json', fn: full ? () => this.progressionTracker.generateProgressionsJson() : () => this.progressionTracker.generateProgressionsJson() },
      { label: 'adab/index/context-map.json', fn: full ? () => this.mentionIndexer.generateContextMap() : () => this.mentionIndexer.generateContextMap() },
      { label: 'adab/wiki/index.md', fn: full ? () => this.wikiEngine.generateIndex() : () => this.wikiEngine.generateIndex() },
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

    const logEntry = this.buildLogEntry(changeDir, wikiPagesModified, contradictionsFlagged, indexesRegenerated, indexErrors);

    if (lastIndexError !== null) {
      // Append a partial-success log so the audit trail reflects what happened.
      await this.appendLog(logEntry);
      // Manifest status preserved as in_progress so a retry can pick up where we left off.
      const detail = `Regenerated indexes: ${indexesRegenerated.join(', ') || 'none'}. ` +
        `Failed: ${indexErrors.join('; ')}. ` +
        `Run \`openadab wiki index\` manually to regenerate missing indexes.`;
      throw new AdabError(
        `Index regeneration partially failed after wiki-diff was applied.\n${detail}`,
        'SYNC_INDEX_FAILED',
        { cause: lastIndexError },
      );
    }

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
   * Derive the set of artifact IDs that should be treated as non-fatal when
   * missing. When a `schemaLoader` is configured the set is driven by
   * `artifact.required === false`; otherwise the legacy hardcoded list
   * (`wiki-diff`, `brief`, `scene-plan`) is used.
   *
   * @returns A `Set` of optional artifact IDs.
   */
  private async resolveOptionalArtifactIds(): Promise<Set<string>> {
    if (this.schemaLoader) {
      try {
        const schema = await this.schemaLoader.load();
        const ids = new Set<string>();
        for (const art of schema.artifacts) {
          if (art.required === false) {
            ids.add(art.id);
          }
        }
        return ids;
      } catch (err) {
        console.warn('[SyncEngine] Failed to load schema for optional-artifact resolution; falling back to hardcoded list:', err instanceof Error ? err.message : String(err));
      }
    }
    return new Set<string>(LEGACY_OPTIONAL_ARTIFACTS);
  }

  /**
   * Run mechanical validation on all artifacts in the change directory.
   *
   * Checks that required artifact files exist and have non-empty content.
   * Missing optional artifacts are skipped (logged as a warning) rather
   * than treated as errors; any other validation error is fatal.
   *
   * @param changePath            Absolute path to the change directory.
   * @param manifest              Parsed change manifest.
   * @param optionalArtifactIds   Set of artifact IDs that may be absent
   *                              without blocking sync. When a missing
   *                              artifact is in this set AND its only
   *                              errors are `FILE_MISSING` codes, the
   *                              artifact is skipped.
   * @returns Array of validation error messages (empty if all pass).
   */
  private async runPreSyncValidation(changePath: string, manifest: ChangeManifest, optionalArtifactIds: Set<string>): Promise<string[]> {
    const errors: string[] = [];
    const validationResults = await this.validator.validateChange(changePath);
    for (const result of validationResults) {
      if (!result.passed) {
        const isOptionalMissing = optionalArtifactIds.has(result.artifactId) &&
          result.errors.length > 0 &&
          result.errors.every((e) => classifyValidationError(e) === 'FILE_MISSING');
        if (isOptionalMissing) {
          console.warn(`[SyncEngine] Optional artifact "${result.artifactId}" is missing — proceeding without it.`);
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
   *
   * The `result` field records the overall outcome: `success` when all
   * indexes regenerated, `partial` when at least one index step failed.
   * Index errors are included in the details so the log audit trail
   * captures the full state of every sync attempt.
   *
   * @param changeId             The change being synced.
   * @param wikiPagesModified    Wiki pages touched by the wiki-diff.
   * @param contradictionsFlagged  Count of newly flagged contradictions.
   * @param indexesRegenerated   Labels of indexes that regenerated successfully.
   * @param indexErrors          Labels + messages of indexes that failed.
   * @returns A {@link LogEntry} suitable for `LogWriter.append`.
   */
  private buildLogEntry(
    changeId: string,
    wikiPagesModified: string[],
    contradictionsFlagged: number,
    indexesRegenerated: string[],
    indexErrors: string[],
  ): LogEntry {
    return {
      ts: new Date().toISOString(),
      op: 'sync',
      change: changeId,
      result: indexErrors.length === 0 ? 'success' : 'partial',
      details: {
        wikiPagesModified,
        contradictionsFlagged,
        indexesRegenerated,
        indexErrors,
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
