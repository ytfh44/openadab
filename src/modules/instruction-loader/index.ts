/**
 * Instruction Loader — assembles the full instruction payload for a given
 * artifact, including template text, rules, context pack, and optionally
 * inlined dependency content.
 */
import { join } from 'node:path';

import type { SchemaDef, ArtifactDef } from '../../schemas/schema-def.js';
import type { ContextPack, ProjectConfig } from '../../schemas/types.js';
import { TargetNotFoundError } from '../../utils/errors.js';
import { safeReadFile } from '../../utils/fs.js';
import type { ContextPacker } from '../context-packer/index.js';
import { interpolateVariables, interpolateConfigVariables } from '../schema-engine/index.js';

/**
 * Instruction payload returned by {@link InstructionLoader.loadInstructions}.
 */
export interface InstructionPayload {
  /** The fully assembled instruction text. */
  instruction: string;
  /** The raw template text (after variable interpolation). */
  template: string;
  /** Target output path for the artifact. */
  outputPath: string;
  /** Per-artifact rules from config. */
  rules: string[];
  /** Required dependency artifact IDs. */
  requiredReads: string[];
  /** Context pack with file lists and reasons. */
  contextPack: ContextPack;
  /** Inlined dependency content (only when inline mode is enabled). */
  dependencyContent?: Record<string, string>;
  /** Change identifier. */
  change: string;
  /** Artifact identifier. */
  artifact: string;
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
   */
  constructor(
    schemaDef: SchemaDef,
    projectConfig: ProjectConfig,
    contextPacker: ContextPacker,
    changeDir: string,
    changeContext?: Record<string, string>,
    projectRoot?: string,
  ) {
    this.schemaDef = schemaDef;
    this.projectConfig = projectConfig;
    this.contextPacker = contextPacker;
    this.changeDir = changeDir;
    this.changeContext = changeContext ?? {};
    this.projectRoot = projectRoot ?? contextPacker.projectRootPath;
  }

  /**
   * Load the full instruction payload for an artifact.
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
      if (instructionText) {
        console.warn(`[InstructionLoader] Artifact '${artifactId}' has both 'instruction' and 'instructionFile' — using instructionFile content`);
      }
      const schemaDir = join(this.projectRoot, 'adab', 'schemas', this.schemaDef.name);
      const instrPath = join(schemaDir, artifact.instructionFile);
      const raw = await safeReadFile(instrPath);
      if (raw !== null) {
        instructionText = raw;
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
      instructionParts.push(`Rules:\n${  rules.map((r) => `- ${r}`).join('\n')}`);
    }

    const artifactMap = new Map(this.schemaDef.artifacts.map((a) => [a.id, a]));
    const changePath = join(this.projectRoot, 'adab', 'changes', this.changeDir);
    const missingDepWarnings: string[] = [];
    for (const depId of artifact.requires) {
      const depArt = artifactMap.get(depId);
      if (!depArt) {
        missingDepWarnings.push(`Warning: dependency '${depId}' is missing. Write \`${depId}.md\` first.`);
      } else {
        const depPath = join(changePath, depArt.generates);
        const depRaw = await safeReadFile(depPath);
        if (depRaw === null) {
          missingDepWarnings.push(`Warning: dependency '${depId}' is missing. Write \`${depArt.generates}\` first.`);
        }
      }
    }
    if (missingDepWarnings.length > 0) {
      instructionParts.push(...missingDepWarnings);
    }

    const outputPath = join(this.projectRoot, 'adab', 'changes', this.changeDir, artifact.generates);

    const requiredReads = artifact.requires.map((depId) => {
      const depArt = artifactMap.get(depId);
      return depArt ? join(this.projectRoot, 'adab', 'changes', this.changeDir, depArt.generates) : depId;
    });

    return {
      instruction: instructionParts.join('\n\n'),
      template,
      outputPath,
      rules,
      requiredReads,
      contextPack,
      dependencyContent: inlineDeps === true ? dependencyContent : undefined,
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
   * @param artifactId Artifact identifier.
   * @returns Interpolated template text.
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
      return '';
    }

    let text = raw;
    const mergedContext: Record<string, string> = {
      ...(this.schemaDef.context ?? {}),
      ...this.changeContext,
    };
    if (Object.keys(mergedContext).length > 0) {
      try {
        text = interpolateVariables(text, mergedContext);
      } catch (err) {
        // Replace remaining unresolved variables with a marker
        text = text.replace(/\{\{(\w+)\}\}/g, '[unresolved: $1]');
        console.warn('[InstructionLoader] Failed to interpolate schema variables:', err instanceof Error ? err.message : String(err));
      }
    }
    try {
      text = interpolateConfigVariables(text, this.projectConfig);
    } catch (err) {
      // Replace remaining unresolved variables with a marker
      text = text.replace(/\{\{(\w+)\}\}/g, '[unresolved: $1]');
      console.warn('[InstructionLoader] Failed to interpolate config variables:', err instanceof Error ? err.message : String(err));
    }
    return text;
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
   * and returns them as a map.  Missing files produce a warning but do not
   * throw, allowing forward planning.
   *
   * @param artifactId Artifact identifier.
   * @param inline     Whether to read file contents.
   * @returns Map of artifact ID → file content (or warning message).
   */
  async loadDependencyContent(artifactId: string, inline: boolean): Promise<Record<string, string>> {
    if (!inline) {
      return {};
    }
    let artifact: ReturnType<typeof this.resolveArtifact>;
    try {
      artifact = this.resolveArtifact(artifactId);
    } catch {
      // Return warning for missing main artifact instead of throwing
      return { [artifactId]: `Warning: artifact '${artifactId}' is missing.` };
    }
    const result: Record<string, string> = {};
    const changePath = join(this.projectRoot, 'adab', 'changes', this.changeDir);
    for (const depId of artifact.requires) {
      const depArt = this.schemaDef.artifacts.find((a) => a.id === depId);
      if (!depArt) {
        result[depId] = `Warning: dependency '${depId}' is missing. Write ${depId}.md first.`;
        continue;
      }
      const depPath = join(changePath, depArt.generates);
      const raw = await safeReadFile(depPath);
      if (raw === null) {
        result[depId] = `Warning: dependency '${depId}' is missing. Write \`${depArt.generates}\` first.`;
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
