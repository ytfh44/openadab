/**
 * Schema Engine — loads, validates, forks, and interpolates workflow schemas.
 */
import { readFileSync } from 'node:fs';
import { readdir, copyFile } from 'node:fs/promises';
import { join , dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import type { ProjectConfig } from '../../schemas/project-config.js';
import { SchemaDefSchema, type SchemaDef, type ArtifactDef } from '../../schemas/schema-def.js';
import type { ValidationResult } from '../../schemas/types.js';
import { SchemaValidationError, CycleDetectedError, UnresolvedVariableError, TemplateNotFoundError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';

/**
 * Loads and validates schema YAML from a directory.
 */
export class SchemaLoader {
  private readonly schemaDir: string;

  /**
   * @param schemaDir Absolute path to the schema directory (contains `schema.yaml`).
   */
  constructor(schemaDir: string) {
    this.schemaDir = schemaDir;
  }

  /**
   * Load and validate the schema definition.
   *
   * Reads `schema.yaml` from the schema directory, parses YAML, validates
   * against the zod {@link SchemaDefSchema}, and returns the typed object.
   *
   * @returns The validated schema definition.
   * @throws {SchemaValidationError} If the file is missing, malformed, or invalid.
   */
  async load(): Promise<SchemaDef> {
    const schemaPath = join(this.schemaDir, 'schema.yaml');
    const raw = await safeReadFile(schemaPath);
    if (raw === null) {
      throw new SchemaValidationError(`Schema file not found: ${schemaPath}`);
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new SchemaValidationError(`Failed to parse schema YAML: ${msg}`, { cause: err });
    }
    const result = SchemaDefSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new SchemaValidationError(`Schema validation failed: ${issues}`);
    }
    return result.data;
  }

  /**
   * List available built-in schema names shipped with the CLI.
   *
   * @returns Array of built-in schema directory names.
   */
  async listBuiltInSchemas(activeSchema?: string): Promise<string[]> {
    const candidates = [
      join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas', 'built-in'),
      join(process.cwd(), 'src', 'schemas', 'built-in'),
    ];
    for (const builtInDir of candidates) {
      try {
        const entries = await readdir(builtInDir, { withFileTypes: true });
        return entries
          .filter((d) => d.isDirectory())
          .map((d) => (d.name === activeSchema ? `${d.name} [active]` : d.name));
      } catch (err) {
        console.warn('[SchemaEngine] Failed to read built-in schema candidates dir:', err instanceof Error ? err.message : String(err));
        // Try next candidate.
      }
    }
    return [];
  }

  private async copyDirContents(src: string, dest: string): Promise<void> {
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await ensureDir(destPath);
        await this.copyDirContents(srcPath, destPath);
      } else {
        await copyFile(srcPath, destPath);
      }
    }
  }

  /**
   * Fork a built-in schema into the project's schemas directory.
   *
   * Copies the schema directory (including templates) and injects
   * `forked_from` metadata into the copied `schema.yaml`.
   *
   * @param baseName Name of the built-in schema to fork.
   * @param newName  Name for the new schema copy.
   * @throws {SchemaValidationError} If the base schema does not exist.
   */
  async forkSchema(baseName: string, newName: string): Promise<void> {
    const builtInDir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'schemas', 'built-in');
    const srcDir = join(builtInDir, baseName);
    if (!(await fileExists(srcDir))) {
      const available = await this.listBuiltInSchemas();
      throw new SchemaValidationError(
        `Schema '${baseName}' not found. Available: ${available.join(', ') || 'none'}`
      );
    }
    const destDir = join(this.schemaDir, newName);
    await ensureDir(destDir);
    await this.copyDirContents(srcDir, destDir);

    const schemaPath = join(destDir, 'schema.yaml');
    const raw = await safeReadFile(schemaPath);
    if (raw !== null) {
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      parsed.forked_from = baseName;
      parsed.forked_version = getCliVersion();
      await atomicWriteFile(schemaPath, YAML.stringify(parsed, { indent: 2, lineWidth: 0 }));
    }
  }

}

/**
 * Validates a loaded schema definition for structural correctness.
 */
export class SchemaValidator {
  /**
   * Validate a schema definition.
   *
   * Checks: required fields present, artifact ID uniqueness,
   * `apply.requires` referencing valid artifact IDs, and template file existence.
   *
   * @param schemaDef  The schema definition to validate.
   * @param schemaDir  Optional absolute path to the schema directory for template existence checks.
   * @returns A {@link import('../../schemas/types.js').ValidationResult ValidationResult}.
   */
  async validate(schemaDef: SchemaDef, schemaDir?: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!schemaDef.name) {
      errors.push('Missing required field: name');
    }
    if (typeof schemaDef.version !== 'number') {
      errors.push('Missing or invalid field: version');
    }

    const artifactIds = new Set<string>();
    const deduplicatedArtifacts: ArtifactDef[] = [];
    for (const art of schemaDef.artifacts) {
      if (artifactIds.has(art.id)) {
        errors.push(`Duplicate artifact ID: ${art.id}`);
      } else {
        artifactIds.add(art.id);
        deduplicatedArtifacts.push(art);
      }
    }

    if (schemaDef.apply !== undefined) {
      for (const req of schemaDef.apply.requires) {
        if (!artifactIds.has(req)) {
          errors.push(`apply.requires references unknown artifact ID: ${req}`);
        }
      }
    }

    for (const art of deduplicatedArtifacts) {
      for (const req of art.requires) {
        if (!artifactIds.has(req)) {
          errors.push(`Artifact '${art.id}' requires unknown artifact ID: ${req}`);
        }
      }
      if (art.template !== undefined && schemaDir !== undefined) {
        const templatePath = resolveTemplatePath(schemaDir, art.template);
        if (!(await fileExists(templatePath))) {
          throw new TemplateNotFoundError(`Template not found: ${templatePath}`);
        }
      }
    }

    const applyRequires = schemaDef.apply?.requires;
    const cycle = detectCycle(schemaDef.artifacts, applyRequires);
    if (cycle !== null) {
      throw new CycleDetectedError(`Cycle detected: ${cycle.join(' → ')}`);
    }

    return {
      artifactId: schemaDef.name,
      passed: errors.length === 0,
      errors,
      warnings,
    };
  }
}

/**
 * Detect cycles in the artifact dependency graph.
 *
 * Uses DFS to traverse `requires` edges (including `apply.requires`) and reports
 * the first back-edge cycle found.
 *
 * @param artifacts      Array of artifact definitions.
 * @param applyRequires  Optional `apply.requires` array from the schema definition.
 * @returns The cycle path (including the repeated start node) or `null` if acyclic.
 */
export function detectCycle(artifacts: ArtifactDef[], applyRequires?: string[]): string[] | null {
  const adj = new Map<string, string[]>();
  for (const art of artifacts) {
    adj.set(art.id, art.requires);
  }
  if (applyRequires !== undefined && applyRequires.length > 0) {
    adj.set('apply', applyRequires);
  }

  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  const parent = new Map<string, string | null>();

  for (const id of adj.keys()) {
    color.set(id, WHITE);
    parent.set(id, null);
  }

  function dfs(node: string): string[] | null {
    color.set(node, GRAY);
    const neighbors = adj.get(node) ?? [];
    for (const next of neighbors) {
      if (!adj.has(next)) {
        continue;
      }
      const nextColor = color.get(next);
      if (nextColor === GRAY) {
        const cycle: string[] = [next];
        let cur: string | null = node;
        while (cur !== null && cur !== next) {
          cycle.push(cur);
          cur = parent.get(cur) ?? null;
        }
        cycle.push(next);
        return cycle.reverse();
      }
      if (nextColor === WHITE) {
        parent.set(next, node);
        const result = dfs(next);
        if (result !== null) {return result;}
      }
    }
    color.set(node, BLACK);
    return null;
  }

  for (const id of adj.keys()) {
    if (color.get(id) === WHITE) {
      const result = dfs(id);
      if (result !== null) {return result;}
    }
  }
  return null;
}

/**
 * Return the current CLI version.
 *
 * Reads the version from the nearest package.json relative to this module.
 */
function getCliVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { version?: string };
    return pkg.version ?? '0.1.0';
  } catch {
    console.warn('[SchemaEngine] Failed to read package.json — falling back to default version 0.1.0.');
    return '0.1.0';
  }
}

/**
 * Resolve a template path relative to the schema directory.
 *
 * @param schemaDir  Absolute path to the schema directory.
 * @param template   Template path as declared in the schema (e.g. `templates/brief.md`).
 * @returns Absolute filesystem path to the template.
 */
export function resolveTemplatePath(schemaDir: string, template: string): string {
  return join(schemaDir, template);
}

/**
 * Interpolate generic `{{variable}}` placeholders in a text string.
 *
 * @param text    The template text.
 * @param context Object mapping variable names to values.
 * @returns The interpolated string.
 * @throws {AdabError} If a referenced variable is missing from the context.
 */
export function interpolateVariables(text: string, context: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in context)) {
      throw new UnresolvedVariableError(`Unresolved variable: {{${key}}}`);
    }
    return context[key];
  });
}

/**
 * Interpolate `{{config.*}}` placeholders using a project configuration object.
 *
 * @param text   The template text.
 * @param config The project configuration.
 * @returns The interpolated string.
 * @throws {AdabError} If a referenced config path does not exist.
 */
export function interpolateConfigVariables(text: string, config: ProjectConfig): string {
  return text.replace(/\{\{config\.([\w.]+)\}\}/g, (_match, path: string) => {
    const keys = path.split('.');
    let value: unknown = config;
    for (const key of keys) {
      if (value === null || typeof value !== 'object') {
        throw new UnresolvedVariableError(`Unresolved config variable: {{config.${path}}}`);
      }
      value = (value as Record<string, unknown>)[key];
      if (value === undefined || value === null) {
        throw new UnresolvedVariableError(`Unresolved config variable: {{config.${path}}}`);
      }
    }
    return String(value);
  });
}
