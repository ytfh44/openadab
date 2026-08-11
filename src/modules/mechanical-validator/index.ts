/**
 * Mechanical Validator — runs deterministic, non-LLM validation checks on
 * artifact files, wiki links, chapter sequences, and project configuration.
 */
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import YAML from 'yaml';

import { ProjectConfigSchema } from '../../schemas/project-config.js';
import type { SchemaDef, ArtifactDef } from '../../schemas/schema-def.js';
import type { ValidationResult, ProjectConfig } from '../../schemas/types.js';
import { TargetNotFoundError } from '../../utils/errors.js';
import { safeReadFile, fileExists } from '../../utils/fs.js';
import { extractFrontmatter, extractWikiLinks } from '../../utils/markdown.js';
import type { WikiEngine } from '../wiki-engine/index.js';


/**
 * Per-artifact mechanical validation rules derived from schema.
 */
export interface MechanicalRules {
  /** Minimum word count (inclusive). */
  minWords?: number;
  /** Maximum word count (inclusive). */
  maxWords?: number;
  /** Whether frontmatter must be present. */
  requireFrontmatter?: boolean;
  /** Whether file must be non-empty. */
  requireNonEmpty?: boolean;
  /** Specific frontmatter fields that must be present (from `requireField:<name>` rules). */
  requiredFields?: string[];
}

/**
 * Runs deterministic mechanical validation on artifacts and project state.
 */
export class MechanicalValidator {
  private readonly schemaEngine: { load: () => Promise<SchemaDef> } | undefined;
  private readonly projectConfig: ProjectConfig | undefined;
  private readonly wikiEngine: WikiEngine | undefined;
  private readonly projectRoot: string;
  /**
   * Per-`validateChange`-call cache for the loaded schema. Populated lazily on
   * the first `getSchema()` invocation and cleared at the entry of
   * `validateChange` so that re-runs always observe the latest schema
   * (e.g. after `update --schemas`).
   */
  private schemaCache: SchemaDef | null = null;

  /**
   * @param schemaEngine  Optional schema engine for loading the active schema.
   * @param projectConfig Optional loaded project configuration.
   * @param wikiEngine    Optional wiki engine for link validation.
   * @param projectRoot   Absolute path to the project root.
   */
  constructor(
    schemaEngine?: { load: () => Promise<SchemaDef> },
    projectConfig?: ProjectConfig,
    wikiEngine?: WikiEngine,
    projectRoot?: string
  ) {
    this.schemaEngine = schemaEngine;
    this.projectConfig = projectConfig;
    this.wikiEngine = wikiEngine;
    this.projectRoot = projectRoot ?? '';
  }

  /**
   * Validate a single artifact in a change directory.
   *
   * Runs all applicable checks: file existence, frontmatter, word count,
   * and wiki-link validity (for wiki-diff artifacts). Frontmatter and
   * word-count checks run exactly once per artifact, inside
   * `schemaCompliance`, so their errors/warnings are not duplicated in
   * the result (a single missing-frontmatter artifact used to report
   * two identical errors and read the file twice).
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Aggregated validation result.
   */
  async validateArtifact(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    const exists = await this.fileExists(changeDir, artifactId);
    if (!exists.passed) {
      errors.push(...exists.errors);
      return { artifactId, passed: false, errors, warnings };
    }

    const schemaCompliance = await this.schemaCompliance(changeDir, artifactId);
    errors.push(...schemaCompliance.errors);
    warnings.push(...schemaCompliance.warnings);

    const wikiLinks = await this.wikiLinkValidity(changeDir, artifactId);
    if (!wikiLinks.passed) {
      errors.push(...wikiLinks.errors);
    }

    const rules = this.parseRules(
      (await this.getSchema())?.artifacts.find((a) => a.id === artifactId)
    );
    if (rules.requireNonEmpty === true) {
      const nonEmpty = await this.requireNonEmpty(changeDir, artifactId);
      if (!nonEmpty.passed) {
        errors.push(...nonEmpty.errors);
      }
    }

    return {
      artifactId,
      passed: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate all artifacts in a change directory.
   *
   * The returned array contains one entry per artifact in the schema, the
   * chapter-sequence check, and the project-config check. A final entry with
   * `artifactId === 'all'` is appended that aggregates every child result
   * — its `errors` and `warnings` are the concatenation of all children's,
   * and its `passed` is `true` only when no child produced an error
   * (warnings are ignored for the aggregate, per spec scenario "Validate
   * entire change"). Downstream callers (CLI, SyncEngine) can therefore
   * inspect a single result to decide whether the change is syncable.
   *
   * @param changeDir Absolute path to the change directory.
   * @returns Array of per-artifact validation results, ending with the
   *          aggregate `artifactId: 'all'` entry.
   */
  async validateChange(changeDir: string): Promise<ValidationResult[]> {
    this.schemaCache = null;
    const schema = await this.getSchema();
    if (!schema) {
      return [];
    }
    const results: ValidationResult[] = [];
    for (const art of schema.artifacts) {
      results.push(await this.validateArtifact(changeDir, art.id));
    }
    results.push(await this.chapterSequence());
    results.push(await this.validateConfig());
    results.push(this.aggregateResults(results));
    return results;
  }

  /**
   * Combine a list of child validation results into a single aggregate entry.
   *
   * The aggregate's `errors` and `warnings` are the concatenation of all
   * children's. `passed` is `true` iff no child contributed any error —
   * warnings do not flip the aggregate to `false`, matching the spec's
   * "aggregate results — overall pass/fail based on error severity
   * (warnings don't fail)" requirement.
   *
   * @param children The per-artifact, chapter-sequence, and config results.
   * @returns A single `ValidationResult` with `artifactId: 'all'`.
   */
  private aggregateResults(children: ValidationResult[]): ValidationResult {
    const aggregateErrors: string[] = [];
    const aggregateWarnings: string[] = [];
    for (const child of children) {
      aggregateErrors.push(...child.errors);
      aggregateWarnings.push(...child.warnings);
    }
    return {
      artifactId: 'all',
      passed: aggregateErrors.length === 0,
      errors: aggregateErrors,
      warnings: aggregateWarnings,
    };
  }

  /**
   * Check whether the artifact's generated file is non-empty.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async requireNonEmpty(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = await this.getSchema();
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    const fileName = art?.generates ?? `${artifactId}.md`;
    const filePath = join(changeDir, fileName);
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      return { artifactId, passed: false, errors: [`File missing: ${fileName}`], warnings: [] };
    }
    if (raw.trim().length === 0) {
      return { artifactId, passed: false, errors: [`File is empty: ${fileName}`], warnings: [] };
    }
    return { artifactId, passed: true, errors: [], warnings: [] };
  }

  /**
   * Check whether the artifact's generated file exists.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async fileExists(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = await this.getSchema();
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    const fileName = art?.generates ?? `${artifactId}.md`;
    const filePath = join(changeDir, fileName);
    const exists = await fileExists(filePath);
    if (!exists) {
      return {
        artifactId,
        passed: false,
        errors: [`File missing: ${fileName}`],
        warnings: [],
        extras: { exists: false },
      };
    }
    return { artifactId, passed: true, errors: [], warnings: [], extras: { exists: true } };
  }

  /**
   * Check schema compliance: frontmatter present and word count in range.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async schemaCompliance(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];
    const frontmatter = await this.frontmatterPresent(changeDir, artifactId);
    if (!frontmatter.passed) {errors.push(...frontmatter.errors);}
    const wordCount = await this.wordCount(changeDir, artifactId);
    if (wordCount.warnings.length > 0) {
      warnings.push(...wordCount.warnings);
    }
    return {
      artifactId,
      passed: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Check whether the artifact file has YAML frontmatter.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async frontmatterPresent(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = await this.getSchema();
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    if (!art) {
      return { artifactId, passed: true, errors: [], warnings: [] };
    }
    if (!(art.validation?.mechanical?.includes('frontmatterPresent') ?? false)) {
      return { artifactId, passed: true, errors: [], warnings: [] };
    }
    const fileName = art.generates;
    const filePath = join(changeDir, fileName);
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      return { artifactId, passed: false, errors: [`File missing: ${fileName}`], warnings: [] };
    }
    const { data } = extractFrontmatter(raw);
    if (Object.keys(data).length === 0) {
      return { artifactId, passed: false, errors: ['Frontmatter missing or empty'], warnings: [] };
    }
    const errors: string[] = [];
    const rules = this.parseRules(art);
    if (rules.requiredFields !== undefined && rules.requiredFields.length > 0) {
      for (const field of rules.requiredFields) {
        if (!(field in data)) {
          errors.push(`Required frontmatter field '${field}' is missing`);
        }
      }
    }
    if (errors.length > 0) {
      return { artifactId, passed: false, errors, warnings: [] };
    }
    return { artifactId, passed: true, errors: [], warnings: [] };
  }

  /**
   * Count words in the artifact file and compare against schema rules.
   *
   * Word count is determined from the Markdown body (excluding frontmatter).
   * For Chinese text, characters are counted as words.
   *
   * Per spec scenario "Word count check": out-of-range counts are reported
   * with severity `warning` rather than `error`, and this method always
   * returns `passed: true`. Callers must therefore check `warnings.length`
   * (not `passed`) when deciding whether to surface the result. This
   * invariant lets `validateArtifact` and `schemaCompliance` aggregate
   * word-count warnings into their own result without re-checking `passed`.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result. `passed` is always `true`; out-of-range
   *          counts are surfaced via `warnings`.
   */
  async wordCount(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = await this.getSchema();
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    const fileName = art?.generates ?? `${artifactId}.md`;
    const filePath = join(changeDir, fileName);
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      return { artifactId, passed: false, errors: [`File missing: ${fileName}`], warnings: [] };
    }

    const { content } = extractFrontmatter(raw);
    const lang = this.projectConfig?.project.language ?? 'en-US';
    const count = this.countWords(content, lang);

    const rules = this.parseRules(art);
    const warnings: string[] = [];

    if (rules.minWords !== undefined && count < rules.minWords) {
      warnings.push(`Word count ${String(count)} below minimum ${String(rules.minWords)}`);
    }
    if (rules.maxWords !== undefined && count > rules.maxWords) {
      warnings.push(`Word count ${String(count)} above maximum ${String(rules.maxWords)}`);
    }

    return {
      artifactId,
      passed: true, // Warnings don't block sync — they're informational
      errors: [],
      warnings,
    };
  }

  /**
   * Validate wiki links inside a wiki-diff artifact.
   *
   * Parses `[[...]]` links and verifies target pages exist via the wiki engine.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async wikiLinkValidity(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = await this.getSchema();
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    const fileName = art?.generates ?? `${artifactId}.md`;
    const filePath = join(changeDir, fileName);
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      return { artifactId, passed: false, errors: [`File missing: ${fileName}`], warnings: [] };
    }

    const isWikiDiff = art?.id === 'wiki-diff' || fileName.includes('wiki-diff');
    if (!isWikiDiff) {
      return { artifactId, passed: true, errors: [], warnings: [] };
    }

    const links = extractWikiLinks(raw);
    const errors: string[] = [];
    for (const link of links) {
      let exists = false;
      const pagePath = link.endsWith('.md') ? link : `${link}.md`;
      if (this.wikiEngine) {
        try {
          await this.wikiEngine.readPage(pagePath);
          exists = true;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (err instanceof TargetNotFoundError || (err instanceof Error && err.name === 'TargetNotFoundError')) {
            console.warn('[MechanicalValidator] Wiki link target not found:', msg);
          } else {
            // A non-TargetNotFoundError exception signals a wiki-engine
            // internal failure (e.g. EACCES, ENOENT on a parent dir).
            // Surface it as its own error so a true engine failure is
            // not silently relabelled as a "Broken wiki link".  The
            // "Broken wiki link" line is still pushed below because the
            // engine did not confirm the target exists, but the caller
            // can distinguish the two by error string.
            console.warn('[MechanicalValidator] Wiki link check failed:', msg);
            errors.push(`Wiki link check failed: ${msg}`);
          }
        }
      } else {
        const targetPath = join(this.projectRoot, 'adab', 'wiki', pagePath);
        exists = await fileExists(targetPath);
      }
      if (!exists) {
        errors.push(`Broken wiki link: [[${link}]]`);
      }
    }

    return {
      artifactId,
      passed: errors.length === 0,
      errors,
      warnings: [],
    };
  }

  /**
   * Check that manuscript chapters are consecutively numbered.
   *
   * Scans `manuscript/chapters/` for `ch-NNN.md` files and reports two kinds
   * of issues, classified strictly per spec:
   *  - Missing first chapter (e.g. only `ch-002.md` and `ch-003.md` exist)
   *    is reported as a **error** with message `Chapters should start at
   *    ch-001`. This is a hard requirement, not a stylistic note.
   *  - Gaps between consecutive chapters (e.g. `ch-001` and `ch-003` with no
   *    `ch-002`) are reported as **warnings** because the manuscript may be
   *    intentionally out of order. Warnings do not flip `passed` to `false`.
   *
   * @returns Validation result. `passed` reflects only the `errors` array;
   *          `warnings` are informational and never fail the check.
   */
  async chapterSequence(): Promise<ValidationResult> {
    const chaptersDir = join(this.projectRoot, 'adab', 'manuscript', 'chapters');
    if (!(await fileExists(chaptersDir))) {
      return {
        artifactId: 'chapter-sequence',
        passed: true,
        errors: [],
        warnings: [],
      };
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const entries = await readdir(chaptersDir);
    const numbers = entries
      .filter((e) => e.startsWith('ch-') && e.endsWith('.md'))
      .map((e) => {
        const num = parseInt(e.replace(/^ch-/, '').replace(/\.md$/, ''), 10);
        if (Number.isNaN(num)) {
          warnings.push(`Malformed chapter filename: ${e} - could not parse chapter number`);
        }
        return num;
      })
      .filter((n) => !Number.isNaN(n))
      .sort((a, b) => a - b);
    if (numbers.length > 0 && numbers[0] !== 1) {
      errors.push('Chapters should start at ch-001');
    }
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        warnings.push(`Gap between ch-${String(numbers[i - 1]).padStart(3, '0')} and ch-${String(numbers[i]).padStart(3, '0')}`);
      }
    }

    return {
      artifactId: 'chapter-sequence',
      passed: errors.length === 0,
      errors,
      warnings,
    };
  }

  /**
   * Validate the project's `adab/config.yaml` against the zod schema.
   *
   * Per spec scenario "Config file missing": when `adab/config.yaml` does not
   * exist this method returns `passed: false` with an error message of the
   * exact form `Config file not found: <absolute-path>`. The CLI uses this
   * signal to abort the command; `openadab init` is the only command exempt
   * from this check (it scaffolds the config from scratch).
   *
   * @returns Validation result. `passed` is `true` only when the config file
   *          exists, parses as YAML, and conforms to `ProjectConfigSchema`.
   */
  async validateConfig(): Promise<ValidationResult> {
    const configPath = join(this.projectRoot, 'adab', 'config.yaml');
    if (!(await fileExists(configPath))) {
      return {
        artifactId: 'config',
        passed: false,
        errors: [`Config file not found: ${configPath}`],
        warnings: [],
      };
    }
    const raw = await safeReadFile(configPath);
    if (raw === null) {
      return {
        artifactId: 'config',
        passed: false,
        errors: [`Config file not found: ${configPath}`],
        warnings: [],
      };
    }
    let parsed: unknown;
    try {
      parsed = YAML.parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        artifactId: 'config',
        passed: false,
        errors: [`Failed to parse config YAML: ${msg}`],
        warnings: [],
      };
    }
    const result = ProjectConfigSchema.safeParse(parsed);
    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      return {
        artifactId: 'config',
        passed: false,
        errors: [`Config validation failed: ${issues}`],
        warnings: [],
      };
    }
    return {
      artifactId: 'config',
      passed: true,
      errors: [],
      warnings: [],
    };
  }

  /**
   * Count words in a text string.
   *
   * For Chinese (`zh-CN`, `zh-*`), counts characters.
   * For other languages, counts whitespace-separated tokens.
   *
   * @param text     Markdown body text.
   * @param language Language code from project config.
   * @returns Word count (≥ 0).
   */
  private countWords(text: string, language: string): number {
    const trimmed = text.trim();
    if (trimmed.length === 0) {return 0;}
    if (language.startsWith('zh') || language.startsWith('ja')) {
      return trimmed.replace(/\s/g, '').length;
    }
    return trimmed.split(/\s+/).length;
  }

  /**
   * Return the active schema, loading it on first access within a
   * `validateChange` call and memoising the result for subsequent calls.
   *
   * Returns `undefined` when no `schemaEngine` was provided to the
   * constructor — a missing schema engine is a legitimate
   * silent-degradation mode. When a schemaEngine IS configured but
   * `load()` throws (e.g. the schema file is missing or malformed), the
   * failure is NOT swallowed: it is rethrown so `validateChange` /
   * `validateDependencies` surface the error instead of reporting an
   * empty pass that looks like "everything validated". On load failure
   * the cache is reset to `null` so the next call retries from disk.
   *
   * @returns The loaded `SchemaDef`, or `undefined` when no schemaEngine is configured.
   * @throws The error from `schemaEngine.load()` when a configured engine fails.
   */
  private async getSchema(): Promise<SchemaDef | undefined> {
    if (!this.schemaEngine) {return undefined;}
    if (this.schemaCache !== null) {return this.schemaCache;}
    try {
      this.schemaCache = await this.schemaEngine.load();
      return this.schemaCache;
    } catch (err) {
      this.schemaCache = null;
      throw err;
    }
  }

  /**
   * Parse mechanical validation rules from an artifact definition.
   *
   * Behavior is opt-in: `requireNonEmpty` defaults to `false` and is only set
   * to `true` when the schema explicitly includes a `requireNonEmpty` or
   * `requireNonEmpty:true` rule string in `validation.mechanical`. A
   * `requireNonEmpty:false` rule string keeps the check disabled (useful as
   * an explicit override). `requiredFields` remains an empty array unless
   * `requireField:<name>` rule strings are present.
   *
   * @param art Artifact definition (may be undefined).
   * @returns Parsed rules.
   */
  private parseRules(art: ArtifactDef | undefined): MechanicalRules {
    const rules: MechanicalRules = {
      requireNonEmpty: false,
      requiredFields: [],
    };
    if (!art?.validation?.mechanical) {return rules;}

    for (const rule of art.validation.mechanical) {
      const minMatch = /minWords:(\d+)/.exec(rule);
      if (minMatch) {rules.minWords = parseInt(minMatch[1], 10);}
      const maxMatch = /maxWords:(\d+)/.exec(rule);
      if (maxMatch) {rules.maxWords = parseInt(maxMatch[1], 10);}
      const fieldMatch = /requireField:(\w[\w-]*)/.exec(rule);
      if (fieldMatch) {
        rules.requiredFields ??= [];
        rules.requiredFields.push(fieldMatch[1]);
      }
      if (rule === 'requireNonEmpty' || rule === 'requireNonEmpty:true') {
        rules.requireNonEmpty = true;
      } else if (rule === 'requireNonEmpty:false') {
        rules.requireNonEmpty = false;
      }
    }
    return rules;
  }

  /**
   * Validate that all artifact dependencies in the schema are satisfied by the change manifest.
   *
   * For each artifact in the schema, checks that every dependency listed in `requires`
   * is present in the manifest's artifact list, and that a `done` artifact never has a
   * required dependency that is not itself `done` (a hand-edited manifest could violate
   * the cascade `ChangeManifest` normally maintains — see `handleArtifactDeletion`'s
   * `=== 'done'` convention). A blocked/ready artifact with a non-done dependency is
   * fine: it simply has not become ready yet.
   *
   * @param manifestArtifacts Mapping of artifact IDs to their statuses from the change manifest.
   * @returns Validation result indicating whether all dependencies are satisfied.
   */
  async validateDependencies(manifestArtifacts: Record<string, string>): Promise<ValidationResult> {
    const errors: string[] = [];
    const schema = await this.getSchema();
    if (!schema) {
      return { artifactId: 'dependencies', passed: true, errors: [], warnings: [] };
    }
    for (const art of schema.artifacts) {
      for (const req of art.requires) {
        if (!(req in manifestArtifacts)) {
          errors.push(`Artifact '${art.id}' requires '${req}' which is not present in the change manifest`);
          continue;
        }
        if (manifestArtifacts[art.id] === 'done' && manifestArtifacts[req] !== 'done') {
          errors.push(
            `Artifact '${art.id}' is done but its required dependency '${req}' is not done (status: '${manifestArtifacts[req]}')`
          );
        }
      }
    }
    return {
      artifactId: 'dependencies',
      passed: errors.length === 0,
      errors,
      warnings: [],
    };
  }
}
