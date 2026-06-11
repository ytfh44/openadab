/**
 * Change Manifest Management — reads, writes, and updates `.openadab.yaml`
 * change manifests with enforced state transitions.
 */
import { join } from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { ChangeManifestSchema, type ChangeManifest, type ArtifactStatus } from '../../schemas/change-manifest.js';
import type { SchemaDef } from '../../schemas/schema-def.js';
import { ChangeStatusError, ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir } from '../../utils/fs.js';


/**
 * Valid state transitions for the change manifest status field.
 */
const VALID_TRANSITIONS: Record<ChangeManifest['status'], ChangeManifest['status'][]> = {
  in_progress: ['synced'],
  synced: ['archived'],
  archived: [],
};

/**
 * Manages `.openadab.yaml` manifests: creation, reading, validation,
 * artifact-status updates, and top-level status transitions.
 */
export class ManifestManager {
  /**
   * Create a new change manifest for a change directory.
   *
   * Derives the chapter identifier from the change ID (e.g. `draft-ch-012` → `ch-012`).
   * Initializes all artifacts as `blocked` except the first artifact (the one
   * with no dependencies), which is set to `ready`.
   *
   * @param changeId  Unique change identifier (also used as directory name).
   * @param schema    The active schema definition.
   * @param chapter   Optional explicit chapter string; inferred from `changeId` if omitted.
   * @returns The newly created manifest.
   */
  createManifest(changeId: string, schema: SchemaDef, chapter?: string): ChangeManifest {
    const artifactStatuses: Record<string, ArtifactStatus> = {};

    for (const art of schema.artifacts) {
      if (art.requires.length === 0) {
        artifactStatuses[art.id] = 'ready';
      } else {
        artifactStatuses[art.id] = 'blocked';
      }
    }

    const firstReadyId = schema.artifacts.find((a) => a.requires.length === 0)?.id;
    const inferredChapter = chapter ?? this.extractChapter(changeId);

    const manifest: ChangeManifest = {
      changeId,
      schema: schema.name,
      version: schema.version,
      created: new Date().toISOString(),
      status: 'in_progress',
      currentArtifact: firstReadyId,
      artifacts: artifactStatuses,
      chapter: inferredChapter,
      metadata: {},
    };

    return manifest;
  }

  /**
   * Read and validate a `.openadab.yaml` manifest from a change directory.
   *
   * @param changeDir Absolute path to the change directory.
   * @returns Validated manifest object.
   * @throws {ConfigValidationError} If the file is missing, malformed, or invalid.
   */
  async readManifest(changeDir: string): Promise<ChangeManifest> {
    const manifestPath = join(changeDir, '.openadab.yaml');
    const raw = await safeReadFile(manifestPath);
    if (raw === null) {
      throw new ConfigValidationError(`Manifest not found: ${manifestPath}`);
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigValidationError(`Failed to parse manifest YAML: ${msg}`, { cause: err });
    }
    const result = ChangeManifestSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Manifest validation failed: ${issues}`);
    }
    this.warnUnknownFields(parsed as Record<string, unknown>, ChangeManifestSchema, 'manifest');
    return result.data;
  }

  /**
   * Warn about keys present in the raw object that are not defined in the zod schema.
   *
   * @param obj    Raw parsed object.
   * @param schema Zod object schema to inspect.
   * @param prefix Dot-path prefix for nested keys.
   */
  private warnUnknownFields(obj: Record<string, unknown>, schema: z.ZodType<unknown>, prefix = ''): void {
    if (schema instanceof z.ZodObject) {
      const shape = schema.shape as Record<string, z.ZodType<unknown>>;
      for (const key of Object.keys(obj)) {
        if (!(key in shape)) {
          // eslint-disable-next-line no-console
          console.warn(`[ManifestManager] Unknown manifest field: ${prefix ? `${prefix}.` : ''}${key}`);
        } else if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          this.warnUnknownFields(obj[key] as Record<string, unknown>, shape[key], `${prefix ? `${prefix}.` : ''}${key}`);
        }
      }
    }
  }

  /**
   * Update a single artifact's status in the manifest and persist it.
   *
   * Also updates `currentArtifact` to the given artifact ID.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @param status     New status value.
   * @throws {ConfigValidationError} If the manifest cannot be read or written.
   */
  async updateArtifactStatus(changeDir: string, artifactId: string, status: ArtifactStatus, schema?: SchemaDef): Promise<void> {
    const manifest = await this.readManifest(changeDir);

    // Validate artifactId exists in schema if schema is provided
    if (schema && !schema.artifacts.some((a) => a.id === artifactId)) {
      throw new Error(`Artifact '${artifactId}' not found in schema '${schema.name}'. Valid artifacts: ${schema.artifacts.map((a) => a.id).join(', ')}`);
    }

    // Validate artifact status transition
    const prevStatus = manifest.artifacts[artifactId];
    if (status !== prevStatus) {
      if (status === 'done' && prevStatus !== 'ready') {
        throw new ChangeStatusError(
          `Invalid artifact status transition for '${artifactId}': ${prevStatus} → ${status}. Artifact must be 'ready' before it can be set to 'done'.`
        );
      }
      if (status === 'ready' && prevStatus !== 'blocked' && prevStatus !== 'done') {
        throw new ChangeStatusError(
          `Invalid artifact status transition for '${artifactId}': ${prevStatus} → ${status}. Artifact can only transition to 'ready' from 'blocked' or 'done'.`
        );
      }
    }

    manifest.artifacts[artifactId] = status;
    manifest.currentArtifact = artifactId;

    if (schema) {
      for (const [id, currentStatus] of Object.entries(manifest.artifacts)) {
        const newStatus = this.recomputeArtifactStatus(id, currentStatus, manifest, schema);
        if (manifest.artifacts[id] !== newStatus) {
          manifest.artifacts[id] = newStatus;
        }
      }
    }

    await this.writeManifest(changeDir, manifest);
  }

  /**
   * Check whether all dependencies of an artifact are marked `done`.
   *
   * @param artifactId Artifact to check.
   * @param manifest   Current manifest.
   * @returns `true` if all dependencies are done or there are none.
   */
  private areAllDependenciesDone(artifactId: string, manifest: ChangeManifest, schema: SchemaDef): boolean {
    const art = schema.artifacts.find((a) => a.id === artifactId);
    if (!art || art.requires.length === 0) {
      return true;
    }
    for (const depId of art.requires) {
      if (manifest.artifacts[depId] !== 'done') {
        return false;
      }
    }
    return true;
  }

  /**
   * Recompute a single artifact's status from its current dependency state.
   *
   * Pure function: given the artifact's `currentStatus` and the live manifest,
   * decide what the artifact's status should be RIGHT NOW given which of its
   * dependencies are currently `done`. This is the building block of the
   * bidirectional cascade that runs after every `updateArtifactStatus` call.
   *
   * Design rules (in order of precedence):
   *
   * 1. **`done` is a user-asserted terminal state and is never auto-reverted.**
   *    Auto-reverting a completed artifact would silently discard finished
   *    work, which is far more dangerous than a transient `ready` artifact
   *    in flight. If the user wants to undo a `done` artifact, they must
   *    explicitly transition it (e.g. `done → ready`); the cascade will not
   *    do it for them.
   *
   * 2. **For every non-`done` status, the status is fully derived from
   *    dependency state.** If all dependencies are `done` (or there are
   *    none), the artifact is `ready`. Otherwise the artifact is `blocked`.
   *    This collapses the historical `blocked` / `ready` (and any future
   *    intermediate states such as `in_progress`) into a single
   *    "non-terminal" bucket, so a `ready` artifact whose dependency was
   *    just rolled back will be re-blocked, and a `blocked` artifact whose
   *    last dependency just became `done` will be unblocked.
   *
   * 3. **Conservative policy for in-flight work:** if a future
   *    `in_progress` (or any other non-`done`) status is introduced, an
   *    artifact in that state will also be reverted to `blocked` when its
   *    dependencies are no longer satisfied. This is deliberate: a writer
   *    mid-draft on top of a stale dependency is in an unsafe state, and
   *    it is safer to force them to re-confirm readiness than to let them
   *    keep writing against a rolled-back foundation.
   *
   * @param id            Artifact identifier.
   * @param currentStatus The artifact's current status (read from the
   *                      manifest immediately before the cascade ran).
   * @param manifest      The live manifest (used to inspect sibling statuses).
   * @param schema        Schema definition (used to look up `requires`).
   * @returns The status the artifact should have after the cascade.
   */
  private recomputeArtifactStatus(
    id: string,
    currentStatus: ArtifactStatus,
    manifest: ChangeManifest,
    schema: SchemaDef,
  ): ArtifactStatus {
    if (currentStatus === 'done') {
      return 'done';
    }
    const depsDone = this.areAllDependenciesDone(id, manifest, schema);
    return depsDone ? 'ready' : 'blocked';
  }

  /**
   * Update the top-level change status with enforced state transitions.
   *
   * Valid transitions:
   * - `in_progress` → `synced`
   * - `synced` → `archived`
   *
   * @param changeDir Absolute path to the change directory.
   * @param status    New top-level status.
   * @throws {ChangeStatusError} If the transition is invalid.
   * @throws {ConfigValidationError} If the manifest cannot be read or written.
   */
  async updateStatus(changeDir: string, status: ChangeManifest['status']): Promise<void> {
    const manifest = await this.readManifest(changeDir);
    const current = manifest.status;
    if (status !== current && !VALID_TRANSITIONS[current].includes(status)) {
      throw new ChangeStatusError(
        `Invalid status transition: ${current} → ${status}. Allowed from ${current}: ${VALID_TRANSITIONS[current].join(', ') || 'none'}`
      );
    }
    manifest.status = status;
    await this.writeManifest(changeDir, manifest);
  }

  /**
   * Handle artifact file deletion by reverting the artifact's status.
   *
   * Per spec § Manifest reflects artifact deletion: when an artifact file is
   * deleted, its status reverts to `ready` (if its own dependencies are still
   * met) or `blocked` (if dependencies are missing).
   *
   * NOTE: When schema is not provided, the artifact status defaults to
   * `blocked` (conservative). Pass the schema to enable accurate
   * blocked-vs-ready determination via dependency inspection.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier whose file was deleted.
   * @param schema     Optional schema def for full dependency checking.
   * @throws {ConfigValidationError} If the manifest cannot be read or written.
   */
  async handleArtifactDeletion(changeDir: string, artifactId: string, schema?: SchemaDef): Promise<void> {
    const manifest = await this.readManifest(changeDir);

    let targetStatus: ArtifactStatus = 'blocked';

    if (schema) {
      const art = schema.artifacts.find((a) => a.id === artifactId);
      if (art && art.requires.length > 0) {
        const depsDone = art.requires.every(
          (depId) => manifest.artifacts[depId] === 'done'
        );
        targetStatus = depsDone ? 'ready' : 'blocked';
      } else {
        targetStatus = 'ready';
      }
    }

    manifest.artifacts[artifactId] = targetStatus;
    await this.writeManifest(changeDir, manifest);
  }

  /**
   * Write a manifest object to `.openadab.yaml` in the change directory.
   *
   * @param changeDir Absolute path to the change directory.
   * @param manifest  Manifest to persist.
   * @throws {ConfigValidationError} If the manifest fails validation before writing.
   */
  async writeManifest(changeDir: string, manifest: ChangeManifest): Promise<void> {
    const result = ChangeManifestSchema.safeParse(manifest);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Manifest validation failed before write: ${issues}`);
    }
    const manifestPath = join(changeDir, '.openadab.yaml');
    await ensureDir(changeDir);
    const yamlString = YAML.stringify(manifest, { indent: 2, lineWidth: 0 });
    await atomicWriteFile(manifestPath, yamlString);
  }

  /**
   * Extract a chapter identifier from a change ID string.
   *
   * Looks for the `ch-NNN` segment (e.g. `draft-ch-012` → `ch-012`) and returns
   * the full slug including the `ch-` prefix, preserving any leading zeros.
   *
   * @param changeId Change identifier.
   * @returns Full chapter slug in the form `ch-NNN` (preserves leading zeros),
   *   or `undefined` if no `ch-NNN` segment is found.
   */
  private extractChapter(changeId: string): string | undefined {
    const match = /ch-(\d+)/i.exec(changeId);
    return match ? `ch-${match[1]}` : undefined;
  }
}
