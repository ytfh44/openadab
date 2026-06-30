/**
 * Host Adapters — transforms core command definitions into host-native
 * instruction files for various AI coding assistants.
 */
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

import YAML from 'yaml';

import { CommandDefSchema, type CommandDef, type CommandStep, type CommandParameter } from '../../schemas/command-def.js';
import type { ProjectConfig, ContextPack } from '../../schemas/types.js';
import { AdabError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';

/**
 * Represents a generated file with its relative path and content.
 */
export interface GeneratedFile {
  /** Relative path within the project root. */
  path: string;
  /** Full file content. */
  content: string;
}

/**
 * Loads and validates core command definitions from YAML files.
 */
export class CommandDefLoader {
  private readonly commandsDir: string;

  /**
   * @param commandsDir Absolute path to the directory containing `*.yaml` command definitions.
   */
  constructor(commandsDir: string) {
    this.commandsDir = commandsDir;
  }

  /**
   * Load all command definitions from the commands directory.
   *
   * Reads every `.yaml` file, parses it, validates against the zod
   * {@link CommandDefSchema}, and returns the array of definitions.
   *
   * Duplicate `name` fields (HA-2) are detected: the first occurrence is
   * kept and subsequent files sharing the same name are skipped with a
   * warning.  This prevents two `adab-<name>/SKILL.md` files from
   * silently overwriting each other downstream.
   *
   * @returns Array of validated command definitions, ordered as encountered.
   */
  async loadAll(): Promise<CommandDef[]> {
    const entries = await readdir(this.commandsDir);
    const files = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'));
    const defs: CommandDef[] = [];
    const seen = new Set<string>();
    for (const file of files) {
      const raw = await safeReadFile(join(this.commandsDir, file));
      if (raw === null) {continue;}
      let parsed: unknown;
      try {
        parsed = YAML.parse(raw);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[CommandDefLoader] Skipping ${file} — YAML parse failed: ${msg}`);
        continue;
      }
      const result = CommandDefSchema.safeParse(parsed);
      if (!result.success) {
        const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
        console.warn(`[CommandDefLoader] Skipping ${file} — validation failed: ${issues}`);
        continue;
      }
      if (seen.has(result.data.name)) {
        console.warn(
          `[CommandDefLoader] Skipping ${file} — duplicate command name "${result.data.name}". ` +
          `The first definition wins; rename one of the files to avoid silently ` +
          `overwriting the same SKILL.md downstream.`
        );
        continue;
      }
      seen.add(result.data.name);
      defs.push(result.data);
    }
    return defs;
  }
}

/**
 * Abstract base class for host adapters.
 *
 * Subclasses implement {@link generate} to produce host-specific files
 * from an array of {@link CommandDef} objects.
 */
export abstract class AdapterBase {
  /**
   * Generate host-native files from command definitions.
   *
   * @param files Array of command definitions.
   * @returns Array of generated files to write.
   */
  abstract generate(files: CommandDef[]): GeneratedFile[];

  /**
   * Interpolate parameter placeholders in a step string.
   *
   * Replaces `{{name}}` and `{{name.subkey}}` (HA-8) with the value
   * from `params` when available; otherwise leaves a clean documentation
   * placeholder of the form `<name>` or `<name.subkey>`.
   *
   * Dotted placeholders are supported so that the spec's "Captured
   * variable reuse" scenario (`{{context_pack.mustRead}}`) is rendered
   * as `<context_pack.mustRead>` instead of leaking raw `{{...}}` syntax
   * into the generated instruction.
   *
   * @param text   The step text.
   * @param params Parameter values provided at invocation time.
   * @returns Interpolated string.
   */
  protected interpolateParameters(text: string, params: Record<string, string> = {}): string {
    return text.replace(/\{\{(\w+(?:\.\w+)*)\}\}/g, (_match, key: string) => {
      if (key in params) {
        return params[key];
      }
      return `<${key}>`;
    });
  }

  /**
   * Format a list of command parameters as Markdown documentation.
   *
   * @param params Array of parameters.
   * @returns Markdown string.
   */
  protected formatParameters(params: CommandParameter[]): string {
    if (params.length === 0) {return '';}
    const lines = params.map((p) => {
      const req = p.required ? ' (required)' : '';
      const def = p.default !== undefined ? ` — default: \`${p.default}\`` : '';
      const desc = p.description !== undefined ? ` — ${p.description}` : '';
      return `- \`${p.name}\` (${p.type})${req}${def}${desc}`;
    });
    return `### Parameters\n\n${lines.join('\n')}\n`;
  }

  /**
   * Format command steps as Markdown instructions.
   *
   * @param steps Array of steps.
   * @returns Markdown string.
   */
  protected formatSteps(steps: CommandStep[], params: Record<string, string> = {}): string {
    const lines = steps.map((step, index) => {
      let detail = '';
      switch (step.action) {
        case 'cli':
          detail = `Run \`${this.interpolateParameters(step.command ?? '', params)}\``;
          if (step.capture !== undefined) {
            detail += ` and capture the output as \`${step.capture}\``;
          }
          break;
        case 'read':
          detail = `Read the file(s): \`${step.paths ?? ''}\``;
          break;
        case 'read_optional':
          detail = `Optionally read the file(s): \`${step.paths ?? ''}\``;
          break;
        case 'write':
          detail = `Write to \`${step.path ?? ''}\``;
          break;
        case 'llm':
          detail = 'Generate content using the LLM.';
          break;
        default:
          detail = 'Unknown step.';
      }
      return `${String(index + 1)}. ${detail}`;
    });
    return `### Steps\n\n${lines.join('\n')}\n`;
  }
}

/**
 * Sanitize a command name into a valid Agent Skills `name` field value.
 *
 * Per the [Agent Skills spec](https://agentskills.io/specification):
 * - 1–64 characters
 * - Only lowercase alphanumeric (`a-z`, `0-9`) and hyphens (`-`)
 * - Must not start or end with a hyphen
 * - Must not contain consecutive hyphens (`--`)
 *
 * @param raw The raw command name from the YAML definition.
 * @returns A sanitized, spec-compliant skill name.
 */
function sanitizeSkillName(raw: string): string {
  let name = raw
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  if (name.length === 0) { name = 'command'; }
  if (name.length > 64) { name = name.slice(0, 64).replace(/-+$/, ''); }
  return name;
}

/**
 * Generates Opencode skill files (`skills/adab-<name>/SKILL.md`).
 */
export class OpencodeAdapter extends AdapterBase {
  /**
   * Generate Opencode SKILL.md files for each command.
   *
   * Each file includes YAML frontmatter with `name` and `description`
   * fields as required by the
   * [Agent Skills specification](https://agentskills.io/specification).
   *
   * The "Workflow" section is built from the command's own {@link CommandDef.steps}
   * via {@link AdapterBase.formatSteps} (HA-6) so the rendered instructions
   * stay in sync with the YAML definition.
   *
   * @param files Array of command definitions.
   * @returns Array of generated files.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    return files.map((cmd) => {
      const skillName = `adab-${sanitizeSkillName(cmd.name)}`;
      const content = [
        '---',
        `name: ${skillName}`,
        `description: Use when you need to ${cmd.description}. Triggered by /adab:${cmd.name} for ${cmd.category} tasks.`,
        '---',
        '',
        `# /adab:${cmd.name}`,
        '',
        cmd.description,
        '',
        '## Workflow',
        '',
        'Follow this sequence when executing this command:',
        '',
        this.formatSteps(cmd.steps, { change: '<change-id>', artifact: '<artifact-id>' }),
        '',
        this.formatParameters(cmd.parameters),
        '',
        '---',
        '*Generated by OpenAdab host adapter. Do not edit manually unless you know what you are doing.*',
      ].join('\n');
      return { path: `.agents/skills/${skillName}/SKILL.md`, content };
    });
  }
}


/**
 * Generates Cursor rule files (`.cursor/rules/adab.mdc`).
 */
export class CursorAdapter extends AdapterBase {
  /**
   * Generate Cursor `.mdc` rule file with `@` command references.
   *
   * The parameter is named `commands` (HA-9) to avoid the misleading
   * parent-class signature `files: CommandDef[]` — these are command
   * definitions, not output files.
   *
   * @param commands Array of command definitions.
   * @returns Array of generated files.
   */
  generate(commands: CommandDef[]): GeneratedFile[] {
    const lines: string[] = ['# OpenAdab Commands', ''];
    for (const cmd of commands) {
      lines.push(`## @${cmd.name}`);
      lines.push('');
      lines.push(cmd.description);
      lines.push('');
      if (cmd.parameters.length > 0) {
        lines.push('### Parameters');
        for (const p of cmd.parameters) {
          const req = p.required ? ' (required)' : '';
          lines.push(`- \`${p.name}\` (${p.type})${req}`);
        }
        lines.push('');
      }
      lines.push('### Steps');
      for (const step of cmd.steps) {
        if (step.action === 'cli' && step.command !== undefined) {
          lines.push(`- \`${this.interpolateParameters(step.command, { change: '<change-id>', artifact: '<artifact-id>' })}\``);
        }
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('*Generated by OpenAdab host adapter.*');
    return [{ path: '.cursor/rules/adab.mdc', content: lines.join('\n') }];
  }
}

/**
 * Generates GitHub Copilot instruction files (`.github/copilot-instructions.md`).
 */
export class CopilotAdapter extends AdapterBase {
  /**
   * Generate Copilot instructions documenting all OpenAdab commands.
   *
   * Step numbering uses an independent counter per action type (HA-7) so
   * the rendered list is `1. Run ... 2. Run ... 1. Read ... 2. Read ...`
   * rather than the buggy `1. ... 1. ... 1. ...` that the literal
   * `"1."`, `"2."`, `"3."` strings produced.
   *
   * The parameter block delegates to the shared
   * {@link AdapterBase.formatParameters} helper (HA-10) so the visual
   * style stays consistent with {@link GenericAdapter} and any future
   * host that does not need bespoke rendering.
   *
   * @param files Array of command definitions.
   * @returns Array of generated files.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    const lines: string[] = [
      '# OpenAdab — Copilot Instructions',
      '',
      'This document describes the OpenAdab workflow commands available in this project.',
      '',
    ];
    for (const cmd of files) {
      lines.push(`## \`/adab:${cmd.name}\``);
      lines.push('');
      lines.push(cmd.description);
      lines.push('');
      lines.push(this.formatParameters(cmd.parameters));
      lines.push('');
      lines.push('### Workflow');
      const cliCount = { n: 0 };
      const readCount = { n: 0 };
      const writeCount = { n: 0 };
      for (const step of cmd.steps) {
        if (step.action === 'cli' && step.command !== undefined) {
          cliCount.n += 1;
          lines.push(`${String(cliCount.n)}. Run \`${this.interpolateParameters(step.command, { change: '<change-id>', artifact: '<artifact-id>' })}\``);
        } else if (step.action === 'read' && step.paths !== undefined) {
          readCount.n += 1;
          lines.push(`${String(readCount.n)}. Read \`${this.interpolateParameters(step.paths, { change: '<change-id>', artifact: '<artifact-id>' })}\``);
        } else if (step.action === 'write' && step.path !== undefined) {
          writeCount.n += 1;
          lines.push(`${String(writeCount.n)}. Write output to \`${this.interpolateParameters(step.path, { change: '<change-id>', artifact: '<artifact-id>' })}\``);
        }
      }
      lines.push('');
    }
    lines.push('---');
    lines.push('*Generated by OpenAdab host adapter.*');
    return [{ path: '.github/copilot-instructions.md', content: lines.join('\n') }];
  }
}

/**
 * Generates a generic `AGENTS.md` with complete workflow documentation.
 */
export class GenericAdapter extends AdapterBase {
  /**
   * Generate a generic `AGENTS.md` file.
   *
   * @param files Array of command definitions.
   * @returns Array of generated files.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    const lines: string[] = [
      '# AGENTS.md — OpenAdab Workflow',
      '',
      'This file documents the OpenAdab workflow engine commands.',
      'It is intended for AI agents that do not have a specific host adapter.',
      '',
    ];
    for (const cmd of files) {
      lines.push(`## \`/adab:${cmd.name}\``);
      lines.push('');
      lines.push(cmd.description);
      lines.push('');
      lines.push(this.formatParameters(cmd.parameters));
      lines.push('');
      lines.push(this.formatSteps(cmd.steps, { change: '<change-id>', artifact: '<artifact-id>' }));
      lines.push('');
    }
    lines.push('---');
    lines.push('*Generated by OpenAdab host adapter.*');
    return [{ path: 'AGENTS.md', content: lines.join('\n') }];
  }
}

/**
 * Context data for the {@link MonolithicPromptAdapter}, providing all the
 * project and artifact information needed to assemble a comprehensive prompt.
 */
export interface MonolithicPromptContext {
  /** Project configuration for project context section. */
  projectConfig?: ProjectConfig;
  /** The assembled instruction text for the current artifact. */
  instruction?: string;
  /** The interpolated template text. */
  template?: string;
  /** Target output path for the artifact. */
  outputPath?: string;
  /** Per-artifact writing rules. */
  rules?: string[];
  /** Context pack with mustRead/optionalRead file lists. */
  contextPack?: ContextPack;
  /** Inlined dependency file contents (dependency ID → content). */
  dependencyContent?: Record<string, string>;
}

/**
 * Generates a single monolithic prompt for non-tool-use hosts.
 *
 * The prompt inlines all command definitions, project context, artifact
 * instructions, dependency content, templates, and writing rules, staying
 * within a configurable token budget.
 */
export class MonolithicPromptAdapter extends AdapterBase {
  private readonly budget: number;
  private readonly languageCode: string;
  private readonly context: MonolithicPromptContext;

  /**
   * @param budget       Maximum token budget for the generated prompt (default 8000).
   * @param languageCode Project language code for token heuristic (default 'en').
   * @param context      Optional context for populating the comprehensive prompt
   *                     (project config, instructions, context pack, etc.).
   */
  constructor(budget = 8000, languageCode = 'en', context?: MonolithicPromptContext) {
    super();
    this.budget = budget;
    this.languageCode = languageCode;
    this.context = context ?? {};
  }

  private getTokenDivisor(): number {
    return this.languageCode.startsWith('zh') ? 1.5 : 4;
  }

  /**
   * Generate a single comprehensive prompt.
   *
   * @param files Array of command definitions.
   * @returns Array containing a single `PROMPT.md` file.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    const sections: string[] = [];

    // ── Section 1: Project context ──
    if (this.context.projectConfig !== undefined) {
      const cfg = this.context.projectConfig;
      sections.push(
        '## Project Context',
        '',
        `- **Title:** ${cfg.project.title}`,
        `- **Language:** ${cfg.project.language}`,
        `- **Genre:** ${cfg.project.genre}`,
        `- **Tense:** ${cfg.project.tense}`,
        `- **POV:** ${cfg.project.pov}`,
        `- **Token Budget:** ${cfg.context.maxTokens}`,
        '',
      );
    }

    // ── Section 2: Artifact instruction ──
    if (this.context.instruction !== undefined && this.context.instruction.length > 0) {
      sections.push('## Instruction', '', this.context.instruction, '');
    }

    // ── Section 3: Output path ──
    if (this.context.outputPath !== undefined) {
      // HA-11: escape any backticks in the output path so the surrounding
      // `\`...\`` fence stays balanced — otherwise a path containing a
      // backtick would terminate the inline code span early and break
      // downstream Markdown renderers.
      const safeOutputPath = this.escapeBackticks(this.context.outputPath);
      sections.push('## Output', '', `Write the generated content to: \`${safeOutputPath}\``, '');
    }

    // ── Section 4: Template ──
    if (this.context.template !== undefined && this.context.template.length > 0) {
      sections.push('## Template', '', this.context.template, '');
    }

    // ── Section 5: Writing rules ──
    if (this.context.rules !== undefined && this.context.rules.length > 0) {
      const ruleItems = this.context.rules.map((r) => `- ${r}`);
      sections.push('## Writing Rules', '', ...ruleItems, '');
    }

    // ── Section 6: Inlined dependency content ──
    if (this.context.dependencyContent !== undefined && Object.keys(this.context.dependencyContent).length > 0) {
      sections.push('## Reference Material');
      for (const [depId, content] of Object.entries(this.context.dependencyContent)) {
        sections.push(`### ${depId}`, '', content, '');
      }
    }

    // ── Section 7: Command definitions ──
    sections.push('## Available Commands', '');
    for (const cmd of files) {
      sections.push(`### /adab:${cmd.name}`, '', cmd.description, '');
      if (cmd.parameters.length > 0) {
        const paramList = cmd.parameters.map((p) => {
          const req = p.required ? ' (required)' : '';
          const def = p.default !== undefined ? ` — default: \`${p.default}\`` : '';
          return `- \`${p.name}\` (${p.type})${req}${def}`;
        });
        sections.push('**Parameters:**', ...paramList, '');
      }
      const stepList = cmd.steps.map((step) => {
        switch (step.action) {
          case 'cli': return `- CLI: \`${this.interpolateParameters(step.command ?? '', { change: '<change-id>', artifact: '<artifact-id>' })}\``;
          case 'read': return `- Read: \`${step.paths ?? ''}\``;
          case 'write': return `- Write: \`${step.path ?? ''}\``;
          case 'llm': return '- LLM generation step.';
          default: return `- Unknown step: ${String(step.action)}`;
        }
      });
      if (stepList.length > 0) {
        sections.push('**Steps:**', ...stepList, '');
      }
    }

    let content = `# OpenAdab — Comprehensive Prompt\n\n${sections.join('\n')}\n---\n*Generated by OpenAdab MonolithicPromptAdapter.*\n`;

    const divisor = this.getTokenDivisor();
    const approxTokens = Math.ceil(content.length / divisor);
    if (approxTokens > this.budget) {
      const truncLen = Math.floor(this.budget * divisor);
      content = content.slice(0, truncLen);
      // Backtrack to the last complete `## ` section boundary so the
      // truncated output does not end mid-heading.
      const lastSection = content.lastIndexOf('\n## ');
      if (lastSection > 0) {
        content = content.slice(0, lastSection);
      }
      // HA-4: always append the truncation marker, even when the slice
      // contains no `## ` boundary (lastSection <= 0).  Without this
      // guarantee, a tiny budget with no heading inside could emit a
      // silently-cut file that lies about being complete.
      content = `${content.trimEnd()}\n\n[Content truncated to fit token budget]\n`;
    }

    return [{ path: 'PROMPT.md', content }];
  }

  /**
   * Escape backticks by prepending a backslash.
   *
   * Used to keep user-supplied content (such as output paths that
   * contain a literal `\`` character) from breaking the surrounding
   * inline code fence.  Two passes are applied: the literal `\``
   * already inside the input gets a backslash, and a backslash
   * preceding a backtick gets doubled so the original character is
   * preserved.
   *
   * @param text String that may contain backticks.
   * @returns The same string with backticks escaped.
   */
  private escapeBackticks(text: string): string {
    return text
      .replace(/\\`/g, '\\\\`')
      .replace(/`/g, '\\`');
  }
}

import { AdapterFactory } from './adapter-factory.js';

/**
 * Register all built-in adapters with the {@link AdapterFactory}.
 *
 * Called once at module load.  Tests that call
 * {@link AdapterFactory._resetForTests} can re-invoke this to rebuild
 * the registry from scratch (HA-5) so custom stubs do not leak across
 * test files.
 */
export function initRegistry(): void {
  AdapterFactory.register('opencode', OpencodeAdapter);
  AdapterFactory.register('cursor', CursorAdapter);
  AdapterFactory.register('copilot', CopilotAdapter);
  AdapterFactory.register('generic', GenericAdapter);
  AdapterFactory.register('monolithic', MonolithicPromptAdapter);
}

initRegistry();

/**
 * Detect the host environment based on directory markers.
 *
 * Checks for the presence of host-specific directories in the project root.
 * When more than one marker is present the function returns `null` and
 * emits a warning (HA-3) so the caller falls back to the generic
 * adapter instead of arbitrarily picking a host.
 *
 * @param projectRoot Absolute path to the project root.
 * @returns Detected host name, or `null` if none (or multiple) detected.
 */
export async function detectHost(projectRoot: string): Promise<string | null> {
  const markers: Record<string, string> = {
    '.opencode': 'opencode',
    '.cursor': 'cursor',
    '.github/copilot-instructions.md': 'copilot',
  };
  const matches: string[] = [];
  for (const [dir, host] of Object.entries(markers)) {
    if (await fileExists(join(projectRoot, dir))) {
      matches.push(host);
    }
  }
  if (matches.length === 1) {
    return matches[0];
  }
  if (matches.length > 1) {
    console.warn(
      `[detectHost] multiple host markers found in ${projectRoot}: ` +
      `${matches.join(', ')}. Auto-detection is ambiguous; ` +
      `pass \`--host <name>\` to pick one explicitly.`
    );
    return null;
  }
  return null;
}

/**
 * Compute a SHA-256 hash of a string.
 *
 * @param content The string to hash.
 * @returns Hex-encoded hash.
 */
export function computeHash(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

/**
 * In-memory cache of generation baselines hashes, keyed by relative file path.
 */
interface GenerationCache {
  hashes: Record<string, string>;
}

/**
 * Load the generation cache from `.openadab-cache.json` in the project root.
 *
 * @param projectRoot Absolute path to the project root.
 * @returns The parsed cache, or a default empty cache if the file is missing or corrupt.
 */
async function loadGenerationCache(projectRoot: string): Promise<GenerationCache> {
  const cachePath = join(projectRoot, '.openadab-cache.json');
  try {
    const raw = await safeReadFile(cachePath);
    if (raw !== null) {
      const parsed = JSON.parse(raw) as GenerationCache;
      if (parsed.hashes !== undefined && typeof parsed.hashes === 'object') {
        return parsed;
      }
    }
  } catch {
    // Cache missing or corrupt; start fresh.
  }
  return { hashes: {} };
}

/**
 * Persist the generation cache to `.openadab-cache.json` in the project root.
 *
 * @param projectRoot Absolute path to the project root.
 * @param cache        The cache to save.
 */
async function saveGenerationCache(projectRoot: string, cache: GenerationCache): Promise<void> {
  const cachePath = join(projectRoot, '.openadab-cache.json');
  await atomicWriteFile(cachePath, JSON.stringify(cache, null, 2));
}

/**
 * Check whether a file on disk already holds the exact bytes a caller
 * is about to write.
 *
 * @public
 *
 * Public utility exported for consumers that need a cheap "is the
 * on-disk file in sync with what I am about to write?" check — for
 * example, to skip a redundant write when regenerating scaffold,
 * instruction, or config files inside their own generators.
 *
 * Unlike a hash-based comparison, this helper compares the raw string
 * contents directly, which is sufficient for the small text files the
 * CLI generates.
 *
 * @param filePath         Absolute path to the file to inspect.
 * @param expectedContent  The content the caller intends to write.
 * @returns `true` when the file exists and its contents exactly equal
 *          `expectedContent`; `false` when the file is missing or its
 *          content differs in any way.
 */
export async function isUnchanged(filePath: string, expectedContent: string): Promise<boolean> {
  const existingContent = await safeReadFile(filePath);
  if (existingContent === null) {
    return false;
  }
  return existingContent === expectedContent;
}

/**
 * Write generated files, preserving user modifications when baselines differ.
 *
 * For each generated file:
 * - If the file does not exist, it is created and its hash is stored as a baseline.
 * - If the file exists and its content hash matches the new content, no write is
 *   necessary (idempotent re-run).
 * - If the file exists, no baseline is recorded, and the content differs from
 *   the new content, the file is **skipped** (HA-1).  Without a baseline the
 *   on-disk content has unknown provenance, so overwriting would clobber user
 *   work.  A warning is emitted and the user is told to use `--force` to override.
 * - If the file exists and its content hash equals the stored baseline but the
 *   new content differs, the file is overwritten (intentional adapter change).
 * - If the file exists, its content hash differs from the stored baseline, the
 *   file is **skipped** (user-modified).
 *
 * @param projectRoot Absolute path to the project root.
 * @param files       Array of generated files.
 * @returns Array of paths that were written.
 */
export async function writeGeneratedFiles(projectRoot: string, files: GeneratedFile[]): Promise<string[]> {
  const cache = await loadGenerationCache(projectRoot);
  const written: string[] = [];
  for (const file of files) {
    const absPath = join(projectRoot, file.path);
    const newHash = computeHash(file.content);
    const exists = await fileExists(absPath);

    if (exists) {
      const existingContent = await safeReadFile(absPath);
      if (existingContent !== null) {
        const existingHash = computeHash(existingContent);
        const baselineHash = cache.hashes[file.path];

        if (existingHash === newHash) {
          cache.hashes[file.path] = newHash;
          continue;
        }

        if (baselineHash === undefined) {
          // HA-1: no baseline means the file existed before we ever tracked it.
          // Treat as user-owned and skip with a warning.
          console.warn(
            `[writeGeneratedFiles] Skipping ${file.path} — no baseline cached. ` +
            `The file was present before the first tracked run, so its content ` +
            `is treated as user-owned. Use --force to overwrite.`
          );
          continue;
        }

        if (existingHash !== baselineHash) {
          console.warn(`[writeGeneratedFiles] Skipping ${file.path} — user modifications detected.`);
          continue;
        }
      }
    }

    await ensureDir(join(absPath, '..'));
    await atomicWriteFile(absPath, file.content);
    cache.hashes[file.path] = newHash;
    written.push(file.path);
  }
  await saveGenerationCache(projectRoot, cache);
  return written;
}
