/**
 * Instruction Loader — assembles the full instruction payload for a given
 * artifact, including template text, rules, context pack, and optionally
 * inlined dependency content.
 */
import { join, resolve, relative, isAbsolute, sep } from 'node:path';

import type { SchemaDef, ArtifactDef } from '../../schemas/schema-def.js';
import type { ContextPack, ProjectConfig } from '../../schemas/types.js';
import { TargetNotFoundError, UnresolvedVariableError, TemplateNotFoundError } from '../../utils/errors.js';
import { safeReadFile } from '../../utils/fs.js';
import { PathTraversalError } from '../../utils/path.js';
import type { ContextPacker } from '../context-packer/index.js';
import { interpolateVariables, interpolateConfigVariables } from '../schema-engine/index.js';

/**
 * Prefix used in `requiredReads` to mark a dependency that is declared in
 * the artifact's `requires` list but has no matching artifact definition
 * in the schema. The string `unknown:<id>` is unambiguous to consumers
 * because a real filesystem path would never contain the literal
 * `unknown:` segment (artifact output paths are relative to the change
 * directory and never include a top-level `unknown:` directory).
 */
const UNKNOWN_DEP_PREFIX = 'unknown:';

/**
 * Instruction payload returned by {@link InstructionLoader.loadInstructions}.
 */
export interface InstructionPayload {
  /** The fully assembled instruction text (instruction + template + rules + warnings). */
  instruction: string;
  /** The raw template text (after variable interpolation). */
  template: string;
  /** Target output path for the artifact. */
  outputPath: string;
  /** Per-artifact rules from config. */
  rules: string[];
  /** Required dependency artifact file paths. Missing deps are marked as `unknown:<id>`. */
  requiredReads: string[];
  /** Context pack with file lists and reasons. */
  contextPack: ContextPack;
  /** Inlined dependency content (only when inline mode is enabled). */
  dependencyContent?: Record<string, string>;
  /**
   * Structured warnings collected during assembly. Mirrors the
   * human-readable warning lines that also appear concatenated inside
   * `instruction`, but is the authoritative, machine-parseable form.
   * The two views are kept in sync by `loadInstructions`.
   */
  warnings: string[];
  /** Change identifier. */
  change: string;
  /** Artifact identifier. */
  artifact: string;
}

/**
 * Build a uniform human-readable "missing dependency" warning string.
 *
 * Two distinct cases are merged into one shape so the warning text is
 * identical wherever the loader reports a missing dependency (the
 * instruction body, the `warnings` array, and the inlined `dependencyContent`
 * map).
 *
 *   - The dependency's artifact definition is missing from the schema
 *     (caller-supplied `depArt` is `undefined`): the warning falls back
 *     to `${depId}.md` since we have no other name to suggest.
 *   - The artifact definition is present but the generated file is not
 *     on disk: the warning uses `depArt.generates` verbatim so the
 *     command the user should run next is unambiguous.
 *
 * The output is consistently wrapped in backticks around the filename so
 * it renders as inline code in Markdown.
 *
 * @param depId  The dependency identifier declared in `artifact.requires`.
 * @param depArt The matching artifact definition, or `undefined` when
 *               the schema does not declare one.
 * @returns A single-line warning, ready to be appended to the
 *          instruction body or the `warnings` array.
 */
function formatMissingDepWarning(depId: string, depArt: ArtifactDef | undefined): string {
  const filename = depArt ? depArt.generates : `${depId}.md`;
  return `Warning: dependency '${depId}' is missing. Write \`${filename}\` first.`;
}

/**
 * Loads and assembles instruction payloads for artifact generation.
 */
export class InstructionLoader {
  private readonly schemaDef: SchemaDef;
  private readonly projectConfig: ProjectConfig;
  private readonly contextPacker: ContextPacker;
  private readonly changeDir: string;
  private readonly changeContext: Record<string, string>;
  private readonly projectRoot: string;

  /**
   * @param schemaDef     Loaded schema definition.
   * @param projectConfig Loaded project configuration.
   * @param contextPacker Context packer instance.
   * @param changeDir     Change directory name (e.g. `ch-012`).
   * @param changeContext Optional change-specific context for template variable interpolation
   *                      (e.g. `{ chapter: '012', changeId: 'ch-012' }`).
   * @param projectRoot   Absolute path to the project root.
   * @throws {PathTraversalError} When `changeDir` (after resolution against
   *         the changes root) escapes `<projectRoot>/adab/changes/`.
   */
  constructor(
    schemaDef: SchemaDef,
    projectConfig: ProjectConfig,
    contextPacker: ContextPacker,
    changeDir: string,
    changeContext?: Record<string, string>,
    projectRoot?: string,
  ) {
    const resolvedRoot = projectRoot ?? contextPacker.projectRootPath;
    const changesRoot = join(resolvedRoot, 'adab', 'changes');
    const resolvedChange = resolve(changesRoot, changeDir);
    const rel = relative(changesRoot, resolvedChange);
    // `rel` is the empty string when `changeDir` collapses back to the
    // changes root itself (e.g. `foo/..`), and `'.'` when it is a bare
    // `.` — both must be rejected just like an explicit `..`, otherwise
    // `outputPath` would land directly in `adab/changes/` instead of a
    // change subdirectory.
    if (rel === '' || rel === '.' || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new PathTraversalError(changeDir, changesRoot);
    }
    this.schemaDef = schemaDef;
    this.projectConfig = projectConfig;
    this.contextPacker = contextPacker;
    this.changeDir = changeDir;
    this.changeContext = changeContext ?? {};
    this.projectRoot = resolvedRoot;
  }

  /**
   * Load the full instruction payload for an artifact.
   *
   * Assembles the instruction body from the artifact's `instruction`
   * (or `instructionFile`), the rendered template, the per-artifact
   * rules, and any missing-dependency warnings. Both a concatenated
   * `instruction` string and a structured `warnings` array are returned
   * and kept in sync.
   *
   * @param artifactId Artifact identifier.
   * @param inlineDeps Whether to inline dependency file contents.
   * @returns A {@link InstructionPayload}.
   */
  async loadInstructions(artifactId: string, inlineDeps?: boolean): Promise<InstructionPayload> {
    const artifact = this.resolveArtifact(artifactId);
    const template = await this.loadTemplate(artifactId);
    const rules = this.injectRules(artifactId);
    const contextPack = await this.contextPacker.packContext(this.changeDir, artifactId);
    const dependencyContent = await this.loadDependencyContent(artifactId, inlineDeps ?? false);

    let instructionText = artifact.instruction ?? '';
    if (artifact.instructionFile !== undefined) {
      // Per spec: instructionFile overrides the inline instruction field.
      // The precedence is documented here so callers and tests can rely on
      // a single source of truth: when both are set, the on-disk file
      // wins and a console warning flags the conflict. We do not throw,
      // because some authors use `instruction` as a fallback while they
      // are still authoring the on-disk instructions file.
      if (instructionText) {
        // eslint-disable-next-line no-console
        console.warn(`[InstructionLoader] Artifact '${artifactId}' has both 'instruction' and 'instructionFile' — using instructionFile content`);
      }
      const schemaDir = join(this.projectRoot, 'adab', 'schemas', this.schemaDef.name);
      const instrPath = join(schemaDir, artifact.instructionFile);
      const raw = await safeReadFile(instrPath);
      if (raw !== null) {
        instructionText = raw;
      } else {
        // The on-disk instructions file is missing: fall back to the
        // inline `instruction` field when present (documented authoring
        // fallback), but always flag the missing file so an empty
        // result is not mistaken for a valid generated instruction.
        // eslint-disable-next-line no-console
        console.warn(
          `[InstructionLoader] instructionFile '${artifact.instructionFile}' not found for artifact '${artifactId}' — using inline instruction`
        );
      }
    }

    const instructionParts: string[] = [];
    if (instructionText) {
      instructionParts.push(instructionText);
    }
    if (template) {
      instructionParts.push(template);
    }
    if (rules.length > 0) {
      instructionParts.push(`Rules:\n${rules.map((r) => `- ${r}`).join('\n')}`);
    }

    const artifactMap = new Map(this.schemaDef.artifacts.map((a) => [a.id, a]));
    const changePath = join(this.projectRoot, 'adab', 'changes', this.changeDir);
    const warnings: string[] = [];
    for (const depId of artifact.requires) {
      const depArt = artifactMap.get(depId);
      if (!depArt) {
        warnings.push(formatMissingDepWarning(depId, undefined));
        continue;
      }
      const depPath = join(changePath, depArt.generates);
      const depRaw = await safeReadFile(depPath);
      if (depRaw === null) {
        warnings.push(formatMissingDepWarning(depId, depArt));
      }
    }
    if (warnings.length > 0) {
      instructionParts.push(...warnings);
    }

    const outputPath = join(this.projectRoot, 'adab', 'changes', this.changeDir, artifact.generates);

    const requiredReads = artifact.requires.map((depId) => {
      const depArt = artifactMap.get(depId);
      if (!depArt) {
        return `${UNKNOWN_DEP_PREFIX}${depId}`;
      }
      return join(this.projectRoot, 'adab', 'changes', this.changeDir, depArt.generates);
    });

    return {
      instruction: instructionParts.join('\n\n'),
      template,
      outputPath,
      rules,
      requiredReads,
      contextPack,
      dependencyContent: inlineDeps === true ? dependencyContent : undefined,
      warnings,
      change: this.changeDir,
      artifact: artifactId,
    };
  }

  /**
   * Load and interpolate the template for an artifact.
   *
   * Reads the artifact's `template` file, resolves `{{variable}}` and
   * `{{config.*}}` placeholders, and returns the resulting text.
   *
   * If a placeholder cannot be resolved, the underlying interpolation
   * throws an {@link UnresolvedVariableError}; this method does not
   * catch and mask the error — the caller is expected to surface the
   * failure to the user rather than proceed with a partially
   * interpolated template that would silently mislead downstream
   * processing.
   *
   * When the same key appears in both the schema's `context` block and
   * the change-specific `changeContext`, a warning is emitted so authors
   * are aware of the override. The `changeContext` value always wins
   * (later assignment in the merged object).
   *
   * @param artifactId Artifact identifier.
   * @returns Interpolated template text.
   * @throws {UnresolvedVariableError} If any referenced variable or
   *         `{{config.*}}` path is missing.
   */
  async loadTemplate(artifactId: string): Promise<string> {
    const artifact = this.resolveArtifact(artifactId);
    if (artifact.template === undefined || artifact.template.length === 0) {
      return '';
    }
    const schemaDir = join(this.projectRoot, 'adab', 'schemas', this.schemaDef.name);
    const templatePath = join(schemaDir, artifact.template);
    const raw = await safeReadFile(templatePath);
    if (raw === null) {
      // A schema-declared template that is missing from disk must not
      // silently yield an empty instruction that looks valid. Unlike a
      // missing dependency file (a forward-planning warning), a missing
      // template is a configuration error and surfaces as such.
      throw new TemplateNotFoundError(
        `Template file not found: ${templatePath} (referenced by artifact '${artifactId}' in schema '${this.schemaDef.name}')`
      );
    }

    const schemaContext = this.schemaDef.context ?? {};
    const mergedContext: Record<string, string> = {
      ...(schemaContext as Record<string, string>),
      ...this.changeContext,
    };
    for (const key of Object.keys(this.changeContext)) {
      if (Object.prototype.hasOwnProperty.call(schemaContext, key)) {
        // eslint-disable-next-line no-console
        console.warn(
          `[InstructionLoader] changeContext overrides schemaContext key '${key}'; the changeContext value will be used.`
        );
      }
    }
    let text = raw;
    try {
      text = interpolateVariables(text, mergedContext);
    } catch (err) {
      if (err instanceof UnresolvedVariableError) {
        throw err;
      }
      throw new UnresolvedVariableError(
        `Failed to interpolate schema variables: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err }
      );
    }
    return interpolateConfigVariables(text, this.projectConfig);
  }

  /**
   * Inject per-artifact rules from project config.
   *
   * @param artifactId Artifact identifier.
   * @returns Array of rule strings.
   */
  injectRules(artifactId: string): string[] {
    const rules = this.projectConfig.rules[artifactId];
    return Array.isArray(rules) ? rules : [];
  }

  /**
   * Load dependency artifact contents for inlining.
   *
   * When `inline` is true, reads the content of all dependency artifacts
   * and returns them as a map. Missing files produce a warning string
   * instead of an entry, allowing forward planning.
   *
   * The artifact ID itself is guaranteed to be resolvable by the time
   * this method runs: `loadInstructions` resolves the artifact first
   * and only then calls this method. The previous version wrapped the
   * resolve call in a defensive try/catch that could never trigger
   * (dead code); it has been removed so any future regression in the
   * resolution contract surfaces as a real error.
   *
   * @param artifactId Artifact identifier.
   * @param inline     Whether to read file contents.
   * @returns Map of artifact ID → file content (or warning message).
   */
  async loadDependencyContent(artifactId: string, inline: boolean): Promise<Record<string, string>> {
    if (!inline) {
      return {};
    }
    const artifact = this.resolveArtifact(artifactId);
    const result: Record<string, string> = {};
    const changePath = join(this.projectRoot, 'adab', 'changes', this.changeDir);
    for (const depId of artifact.requires) {
      const depArt = this.schemaDef.artifacts.find((a) => a.id === depId);
      if (!depArt) {
        result[depId] = formatMissingDepWarning(depId, undefined);
        continue;
      }
      const depPath = join(changePath, depArt.generates);
      const raw = await safeReadFile(depPath);
      if (raw === null) {
        result[depId] = formatMissingDepWarning(depId, depArt);
      } else {
        result[depId] = raw;
      }
    }
    return result;
  }

  /**
   * Resolve the artifact definition by ID.
   *
   * @param artifactId Artifact identifier.
   * @returns The artifact definition.
   * @throws {TargetNotFoundError} If the artifact is not found in the schema.
   */
  private resolveArtifact(artifactId: string): ArtifactDef {
    const artifact = this.schemaDef.artifacts.find((a) => a.id === artifactId);
    if (!artifact) {
      throw new TargetNotFoundError(`Artifact '${artifactId}' not found in schema '${this.schemaDef.name}'`);
    }
    return artifact;
  }

}
