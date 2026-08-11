/**
 * Project Config Module — loads, validates, writes, and queries `adab/config.yaml`.
 */
import { homedir } from 'node:os';
import { join, relative, isAbsolute, sep } from 'node:path';

import YAML from 'yaml';
import { z } from 'zod';

import { ProjectConfigSchema, type ProjectConfig } from '../../schemas/project-config.js';
import { ConfigValidationError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir } from '../../utils/fs.js';
import { redactConfigValue } from '../../utils/redact.js';
import { LogWriter } from '../log/index.js';

/**
 * Top-level config keys that {@link resolveVariable} is allowed to walk into.
 *
 * The project config schema uses `.passthrough()` so unknown top-level keys
 * survive validation (forward compatibility for user custom fields). The
 * whitelist below decouples template variable resolution from passthrough:
 * a `{{config.<key>.*}}` placeholder MUST start with one of these keys, so
 * arbitrary passthrough data can never be exfiltrated through a template.
 */
const RESOLVABLE_TOP_LEVEL_KEYS: ReadonlySet<string> = new Set([
  'schema',
  'version',
  'project',
  'context',
  'rules',
  'archive',
]);

/**
 * Render a filesystem path in a privacy-preserving form for error messages.
 *
 * Absolute paths can disclose user account names (e.g. `C:\Users\Alice\...`)
 * and full project layouts. This helper:
 *   1. Tries to express the path relative to the current working directory.
 *   2. Falls back to a path relative to the user's home directory.
 *   3. As a last resort, replaces the absolute path with the literal
 *      `adab/config.yaml` so the user still sees which file failed but the
 *      surrounding directory layout is not leaked.
 *
 * @param absolutePath The path to render.
 * @returns A redacted, relative-style path string.
 */
function toDisplayPath(absolutePath: string): string {
  if (!isAbsolute(absolutePath)) {
    return absolutePath;
  }
  const cwd = process.cwd();
  if (absolutePath.startsWith(cwd + sep) || absolutePath === cwd) {
    const rel = relative(cwd, absolutePath);
    if (rel && !rel.startsWith('..')) {
      return rel;
    }
  }
  const home = homedir();
  if (home && absolutePath.startsWith(home + sep)) {
    return `~${  sep  }${relative(home, absolutePath)}`;
  }
  return `adab${  sep  }config.yaml`;
}

/**
 * Loads and validates `adab/config.yaml` from a project root.
 */
export class ConfigLoader {
  private readonly projectRoot: string;
  private readonly configPath: string;
  private config: ProjectConfig | null = null;

  /**
   * @param projectRoot Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
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
      throw new ConfigValidationError(`Config file not found: ${toDisplayPath(this.configPath)}`);
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
      const suggestion = suggestValidValues(result.error.issues);
      throw new ConfigValidationError(`Config validation failed: ${issues}${suggestion}`);
    }
    this.warnUnknownFields(parsed, ProjectConfigSchema, 'config');
    this.config = result.data;
    return result.data;
  }

  /**
   * Walk a zod schema to collect the legal enum values for a given
   * dotted field path inside the project config.
   *
   * Used to enrich validation error messages with a list of accepted
   * values, e.g. `Valid POV modes: first-person, limited-third,
   * omniscient-third`.
   *
   * @param path Dotted field path (e.g. `project.pov`).
   * @returns Array of valid values, or `null` if the path does not land on
   *          an enum schema.
   */
  /**
   * Walk the config schema to find the allowed values of an enum field at
   * `path` (e.g. `project.pov`), unwrapping `ZodDefault`/`ZodOptional`/
   * `ZodNullable`/`ZodEffects` wrappers along the way.
   *
   * @param path Dot-separated config path to the enum field.
   * @returns The enum's allowed values, or `null` when the path does not
   *          resolve to an enum.
   */
  collectEnumValues(path: string): string[] | null {
    const segments = path.split('.');
    let schema: z.ZodType<unknown> = ProjectConfigSchema;
    for (const segment of segments) {
      // The config schema wraps every nested object and enum field in
      // `.default(...)` (ZodDefault) and uses `.passthrough()` objects, so
      // the walker must look through the wrappers before it can see the
      // next object shape or the final enum.
      schema = this.unwrapSchema(schema);
      if (!(schema instanceof z.ZodObject)) {
        return null;
      }
      const shape = schema.shape as Record<string, z.ZodType<unknown>>;
      // `shape` is typed as a full record, but passthrough objects can
      // lack the segment at runtime — check presence explicitly so the
      // walker returns null instead of indexing a missing key.
      if (!Object.prototype.hasOwnProperty.call(shape, segment)) {
        return null;
      }
      const next = shape[segment];
      schema = next;
    }
    schema = this.unwrapSchema(schema);
    if (schema instanceof z.ZodEnum) {
      return Array.from(schema._def.values as readonly string[]);
    }
    return null;
  }

  /**
   * Recursively unwrap a zod schema, peeling off wrapper types that have
   * no impact on the user-visible field shape (`ZodDefault`,
   * `ZodOptional`, `ZodNullable`, `ZodEffects`).
   *
   * Field-level wrappers are used liberally in the project config schema
   * (e.g. `project: z.object({...}).default({...})`), so the unknown-field
   * detector and the enum-value walker must look through them to find the
   * underlying `ZodObject`, `ZodRecord`, or `ZodArray` (or the final
   * `ZodEnum`) before deciding whether the current value is structured.
   *
   * @param schema A zod schema that may be wrapped.
   * @returns The innermost non-wrapper schema. If the input is already a
   *          structural schema it is returned unchanged.
   */
  private unwrapSchema(schema: z.ZodType<unknown>): z.ZodType<unknown> {
    let current: z.ZodType<unknown> = schema;
    while (true) {
      if (
        current instanceof z.ZodDefault ||
        current instanceof z.ZodOptional ||
        current instanceof z.ZodNullable
      ) {
        current = (current as z.ZodDefault<z.ZodType<unknown>>)._def.innerType;
        continue;
      }
      if (current instanceof z.ZodEffects) {
        current = current._def.schema as z.ZodType<unknown>;
        continue;
      }
      break;
    }
    return current;
  }

  /**
   * Warn about keys present in the raw object that are not defined in the zod schema.
   *
   * Recurses into nested object shapes, into `ZodRecord` values whose value
   * type is itself a `ZodObject`, and into `ZodArray` elements that are
   * `ZodObject` instances. Field-level wrappers (`ZodDefault`,
   * `ZodOptional`) are peeled off before the structural type check so
   * that nested detection works regardless of how the field is declared
   * at the parent level. Non-object inputs (e.g. when YAML parses to
   * `null` or a scalar) are handled by returning early instead of
   * throwing `TypeError: Cannot convert undefined or null to object`.
   *
   * @param obj    Raw parsed object (may be `null`, a scalar, or an array).
   * @param schema Zod schema describing the expected shape at `obj`.
   * @param prefix Dot-path prefix for nested keys.
   */
  private warnUnknownFields(obj: unknown, schema: z.ZodType<unknown>, prefix = ''): void {
    if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) {
      return;
    }
    const unwrapped = this.unwrapSchema(schema);
    if (unwrapped instanceof z.ZodObject) {
      const shape = unwrapped.shape as Record<string, z.ZodType<unknown>>;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (!(key in shape)) {
          // eslint-disable-next-line no-console
          console.warn(`[ConfigLoader] Unknown config field: ${prefix ? `${prefix}.` : ''}${key}`);
        } else if (value !== null && typeof value === 'object') {
          this.warnUnknownFields(value, shape[key], `${prefix ? `${prefix}.` : ''}${key}`);
        }
      }
      return;
    }
    if (unwrapped instanceof z.ZodRecord) {
      const valueSchema = unwrapped._def.valueType as z.ZodType<unknown>;
      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          this.warnUnknownFields(value, valueSchema, `${prefix ? `${prefix}.` : ''}${key}`);
        }
      }
      return;
    }
    if (unwrapped instanceof z.ZodArray) {
      const elementSchema = unwrapped._def.type as z.ZodType<unknown>;
      for (const value of obj as unknown[]) {
        if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
          this.warnUnknownFields(value, elementSchema, prefix);
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
   * Return the project language from the loaded config.
   *
   * The zod schema applies a default of `'zh-CN'` when the field is missing,
   * so the returned value is always one of the declared enum members.
   */
  getLanguage(): string {
    this.ensureLoaded();
    return this.config!.project.language;
  }

  /**
   * Return the context token heuristic.
   *
   * The zod schema applies a default of `'chars-per-token'` when the field
   * is missing.
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
  private readonly projectRoot: string;
  private readonly configPath: string;

  /**
   * @param projectRoot Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
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
   * Set a nested config value by dot-path, persist, and audit-log.
   *
   * Supports both dot notation (`project.title`) and bracket-index notation
   * (`context.alwaysInclude[0]`, `rules.draft[2]`). Intermediate objects and
   * arrays are created on demand, and any existing intermediate containers
   * whose type does not match the path shape (e.g. a plain object where the
   * next key is numeric) are replaced with the correct container.
   *
   * After mutation, the resulting object is re-validated against
   * {@link ProjectConfigSchema}. If validation fails, no file write occurs
   * and a {@link ConfigValidationError} is thrown.
   *
   * On a successful write, an `update` entry is appended to `adab/log.md`
   * with the changed path and a redacted value (secrets are masked through
   * {@link redactConfigValue} so credentials never land in the audit log).
   *
   * @param path  Dot-separated path with optional `[N]` array index segments,
   *              or bare numeric segments (e.g. `context.alwaysInclude.0`).
   * @param value The new value to assign at the resolved location.
   * @throws {ConfigValidationError} If the config file is missing, the path
   *         cannot be resolved, or the resulting config fails schema
   *         validation.
   */
  async set(path: string, value: unknown): Promise<void> {
    const raw = await safeReadFile(this.configPath);
    if (raw === null) {
      throw new ConfigValidationError(`Config file not found: ${toDisplayPath(this.configPath)}`);
    }
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    const keys = parseConfigPath(path);
    setIn(parsed, keys, value);
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      const suggestion = suggestValidValuesForPath(result.error.issues, path);
      throw new ConfigValidationError(`Config validation failed after set: ${issues}${suggestion}`);
    }
    await this.write(result.data);
    const logValue = redactConfigValue(path, value);
    const logWriter = new LogWriter(this.projectRoot);
    await logWriter.append({
      ts: new Date().toISOString(),
      op: 'update',
      change: null,
      result: 'success',
      details: { path, value: logValue },
    });
  }
}

/**
 * Build a `Valid values: ...` suffix for an unknown-field validation issue.
 *
 * When any of the issues refer to an enum field whose allowed values can be
 * discovered by walking the project config schema, this returns a comma
 * separated list. Otherwise returns an empty string.
 *
 * @param issues Zod issues from the failed parse.
 * @returns Suffix string (including a leading space) or empty.
 */
function suggestValidValues(issues: readonly z.ZodIssue[]): string {
  for (const issue of issues) {
    const path = issue.path.map(String).join('.');
    if (!path) {continue;}
    const loader = new ConfigLoader(process.cwd());
    const values = loader.collectEnumValues(path);
    if (values !== null && values.length > 0) {
      return ` (Valid values: ${values.join(', ')})`;
    }
  }
  return '';
}

/**
 * Build a `Valid values: ...` suffix targeted at a user-supplied path.
 *
 * Used by `ConfigWriter.set` so the user can see the legal alternatives
 * for the value they just attempted to write, regardless of whether the
 * zod issue path exactly matches the user path (zod paths are zero-based
 * on the top-level object, while CLI paths are dotted strings).
 *
 * @param issues    Zod issues from the failed parse.
 * @param userPath  The dotted path the user supplied to `set`.
 * @returns Suffix string (including a leading space) or empty.
 */
function suggestValidValuesForPath(
  issues: readonly z.ZodIssue[],
  userPath: string
): string {
  const directValues = new ConfigLoader(process.cwd()).collectEnumValues(userPath);
  if (directValues !== null && directValues.length > 0) {
    return ` (Valid values: ${directValues.join(', ')})`;
  }
  for (const issue of issues) {
    const path = issue.path.map(String).join('.');
    if (!path) {continue;}
    const values = new ConfigLoader(process.cwd()).collectEnumValues(path);
    if (values !== null && values.length > 0) {
      return ` (Valid values: ${values.join(', ')})`;
    }
  }
  return '';
}

/**
 * Parse a dot-and-bracket config path into a flat list of string and number
 * segments.
 *
 * Recognized shapes:
 *   - `a.b.c`             → `['a', 'b', 'c']`
 *   - `a[0].b`            → `['a', 0, 'b']`
 *   - `a.b[0]`            → `['a', 'b', 0]`
 *   - `a.0.b`             → `['a', 0, 'b']`   (bare numeric segment)
 *   - `a[0][1]`           → `['a', 0, 1]`
 *
 * A bare numeric segment (`a.0.b`) is treated as an array index so users
 * do not have to type brackets for every positional update. Mixed paths
 * like `rules.draft.0` work the same as `rules.draft[0]`.
 *
 * @param path The user-supplied path string.
 * @returns A flat list of segments; string for object keys, number for
 *          array indices.
 */
function parseConfigPath(path: string): (string | number)[] {
  return path.split(/\.|(?=\[)/).flatMap((segment) => {
    const match = /^\[(\d+)\]$/.exec(segment);
    if (match) {
      return [parseInt(match[1], 10)];
    }
    const bracketMatch = /^([^[\]]+)\[(\d+)\]$/.exec(segment);
    if (bracketMatch) {
      return [bracketMatch[1], parseInt(bracketMatch[2], 10)];
    }
    if (/^\d+$/.test(segment)) {
      return [parseInt(segment, 10)];
    }
    // Any leftover bracket means a malformed index segment (`a[0`, `a[]`,
    // `a[-1]`, `a[1.5]`).  Without this check such paths are silently
    // accepted as literal object keys (e.g. `a['[0']`) instead of failing
    // loudly as usage errors.
    if (/[[\]]/.test(segment)) {
      throw new ConfigValidationError(
        `Invalid config path "${path}": segment "${segment}" has a malformed [N] array index`
      );
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
 * back to their parent.
 *
 * For numeric keys, the target index MUST be at most `parent.length`; any
 * gap would silently insert empty strings into the array, which both
 * corrupts the user-visible list and is a likely indicator of a typo
 * (the user meant to set an adjacent slot). The schema also rejects empty
 * strings, but relying on schema validation alone hides the problem from
 * the user. We throw a {@link ConfigValidationError} up front instead.
 * This applies both to the FINAL key and to every intermediate numeric
 * segment — `foo[5].bar` on an empty array would otherwise create five
 * array holes before the traversal even reaches `bar`.
 *
 * @param root  The object (or array) to mutate in place.
 * @param keys  The flat list of segments produced by {@link parseConfigPath}.
 * @param value The value to assign at the final key.
 * @throws {ConfigValidationError} When the numeric index is beyond
 *         `parent.length` (would create empty string padding slots).
 */
function setIn(root: Record<string, unknown> | unknown[], keys: (string | number)[], value: unknown): void {
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
      if (parent.length < key) {
        throw new ConfigValidationError(
          `Array index [${String(key)}] is out of range (length is ${String(parent.length)}); ` +
          `set indices sequentially to avoid silent "" padding`
        );
      }
      if (!isPlainObject(parent[key]) && !isArray(parent[key])) {
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
    if (lastKey > parent.length) {
      throw new ConfigValidationError(
        `Array index [${lastKey}] is out of range (length is ${parent.length}); ` +
        `set indices sequentially to avoid silent "" padding`
      );
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
 * Resolve template variables of the form `{{config.<key>.<sub>...}}`
 * against a loaded project configuration.
 *
 * Only the committed top-level keys (`schema`, `version`, `project`,
 * `context`, `rules`, `archive`) are reachable. A `{{config.<other>.*}}`
 * placeholder — even when the `<other>` key exists in the config because
 * the schema uses `.passthrough()` — is rejected with a
 * {@link ConfigValidationError}. This prevents passthrough fields from
 * being read through templates, which is a separation-of-concerns
 * guarantee rather than a security claim (the config is local and the
 * user can read it directly anyway), and it surfaces schema drift
 * immediately during template rendering.
 *
 * @param template The template string containing `{{config.*}}` placeholders.
 * @param config   The project configuration object.
 * @returns The interpolated string.
 * @throws {ConfigValidationError} If a referenced config path is not in
 *         the whitelisted top-level set, does not exist, or cannot be
 *         drilled into.
 */
export function resolveVariable(template: string, config: ProjectConfig): string {
  return template.replace(/\{\{config\.([\w.]+)\}\}/g, (_match, path: string) => {
    const keys = path.split('.');
    const topKey = keys[0];
    if (topKey === undefined || !RESOLVABLE_TOP_LEVEL_KEYS.has(topKey)) {
      throw new ConfigValidationError(`Cannot resolve config variable: config.${path}`);
    }
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
