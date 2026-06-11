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
   * @param path  Dot-separated path (e.g. `project.title`).
   * @param value The new value.
   * @throws {ConfigValidationError} If the path is invalid or the resulting config fails validation.
   */
  async set(path: string, value: unknown): Promise<void> {
    const raw = await safeReadFile(this.configPath);
    if (raw === null) {
      throw new ConfigValidationError(`Config file not found: ${this.configPath}`);
    }
    const parsed = YAML.parse(raw) as Record<string, unknown>;
    // Parse path segments supporting both dot notation and array index notation
    const keys = path.split(/\.|(?=\[)/).map((s) => {
      const match = /^\[(\d+)\]$/.exec(s);
      if (match) {
        return parseInt(match[1], 10);
      }
      // Also handle trailing [N] after a key like "alwaysInclude[0]"
      const bracketMatch = /^(.+?)\[(\d+)\]$/.exec(s);
      if (bracketMatch) {
        return [bracketMatch[1], parseInt(bracketMatch[2], 10)] as [string, number];
      }
      return s;
    }).flat();

    let target: Record<string, unknown> | unknown[] = parsed;
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i];
      if (typeof k === 'number') {
        if (!Array.isArray(target)) {
          target = [];
        }
        if ((target as unknown[]).length <= k) {
          while ((target as unknown[]).length <= k) {
            (target as unknown[]).push({});
          }
        }
        target = (target as unknown[])[k] as unknown as Record<string, unknown> | unknown[];
      } else if (typeof target !== 'object' || target === null) {
        target = {} as Record<string, unknown>;
        target = (target as Record<string, unknown>)[k] = {};
      } else {
        const next = (target as Record<string, unknown>)[k];
        if (typeof next !== 'object' || next === null) {
          (target as Record<string, unknown>)[k] = {};
        }
        target = (target as Record<string, unknown>)[k] as Record<string, unknown>;
      }
    }

    const lastKey = keys[keys.length - 1];
    if (typeof lastKey === 'number') {
      if (!Array.isArray(target)) {
        target = [];
      }
      (target as unknown[])[lastKey] = value;
    } else {
      (target as Record<string, unknown>)[lastKey as string] = value;
    }

    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new ConfigValidationError(`Config validation failed after set: ${issues}`);
    }
    await this.write(result.data);
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
