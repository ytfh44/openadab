/**
 * Artifact Graph — builds a DAG from a schema's artifact definitions,
 * computes per-artifact status (blocked / ready / done), and provides
 * topological ordering, next-step suggestions, and blocking-issue analysis.
 */
import { join } from 'node:path';

import type { SchemaDef, ArtifactDef } from '../../schemas/schema-def.js';
import type { ArtifactStatus, ValidationResult } from '../../schemas/types.js';
import { safeReadFile, fileExists } from '../../utils/fs.js';
import { extractFrontmatter } from '../../utils/markdown.js';
import { detectCycle } from '../schema-engine/index.js';
import { CycleDetectedError } from '../../utils/errors.js';

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
   * Compute a topological ordering of all artifact IDs using Kahn's algorithm.
   *
   * @returns Array of artifact IDs in dependency order.
   */
  topologicalSort(): string[] {
    const inDegree = new Map<string, number>();
    for (const art of this.schemaDef.artifacts) {
      inDegree.set(art.id, 0);
    }
    for (const art of this.schemaDef.artifacts) {
      for (const dep of art.requires) {
        if (inDegree.has(dep)) {
          inDegree.set(art.id, (inDegree.get(art.id) ?? 0) + 1);
        }
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
      for (const art of this.schemaDef.artifacts) {
        if (art.requires.includes(id)) {
          const newDeg = (inDegree.get(art.id) ?? 0) - 1;
          inDegree.set(art.id, newDeg);
          if (newDeg === 0) {queue.push(art.id);}
        }
      }
    }

    if (result.length !== this.schemaDef.artifacts.length) {
      // Use DFS to find the actual cycle path for better error reporting
      const cycle = detectCycle(this.schemaDef.artifacts, this.schemaDef.apply?.requires);
      if (cycle !== null) {
        throw new CycleDetectedError(
          `Cycle detected in artifact dependencies: ${cycle.join(' → ')} (${result.length} of ${this.schemaDef.artifacts.length} artifacts processed)`,
        );
      }
      throw new CycleDetectedError(
        `Cycle detected in artifact dependencies: ${result.length} of ${this.schemaDef.artifacts.length} artifacts processed`,
      );
    }

    return result;
  }

  /**
   * Determine the status of every artifact in the given change directory.
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
    const status: ArtifactStatusMap = {};
    const sorted = this.topologicalSort();

    for (const id of sorted) {
      const art = this.artifactMap.get(id);
      if (art === undefined) {continue;}
      const filePath = join(changeDir, art.generates);
      const exists = await fileExists(filePath);

      if (exists) {
        const valid = await this.isValid(filePath, id, changeDir);
        status[id] = valid ? 'done' : 'ready';
      } else {
        const depsDone = art.requires.every((dep) => status[dep] === 'done');
        status[id] = depsDone ? 'ready' : 'blocked';
      }
    }

    return status;
  }

  async getReadyArtifacts(changeDir: string): Promise<string[]> {
    const status = await this.getStatus(changeDir);
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
   * @param changeDir Absolute path to the change directory.
   * @returns Array of next steps.
   */
  async getNextStep(changeDir: string): Promise<NextStep[]> {
    const status = await this.getStatus(changeDir);
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

    if (applyReady === true) {
      let target = this.schemaDef.apply?.target ?? '';
      // Interpolate {{chapter}} and schema context variables in the apply target.
      const chapterMatch = /ch-(\d+)/i.exec(changeDir);
      if (chapterMatch) {
        target = target.replace(/\{\{chapter\}\}/g, `ch-${chapterMatch[1]}`);
      }
      if (this.schemaDef.context) {
        for (const [key, value] of Object.entries(this.schemaDef.context)) {
          target = target.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
        }
      }
      return [{ action: 'apply', target }];
    }

    return [];
  }

  async getBlockingIssues(changeDir: string): Promise<BlockingIssue[]> {
    const status = await this.getStatus(changeDir);
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

    return issues;
  }

  async toJson(changeDir: string): Promise<ArtifactGraphStatus> {
    const status = await this.getStatus(changeDir);
    const nextStep = await this.getNextStep(changeDir);
    const blockingIssues = await this.getBlockingIssues(changeDir);

    return {
      changeName: changeDir.split(/[\\/]/).pop() ?? changeDir,
      schemaName: this.schemaDef.name,
      artifacts: this.schemaDef.artifacts.map((art) => ({
        id: art.id,
        status: status[art.id],
        generates: art.generates,
        requires: art.requires,
      })),
      nextStep,
      blockingIssues,
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
      if (Object.keys(data).length === 0) {
        return false;
      }
    }

    if (this.validator) {
      const result = await this.validator.validateArtifact(changeDir, artifactId);
      if (!result.passed) {
        return false;
      }
    }

    return true;
  }
}
