/**
 * Schema Engine — loads, validates, forks, and interpolates workflow schemas.
 */
import { existsSync } from 'node:fs';
import { readdir, readFile, copyFile } from 'node:fs/promises';
import { join , dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

import type { ProjectConfig } from '../../schemas/project-config.js';
import { SchemaDefSchema, type SchemaDef, type ArtifactDef } from '../../schemas/schema-def.js';
import type { ValidationResult } from '../../schemas/types.js';
import { SchemaValidationError, CycleDetectedError, UnresolvedVariableError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';
import { resolveBuiltInSchemasDir } from '../../utils/resource-paths.js';

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
   * Returns an empty array when the built-in schemas directory cannot be
   * located (e.g. in a stripped-down distribution) or when the directory
   * has been removed between path resolution and readdir. I/O errors other
   * than the directory being missing — most notably permission denied
   * (EACCES) — are logged via `console.warn` and then propagated to the
   * caller, since silently swallowing them would mask real failures and
   * make the CLI report "no schemas available" when the actual problem
   * is a broken installation or misconfigured filesystem.
   *
   * @param activeSchema Optional name of the currently active schema; the
   *                     matching entry will be tagged with ` [active]`.
   * @returns Array of built-in schema directory names (possibly empty).
   */
  async listBuiltInSchemas(activeSchema?: string): Promise<string[]> {
    let builtInDir: string;
    try {
      builtInDir = resolveBuiltInSchemasDir(import.meta.url);
    } catch {
      return [];
    }
    if (!existsSync(builtInDir)) {
      return [];
    }
    try {
      const entries = await readdir(builtInDir, { withFileTypes: true });
      return entries
        .filter((d) => d.isDirectory())
        .map((d) => (d.name === activeSchema ? `${d.name} [active]` : d.name));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return [];
      }
      // SC-9: log unknown I/O errors before re-throwing so operators can
      // diagnose issues that are NOT just "the directory happens to be
      // missing" (e.g. EACCES, EMFILE).
      console.warn(
        `[SchemaEngine] Failed to list built-in schemas at "${builtInDir}": ${
          err instanceof Error ? err.message : String(err)
        }`
      );
      throw err;
    }
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
   * `forked_from` metadata into the copied `schema.yaml`.  The destination
   * directory must NOT already exist — forking is a one-shot copy that
   * silently overwriting would surprise the user (existing forks could
   * have local edits that would be lost).
   *
   * @param baseName Name of the built-in schema to fork.
   * @param newName  Name for the new schema copy.
   * @throws {SchemaValidationError} If the base schema does not exist, or
   *                                  if a schema with `newName` already
   *                                  exists in the destination.
   */
  async forkSchema(baseName: string, newName: string): Promise<void> {
    const builtInDir = resolveBuiltInSchemasDir(import.meta.url);
    const srcDir = join(builtInDir, baseName);
    if (!(await fileExists(srcDir))) {
      const available = await this.listBuiltInSchemas();
      throw new SchemaValidationError(
        `Schema '${baseName}' not found. Available: ${available.join(', ') || 'none'}`
      );
    }
    const destDir = join(this.schemaDir, newName);
    // SC-2: refuse to fork over an existing destination.
    if (await fileExists(destDir)) {
      throw new SchemaValidationError(
        `Schema '${newName}' already exists at ${destDir}. Refusing to overwrite.`
      );
    }
    await ensureDir(destDir);
    await this.copyDirContents(srcDir, destDir);

    const schemaPath = join(destDir, 'schema.yaml');
    const raw = await safeReadFile(schemaPath);
    if (raw !== null) {
      const parsed = YAML.parse(raw) as Record<string, unknown>;
      parsed.forked_from = baseName;
      parsed.forked_version = await getCliVersion();
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
   * Checks: artifact ID uniqueness, `apply.requires` referencing valid
   * artifact IDs, and template file existence.  `name` and `version` are
   * guaranteed by the zod {@link SchemaDefSchema} that produced
   * `schemaDef`, so they are not re-checked here.
   *
   * @param schemaDef  The schema definition to validate.
   * @param schemaDir  Optional absolute path to the schema directory for template existence checks.
   * @returns A {@link import('../../schemas/types.js').ValidationResult ValidationResult}.
   */
  async validate(schemaDef: SchemaDef, schemaDir?: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

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
          // SC-1: report missing template as a structured validation error
          // (consistent with the "unknown artifact" behaviour) instead of
          // throwing.  Callers that prefer a hard failure can inspect
          // `result.passed`.
          errors.push(`Template not found: ${templatePath}`);
        }
      }
    }

    const applyRequires = schemaDef.apply?.requires;
    // SchemaValidator already surfaces "unknown artifact ID" errors above
    // for both artifact.requires and apply.requires, so detectCycle runs
    // in its pure-graph form here.  Callers that need detectCycle to
    // also flag unknown references can pass `knownIds` explicitly.
    const cycle = detectCycle(deduplicatedArtifacts, applyRequires);
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
 * the first back-edge cycle found.  References to nodes not in `knownIds`
 * (when supplied) are reported as a `CycleDetectedError` whose message
 * enumerates the missing IDs; the synthetic `apply` virtual node used to
 * model `apply.requires` is stripped from the reported cycle path so that
 * downstream error messages are meaningful.
 *
 * @param artifacts      Array of artifact definitions.
 * @param applyRequires  Optional `apply.requires` array from the schema definition.
 * @param knownIds       Optional set of valid artifact IDs.  When provided,
 *                       any `requires` reference absent from the set is
 *                       treated as a hard error (typically because the
 *                       caller wants to surface unknown references that
 *                       its own validation pass already collected).
 * @returns The cycle path (including the repeated start node) or `null` if acyclic.
 * @throws {CycleDetectedError} If `knownIds` is provided and any reference
 *                              targets an ID outside the set.
 */
export function detectCycle(
  artifacts: ArtifactDef[],
  applyRequires?: string[],
  knownIds?: ReadonlySet<string>
): string[] | null {
  // SC-4: when a known-id set is provided, surface unknown references as
  // an explicit error before even running the cycle algorithm.
  if (knownIds !== undefined) {
    const missing: string[] = [];
    for (const art of artifacts) {
      for (const req of art.requires) {
        if (!knownIds.has(req)) {
          missing.push(req);
        }
      }
    }
    if (applyRequires !== undefined) {
      for (const req of applyRequires) {
        if (!knownIds.has(req)) {
          missing.push(req);
        }
      }
    }
    if (missing.length > 0) {
      throw new CycleDetectedError(
        `Unknown artifact references: ${Array.from(new Set(missing)).join(', ')}`
      );
    }
  }

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
        // SC-10: strip the synthetic "apply" virtual node from the
        // reported cycle path so error messages name only real artifacts.
        const filtered = cycle.filter((id) => id !== 'apply');
        return filtered.reverse();
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
 * Reads the version from the nearest `package.json` relative to this module.
 */
async function getCliVersion(): Promise<string> {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'package.json');
    const raw = await readFile(pkgPath, 'utf-8');
    const pkg = JSON.parse(raw) as { version?: string };
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
 * Missing variables are collected first; if any are unresolved a single
 * {@link UnresolvedVariableError} is thrown listing every missing name.
 * Non-string context values (number/boolean) are coerced to their string
 * representation.
 *
 * @param text    The template text.
 * @param context Object mapping variable names to values.
 * @returns The interpolated string.
 * @throws {UnresolvedVariableError} If any referenced variable is missing from the context.
 */
export function interpolateVariables(text: string, context: Record<string, unknown>): string {
  const missing = new Set<string>();
  const result = text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    if (!(key in context)) {
      missing.add(key);
      return `{{${key}}}`;
    }
    return String(context[key]);
  });
  if (missing.size > 0) {
    const names = Array.from(missing).map((k) => `{{${k}}}`).join(', ');
    throw new UnresolvedVariableError(`Unresolved variable(s): ${names}`);
  }
  return result;
}

/**
 * Interpolate `{{config.*}}` placeholders using a project configuration object.
 *
 * @param text   The template text.
 * @param config The project configuration.
 * @returns The interpolated string.
 * @throws {UnresolvedVariableError} If a referenced config path does not exist
 *                                   or cannot be drilled into further.
 */
export function interpolateConfigVariables(text: string, config: ProjectConfig): string {
  return text.replace(/\{\{config\.([\w.]+)\}\}/g, (_match, path: string) => {
    const keys = path.split('.');
    let value: unknown = config;
    for (const key of keys) {
      if (value === null || (typeof value !== 'object' && typeof value !== 'function')) {
        throw new UnresolvedVariableError(`Unresolved config variable: {{config.${path}}}`);
      }
      const next = (value as Record<string, unknown>)[key];
      if (next === undefined || next === null) {
        throw new UnresolvedVariableError(`Unresolved config variable: {{config.${path}}}`);
      }
      value = next;
    }
    return String(value);
  });
}
