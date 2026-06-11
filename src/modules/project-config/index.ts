/**
 * Project Config Module — loads, validates, writes, and queries `adab/config.yaml`.
 */
import { join } from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { ProjectConfigSchema, type ProjectConfig } from '../../schemas/project-config.js';
import { ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir } from '../../utils/fs.js';

/**
 * Loads and validates `adab/config.yaml` from a project root.
 */
export class ConfigLoader {
  private readonly configPath: string;
  private config: ProjectConfig | null = null;

  /**
   * @param projectRoot Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.configPath = join(projectRoot, 'adab', 'config.yaml');
  }

  /**
   * Load and validate the project configuration.
   *
   * Parses YAML, validates against the zod {@link ProjectConfigSchema},
   * and applies all default values.
   *
   * @returns The validated project configuration.
   * @throws {ConfigValidationError} If the file is missing, malformed, or invalid.
   */
  async load(): Promise<ProjectConfig> {
    const raw = await safeReadFile(this.configPath);
    if (raw === null) {
      throw new ConfigValidationError(`Config file not found: ${this.configPath}`);
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new ConfigValidationError(`Failed to parse config YAML: ${msg}`, { cause: err });
    }
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Config validation failed: ${issues}`);
    }
    this.warnUnknownFields(parsed as Record<string, unknown>, ProjectConfigSchema, 'config');
    this.config = result.data;
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
          console.warn(`[ConfigLoader] Unknown config field: ${prefix ? `${prefix}.` : ''}${key}`);
        } else if (obj[key] !== null && typeof obj[key] === 'object' && !Array.isArray(obj[key])) {
          this.warnUnknownFields(obj[key] as Record<string, unknown>, shape[key], `${prefix ? `${prefix}.` : ''}${key}`);
        }
      }
    }
  }

  /**
   * Return the currently active schema name.
   */
  getActiveSchema(): string {
    this.ensureLoaded();
    return this.config!.schema;
  }

  /**
   * Return the rule list for a given artifact ID.
   *
   * @param artifactId The artifact identifier (e.g. `draft`).
   * @returns Array of rule strings, or an empty array if none are defined.
   */
  getRules(artifactId: string): string[] {
    this.ensureLoaded();
    return this.config!.rules[artifactId] ?? [];
  }

  /**
   * Return the global maximum token budget.
   */
  getMaxTokens(): number {
    this.ensureLoaded();
    return this.config!.context.maxTokens;
  }

  /**
   * Return the list of files that should always be included in context.
   */
  getAlwaysInclude(): string[] {
    this.ensureLoaded();
    return this.config!.context.alwaysInclude;
  }

  /**
   * Return the project language from the loaded config, or `'zh-CN'` as default.
   */
  getLanguage(): string {
    this.ensureLoaded();
    return this.config!.project.language;
  }

  /**
   * Return the context token heuristic, or `'chars-per-token'` as default.
   */
  getTokenHeuristic(): string {
    this.ensureLoaded();
    return this.config!.context.tokenHeuristic;
  }

  private ensureLoaded(): void {
    if (this.config === null) {
      throw new ConfigValidationError('Config has not been loaded. Call load() first.');
    }
  }
}

/**
 * Writes project configuration back to `adab/config.yaml`.
 */
export class ConfigWriter {
  private readonly configPath: string;

  /**
   * @param projectRoot Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.configPath = join(projectRoot, 'adab', 'config.yaml');
  }

  /**
   * Write a validated configuration object to disk as YAML.
   *
   * @param config The configuration to persist.
   */
  async write(config: ProjectConfig): Promise<void> {
    const yamlString = YAML.stringify(config, { indent: 2, lineWidth: 0 });
    await ensureDir(join(this.configPath, '..'));
    await atomicWriteFile(this.configPath, yamlString);
  }

  /**
   * Set a nested config value by dot-path and write the result.
   *
   * Supports both dot notation (`project.title`) and bracket-index notation
   * (`context.alwaysInclude[0]`, `rules.draft[2]`). Intermediate objects and
   * arrays are created on demand, and any existing intermediate containers
   * whose type does not match the path shape (e.g. a plain object where the
   * next key is numeric) are replaced with the correct container.
   *
   * After mutation, the resulting object is re-validated against
   * {@link ProjectConfigSchema}. If validation fails, no file write occurs and
   * a {@link ConfigValidationError} is thrown.
   *
   * @param path  Dot-separated path with optional `[N]` array index segments.
   * @param value The new value to assign at the resolved location.
   * @throws {ConfigValidationError} If the config file is missing, the path
   *         cannot be resolved, or the resulting config fails schema
   *         validation.
   */
  async set(path: string, value: unknown): Promise<void> {
    const raw = await safeReadFile(this.configPath);
    if (raw === null) {
      throw new ConfigValidationError(`Config file not found: ${this.configPath}`);
    }
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    const keys = parseConfigPath(path);
    setIn(parsed, keys, value);
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Config validation failed after set: ${issues}`);
    }
    await this.write(result.data);
  }
}

/**
 * Parse a dot-and-bracket config path into a flat list of string and number
 * segments.
 *
 * Recognized shapes:
 *   - `a.b.c`           → `['a', 'b', 'c']`
 *   - `a[0].b`          → `['a', 0, 'b']`
 *   - `a.alwaysInclude[0]` → `['a', 'alwaysInclude', 0]`
 *   - `a[0][1]`         → `['a', 0, 1]`
 *
 * The split uses a lookahead at `[` so that bracket indices remain attached
 * to their preceding key (e.g. `alwaysInclude[0]` is kept as a single
 * token), and a secondary regex peels the bracket index off the key so the
 * result is always a flat array.
 *
 * @param path The user-supplied path string.
 * @returns A flat list of segments; string for object keys, number for
 *          array indices.
 */
function parseConfigPath(path: string): Array<string | number> {
  return path.split(/\.|(?=\[)/).flatMap((segment) => {
    const match = /^\[(\d+)\]$/.exec(segment);
    if (match) {
      return [parseInt(match[1], 10)];
    }
    const bracketMatch = /^(.+?)\[(\d+)\]$/.exec(segment);
    if (bracketMatch) {
      return [bracketMatch[1], parseInt(bracketMatch[2], 10)];
    }
    return [segment];
  });
}

/**
 * Determine the appropriate empty container (plain object or array) to use
 * when creating a missing intermediate node on the way to a deeper key.
 *
 * @param nextKey The key that will be traversed into next. Numbers imply an
 *                array; anything else implies an object.
 * @returns A fresh `[]` when the next key is a number, otherwise a fresh
 *          `{}`.
 */
function emptyContainerFor(nextKey: string | number): Record<string, unknown> | unknown[] {
  return typeof nextKey === 'number' ? [] : {};
}

/**
 * Test whether a value is a usable plain object (non-null, non-array) that
 * can be indexed with string keys.
 *
 * @param value The value to test.
 * @returns True when the value is a non-null object that is not an array.
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Test whether a value is a real array (i.e. not null and not a plain
 * object).
 *
 * @param value The value to test.
 * @returns True when the value is a JavaScript array.
 */
function isArray(value: unknown): value is unknown[] {
  return Array.isArray(value);
}

/**
 * Mutate an object (or array) in place to set a value at a nested key path,
 * creating intermediate containers as needed and replacing any existing
 * intermediate whose type does not match the next key.
 *
 * Walks the key path one segment at a time, carrying an explicit `parent`
 * reference so that newly created sub-objects and sub-arrays are written
 * back to their parent (this is the bug that the previous local-variable
 * implementation had). For numeric keys whose index is at or beyond the
 * parent's length, the array is padded with empty strings so that the
 * resulting value remains a valid `string[]` per the project config schema.
 *
 * @param root  The object (or array) to mutate in place.
 * @param keys  The flat list of segments produced by {@link parseConfigPath}.
 * @param value The value to assign at the final key.
 */
function setIn(root: Record<string, unknown> | unknown[], keys: Array<string | number>, value: unknown): void {
  if (keys.length === 0) {
    return;
  }
  let parent: Record<string, unknown> | unknown[] = root;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    const nextKey = keys[i + 1];
    if (typeof key === 'number') {
      if (!isArray(parent)) {
        throw new ConfigValidationError(
          `Cannot traverse into numeric key [${key}]: parent is not an array`
        );
      }
      if (parent.length <= key || !isPlainObject(parent[key]) && !isArray(parent[key])) {
        parent[key] = emptyContainerFor(nextKey);
      }
      parent = parent[key] as Record<string, unknown> | unknown[];
    } else {
      if (!isPlainObject(parent)) {
        throw new ConfigValidationError(
          `Cannot traverse into key "${key}": parent is not an object`
        );
      }
      const existing = parent[key];
      if (!isPlainObject(existing) && !isArray(existing)) {
        parent[key] = emptyContainerFor(nextKey);
      }
      parent = parent[key] as Record<string, unknown> | unknown[];
    }
  }
  const lastKey = keys[keys.length - 1];
  if (typeof lastKey === 'number') {
    if (!isArray(parent)) {
      throw new ConfigValidationError(
        `Cannot assign numeric key [${lastKey}]: parent is not an array`
      );
    }
    while (parent.length < lastKey) {
      parent.push('');
    }
    parent[lastKey] = value;
  } else {
    if (!isPlainObject(parent)) {
      throw new ConfigValidationError(
        `Cannot assign key "${String(lastKey)}": parent is not an object`
      );
    }
    parent[lastKey] = value;
  }
}

/**
 * Resolve template variables of the form `{{config.project.pov}}`
 * against a loaded project configuration.
 *
 * @param template The template string containing `{{config.*}}` placeholders.
 * @param config   The project configuration object.
 * @returns The interpolated string.
 * @throws {ConfigValidationError} If a referenced config path does not exist.
 */
export function resolveVariable(template: string, config: ProjectConfig): string {
  return template.replace(/\{\{config\.([\w.]+)\}\}/g, (_match, path: string) => {
    const keys = path.split('.');
    let value: unknown = config;
    for (const key of keys) {
      if (value === null || typeof value !== 'object') {
        throw new ConfigValidationError(`Cannot resolve config variable: config.${path}`);
      }
      value = (value as Record<string, unknown>)[key];
      if (value === undefined) {
        throw new ConfigValidationError(`Cannot resolve config variable: config.${path}`);
      }
    }
    return String(value);
  });
}
