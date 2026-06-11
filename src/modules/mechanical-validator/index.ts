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
   * and wiki-link validity (for wiki-diff artifacts).
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

    const frontmatter = await this.frontmatterPresent(changeDir, artifactId);
    if (!frontmatter.passed) {
      errors.push(...frontmatter.errors);
    }

    const wordCount = await this.wordCount(changeDir, artifactId);
    if (!wordCount.passed) {
      if (wordCount.errors.length > 0) {errors.push(...wordCount.errors);}
      if (wordCount.warnings.length > 0) {warnings.push(...wordCount.warnings);}
    }

    const schemaCompliance = await this.schemaCompliance(changeDir, artifactId);
    if (!schemaCompliance.passed) {
      errors.push(...schemaCompliance.errors);
    }

    const wikiLinks = await this.wikiLinkValidity(changeDir, artifactId);
    if (!wikiLinks.passed) {
      errors.push(...wikiLinks.errors);
    }

    const rules = this.parseRules(
      this.schemaEngine
        ? (await this.schemaEngine.load()).artifacts.find((a) => a.id === artifactId)
        : undefined
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
   * @param changeDir Absolute path to the change directory.
   * @returns Array of per-artifact validation results.
   */
  async validateChange(changeDir: string): Promise<ValidationResult[]> {
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
    if (!schema) {
      return [];
    }
    const results: ValidationResult[] = [];
    for (const art of schema.artifacts) {
      results.push(await this.validateArtifact(changeDir, art.id));
    }
    results.push(await this.chapterSequence());
    results.push(await this.validateConfig());
    return results;
  }

  /**
   * Check whether the artifact's generated file is non-empty.
   *
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result.
   */
  async requireNonEmpty(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
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
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
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
    if (!wordCount.passed) {
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
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
    const art = schema ? schema.artifacts.find((a) => a.id === artifactId) : undefined;
    if (!art?.validation?.mechanical?.includes('frontmatterPresent')) {
      return { artifactId, passed: true, errors: [], warnings: [] };
    }
    const fileName = art?.generates ?? `${artifactId}.md`;
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
   * @param changeDir  Absolute path to the change directory.
   * @param artifactId Artifact identifier.
   * @returns Validation result. Out-of-range produces warnings (not errors).
   */
  async wordCount(changeDir: string, artifactId: string): Promise<ValidationResult> {
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
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
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
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
          console.warn('[MechanicalValidator] Wiki link target not found:', err instanceof Error ? err.message : String(err));
          exists = false;
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
   * Scans `manuscript/chapters/` for `ch-NNN.md` files and reports gaps.
   *
   * @returns Validation result. Gaps produce warnings.
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
      warnings.push('Chapters should start at ch-001');
    }
    for (let i = 1; i < numbers.length; i++) {
      if (numbers[i] !== numbers[i - 1] + 1) {
        warnings.push(`Gap between ch-${String(numbers[i - 1]).padStart(3, '0')} and ch-${String(numbers[i]).padStart(3, '0')}`);
      }
    }

    return {
      artifactId: 'chapter-sequence',
      passed: warnings.length === 0,
      errors: [],
      warnings,
    };
  }

  /**
   * Validate the project's `adab/config.yaml` against the zod schema.
   *
   * @returns Validation result.
   */
  async validateConfig(): Promise<ValidationResult> {
    const configPath = join(this.projectRoot, 'adab', 'config.yaml');
    if (!(await fileExists(configPath))) {
      return {
        artifactId: 'config',
        passed: true,
        errors: [],
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
      if (fieldMatch) {rules.requiredFields!.push(fieldMatch[1]);}
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
   * is present in the manifest's artifact list.
   *
   * @param manifestArtifacts Mapping of artifact IDs to their statuses from the change manifest.
   * @returns Validation result indicating whether all dependencies are satisfied.
   */
  async validateDependencies(manifestArtifacts: Record<string, string>): Promise<ValidationResult> {
    const errors: string[] = [];
    const schema = this.schemaEngine ? await this.schemaEngine.load() : undefined;
    if (!schema) {
      return { artifactId: 'dependencies', passed: true, errors: [], warnings: [] };
    }
    for (const art of schema.artifacts) {
      for (const req of art.requires) {
        if (!(req in manifestArtifacts)) {
          errors.push(`Artifact '${art.id}' requires '${req}' which is not present in the change manifest`);
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
