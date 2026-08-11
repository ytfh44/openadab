/**
 * Artifact Graph — builds a DAG from a schema's artifact definitions,
 * computes per-artifact status (blocked / ready / done), and provides
 * topological ordering, next-step suggestions, and blocking-issue analysis.
 */
import { basename, isAbsolute, join, resolve } from 'node:path';

import type { SchemaDef, ArtifactDef } from '../../schemas/schema-def.js';
import type { ArtifactStatus, ValidationResult } from '../../schemas/types.js';
import { SchemaValidationError, CycleDetectedError, AdabError } from '../../utils/errors.js';
import { safeReadFile, fileExists } from '../../utils/fs.js';
import { extractFrontmatter } from '../../utils/markdown.js';
import { detectCycle } from '../schema-engine/index.js';

export type ArtifactStatusMap = Record<string, ArtifactStatus>;

export interface BlockingIssue {
  artifactId: string;
  reason: string;
  missingDeps: string[];
}

export interface NextStep {
  id?: string;
  action: 'write' | 'apply';
  target?: string;
}

export interface ArtifactGraphStatus {
  changeName: string;
  schemaName: string;
  artifacts: {
    id: string;
    status: ArtifactStatus;
    generates: string;
    requires: string[];
  }[];
  nextStep: NextStep[];
  blockingIssues: BlockingIssue[];
  /**
   * Issues for artifacts whose file exists but failed validation.
   * Distinct from `blockingIssues`, which is for missing-dependency problems.
   */
  validationIssues: BlockingIssue[];
}

/**
 * Mechanical validator interface used by the artifact graph to check
 * whether a "done" artifact is still valid.
 */
export interface MechanicalValidatorLike {
  /**
   * Run mechanical validation on a single artifact.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  validateArtifact(changeDir: string, artifactId: string): Promise<ValidationResult>;
}

/**
 * Internal result of {@link ArtifactGraph._computeStatus} — bundles the
 * status map and the per-artifact reason for any "ready because validation
 * failed" entries so the public methods can present them consistently.
 */
interface ComputeStatusResult {
  status: ArtifactStatusMap;
  validationIssues: BlockingIssue[];
}

const REGEX_ESCAPE_RE = /[.*+?^${}()|[\]\\]/g;

/**
 * Escape every regex metacharacter in `s` so the string can be embedded
 * inside a `RegExp` as a literal pattern.  Used when interpolating
 * schema-context keys into a generated regex.
 *
 * @param s Arbitrary string.
 * @returns Regex-safe version of the input.
 */
function escapeRegex(s: string): string {
  return s.replace(REGEX_ESCAPE_RE, '\\$&');
}

/**
 * Directed acyclic graph of artifacts derived from a {@link SchemaDef}.
 */
export class ArtifactGraph {
  private readonly schemaDef: SchemaDef;
  private readonly artifactMap: Map<string, ArtifactDef>;
  private readonly validator?: MechanicalValidatorLike;

  constructor(schemaDef: SchemaDef, validator?: MechanicalValidatorLike) {
    this.schemaDef = schemaDef;
    this.artifactMap = new Map(schemaDef.artifacts.map((a) => [a.id, a]));
    this.validator = validator;
  }

  /**
   * Compute a topological ordering of all artifact IDs using Kahn's
   * algorithm with an O(N+E) reverse-adjacency index (AG-5).
   *
   * Before sorting, this method validates the graph: any artifact whose
   * `requires` (or any `apply.requires` entry) targets an ID not
   * declared in the schema is a hard schema error and is reported via
   * {@link SchemaValidationError} (AG-1).  This catches malformed schemas
   * up-front instead of silently dropping the bad edges during the
   * in-degree pass.
   *
   * @returns Array of artifact IDs in dependency order.
   * @throws {SchemaValidationError} If a `requires` reference is unknown.
   * @throws {CycleDetectedError} If the graph contains a cycle.
   */
  topologicalSort(): string[] {
    // AG-1: validate every requires edge (artifacts + apply.requires)
    // before we start Kahn's algorithm.  The duplicate-id set is the
    // canonical "known id" set; the earlier definition of the graph
    // used the raw artifacts array, which would have silently dropped
    // refs to ids that appeared in the schema but were duplicated.
    const knownIds = new Set<string>();
    for (const art of this.schemaDef.artifacts) {
      if (!knownIds.has(art.id)) {
        knownIds.add(art.id);
      }
    }
    for (const art of this.schemaDef.artifacts) {
      for (const dep of art.requires) {
        if (!knownIds.has(dep)) {
          throw new SchemaValidationError(
            `Artifact '${art.id}' requires unknown artifact ID: ${dep}`
          );
        }
      }
    }
    if (this.schemaDef.apply !== undefined) {
      for (const dep of this.schemaDef.apply.requires) {
        if (!knownIds.has(dep)) {
          throw new SchemaValidationError(
            `apply.requires references unknown artifact ID: ${dep}`
          );
        }
      }
    }

    const inDegree = new Map<string, number>();
    for (const id of knownIds) {
      inDegree.set(id, 0);
    }
    // AG-5: build a reverse adjacency (dep -> list of dependents) once,
    // so the "decrement in-degree" pass inside Kahn's algorithm is O(1)
    // per edge instead of scanning all artifacts.
    const dependents = new Map<string, string[]>();
    for (const id of knownIds) {
      dependents.set(id, []);
    }
    for (const art of this.schemaDef.artifacts) {
      if (!knownIds.has(art.id)) {continue;}
      for (const dep of art.requires) {
        inDegree.set(art.id, (inDegree.get(art.id) ?? 0) + 1);
        dependents.get(dep)!.push(art.id);
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) {queue.push(id);}
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift();
      if (id === undefined) { break; }
      result.push(id);
      for (const dependent of dependents.get(id) ?? []) {
        const newDeg = (inDegree.get(dependent) ?? 0) - 1;
        inDegree.set(dependent, newDeg);
        if (newDeg === 0) {queue.push(dependent);}
      }
    }

    // AG-2: compare against the actual node count we attempted to sort
    // (inDegree.size / knownIds.size), not the raw artifacts.length,
    // which can differ when the schema contains duplicate ids.
    if (result.length !== knownIds.size) {
      const cycle = detectCycle(this.schemaDef.artifacts, this.schemaDef.apply?.requires, knownIds);
      if (cycle !== null) {
        // AG-10: when detectCycle returns a usable path, surface it.
        throw new CycleDetectedError(
          `Cycle detected in artifact dependencies: ${cycle.join(' → ')} (${result.length} of ${knownIds.size} artifacts processed)`,
        );
      }
      // AG-10: when detectCycle returns null we still log the partial
      // progress count so operators have a breadcrumb for debugging.
      throw new CycleDetectedError(
        `Cycle detected in artifact dependencies (${result.length} of ${knownIds.size} artifacts processed; cycle path could not be reconstructed)`,
      );
    }

    return result;
  }

  /**
   * Compute status for every artifact in the given change directory.
   *
   * Rules:
   * - File exists and passes mechanical validation (if validator provided) → **done**
   * - File missing but all dependencies are **done** → **ready**
   * - File missing and at least one dependency is not **done** → **blocked**
   * - File exists but fails mechanical validation → **ready** (needs rewrite)
   *
   * @param changeDir Absolute path to the change directory.
   * @returns Map from artifact ID to status.
   */
  async getStatus(changeDir: string): Promise<ArtifactStatusMap> {
    const result = await this._computeStatus(changeDir);
    return result.status;
  }

  /**
   * Internal helper that computes the status map and a parallel list of
   * validation issues.  Public methods that need both (e.g.
   * {@link getBlockingIssues}, {@link toJson}) call this once and share
   * the result, avoiding redundant disk I/O (AG-6).
   *
   * @param changeDir Absolute path to the change directory.
   * @returns Combined status map and validation issues.
   */
  private async _computeStatus(changeDir: string): Promise<ComputeStatusResult> {
    const status: ArtifactStatusMap = {};
    const validationIssues: BlockingIssue[] = [];
    const sorted = this.topologicalSort();

    for (const id of sorted) {
      const art = this.artifactMap.get(id);
      if (art === undefined) {continue;}
      const filePath = join(changeDir, art.generates);
      const exists = await fileExists(filePath);

      if (exists) {
        const valid = await this.isValid(filePath, id, changeDir);
        if (valid) {
          status[id] = 'done';
        } else {
          // AG-8: capture why this artifact is "ready" (validation
          // failure) so callers can report it through validationIssues.
          status[id] = 'ready';
          validationIssues.push({
            artifactId: id,
            reason: `Validation failed for '${id}' — needs rewrite`,
            missingDeps: [],
          });
        }
      } else {
        const depsDone = art.requires.every((dep) => status[dep] === 'done');
        status[id] = depsDone ? 'ready' : 'blocked';
      }
    }

    return { status, validationIssues };
  }

  async getReadyArtifacts(changeDir: string): Promise<string[]> {
    const { status } = await this._computeStatus(changeDir);
    return Object.entries(status)
      .filter(([, s]) => s === 'ready')
      .map(([id]) => id);
  }

  /**
   * Suggest the next action(s) based on current graph state.
   *
   * If artifacts are ready, returns "write" actions for each.
   * If all artifacts (and apply.requires, when present) are done,
   * returns a single "apply" action.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param precomputed Optional result of {@link _computeStatus} when the
   *                    caller already computed it (e.g. {@link toJson});
   *                    avoids a redundant recompute (AG-6).
   * @returns Array of next steps.
   */
  async getNextStep(changeDir: string, precomputed?: ComputeStatusResult): Promise<NextStep[]> {
    const { status } = precomputed ?? (await this._computeStatus(changeDir));
    const ready = Object.entries(status)
      .filter(([, s]) => s === 'ready')
      .map(([id]) => id);

    if (ready.length > 0) {
      return ready.map((id) => ({ id, action: 'write' as const }));
    }

    const allDone = this.schemaDef.artifacts.every((art) => status[art.id] === 'done');
    const applyReady = allDone && this.schemaDef.apply
      ? this.schemaDef.apply.requires.every((req) => status[req] === 'done')
      : false;

    if (applyReady) {
      let target = this.schemaDef.apply?.target ?? '';
      // Interpolate {{chapter}} and schema context variables in the apply target.
      const chapterMatch = /ch-(\d+)/i.exec(changeDir);
      if (chapterMatch) {
        target = target.replace(/\{\{chapter\}\}/g, `ch-${chapterMatch[1]}`);
      }
      if (this.schemaDef.context) {
        for (const [key, value] of Object.entries(this.schemaDef.context)) {
          // AG-3: escape regex metacharacters in the user-supplied key,
          // and pass the value through a function so that special
          // replacement patterns (e.g. `$&`, `$1`) are inserted literally.
          const re = new RegExp(`\\{\\{${escapeRegex(key)}\\}\\}`, 'g');
          target = target.replace(re, () => String(value));
        }
      }
      return [{ action: 'apply', target }];
    }

    return [];
  }

  /**
   * Report issues that prevent the change from progressing.
   *
   * Two kinds of issues are returned:
   * 1. Blocking issues — artifacts blocked by missing/unfinished deps.
   * 2. Validation issues — artifacts whose file exists but failed
   *    mechanical validation (AG-8).
   *
   * @param changeDir  Absolute path to the change directory.
   * @param precomputed Optional result of {@link _computeStatus} when the
   *                    caller already computed it (e.g. {@link toJson});
   *                    avoids a redundant recompute (AG-6).
   * @returns Combined list of issues, blocking first then validation.
   */
  async getBlockingIssues(changeDir: string, precomputed?: ComputeStatusResult): Promise<BlockingIssue[]> {
    const { status, validationIssues } = precomputed ?? (await this._computeStatus(changeDir));
    const issues: BlockingIssue[] = [];

    for (const art of this.schemaDef.artifacts) {
      if (status[art.id] !== 'blocked') {continue;}
      const missingDeps = art.requires.filter((dep) => status[dep] !== 'done');
      if (missingDeps.length > 0) {
        issues.push({
          artifactId: art.id,
          reason: `Blocked by incomplete dependencies: ${missingDeps.join(', ')}`,
          missingDeps,
        });
      }
    }

    // AG-8: append validation issues so the caller can present them.
    issues.push(...validationIssues);
    return issues;
  }

  /**
   * Build a JSON-friendly status summary for the change directory.
   *
   * @param changeDir Absolute path to the change directory.
   * @returns Structured status payload.
   */
  async toJson(changeDir: string): Promise<ArtifactGraphStatus> {
    // AG-6: compute the status map once and share it with the dependent
    // helpers below; each call to _computeStatus re-stats every artifact
    // file on disk.
    const computed = await this._computeStatus(changeDir);
    const { status, validationIssues } = computed;
    const nextStep = await this.getNextStep(changeDir, computed);
    const blockingIssues = await this.getBlockingIssues(changeDir, computed);

    // AG-7: pop() returns '' for a path with no segments (e.g. "/").
    // Fall back to a sensible name derived from the absolute path.
    let changeName = changeDir.split(/[\\/]/).pop() ?? '';
    if (changeName === '') {
      changeName = isAbsolute(changeDir)
        ? basename(resolve(changeDir))
        : changeDir;
    }

    return {
      changeName,
      schemaName: this.schemaDef.name,
      artifacts: this.schemaDef.artifacts.map((art) => ({
        id: art.id,
        status: status[art.id],
        generates: art.generates,
        requires: art.requires,
      })),
      nextStep,
      blockingIssues,
      validationIssues,
    };
  }

  /**
   * Check whether an existing artifact file passes basic mechanical checks:
   * non-empty content and, when a validator is available, mechanical validation.
   *
   * @param filePath  Absolute path to the artifact file.
   * @param artifactId Artifact identifier.
   * @param changeDir  Absolute path to the change directory.
   * @returns `true` if the artifact is considered valid.
   */
  private async isValid(filePath: string, artifactId: string, changeDir: string): Promise<boolean> {
    const content = await safeReadFile(filePath);
    if (content === null || content.trim().length === 0) {
      return false;
    }

    const art = this.artifactMap.get(artifactId);
    if (art?.validation?.mechanical?.includes('frontmatterPresent')) {
      const { data } = extractFrontmatter(content);
      // AG-4: gray-matter returns a synthetic `{ content: '' }` object
      // for plain content with no actual frontmatter, so the empty-key
      // heuristic misfires.  Detect that case via the `_synthetic`
      // sentinel injected by gray-matter (or our own fallback) and treat
      // it as "no frontmatter".
      const isSynthetic = (data)._synthetic === true;
      if (isSynthetic || Object.keys(data).length === 0) {
        return false;
      }
    }

    if (this.validator) {
      // AG-9: wrap the validator call so a thrown error counts as
      // "invalid" instead of crashing the whole status computation.
      try {
        const result = await this.validator.validateArtifact(changeDir, artifactId);
        if (!result.passed) {
          return false;
        }
      } catch (err) {
        const message = err instanceof AdabError ? err.message : err instanceof Error ? err.message : String(err);
        console.warn(`[ArtifactGraph] Validator for '${artifactId}' threw: ${message}`);
        return false;
      }
    }

    return true;
  }
}
