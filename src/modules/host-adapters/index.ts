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
   * @returns Array of validated command definitions.
   * @throws {AdabError} If a file fails validation.
   */
  async loadAll(): Promise<CommandDef[]> {
    const entries = await readdir(this.commandsDir);
    const files = entries.filter((e) => e.endsWith('.yaml') || e.endsWith('.yml'));
    const defs: CommandDef[] = [];
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
   * Replaces `{{name}}` with the value from `params` when available,
   * otherwise leaves the placeholder for documentation.
   *
   * @param text   The step text.
   * @param params Parameter values provided at invocation time.
   * @returns Interpolated string.
   */
  protected interpolateParameters(text: string, params: Record<string, string> = {}): string {
    return text.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
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
 * Generates Opencode skill files (`skills/adab-<name>/SKILL.md`).
 */
export class OpencodeAdapter extends AdapterBase {
  /**
   * Generate Opencode SKILL.md files for each command.
   *
   * @param files Array of command definitions.
   * @returns Array of generated files.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    return files.map((cmd) => {
      const content = [
        `# /adab:${cmd.name}`,
        '',
        cmd.description,
        '',
        '## Workflow',
        '',
        'Follow this sequence when executing this command:',
        '',
        '1. Run `openadab context pack` to collect relevant context files',
        '2. Run `openadab instructions` to get the latest task instructions',
        '3. Read the generated context files to understand the current state',
        '4. Write the draft or output artifact as directed',
        '5. Run `openadab validate` to verify the output',
        '',
        this.formatParameters(cmd.parameters),
        '',
        this.formatSteps(cmd.steps, { change: '<change-id>', artifact: '<artifact-id>' }),
        '',
        '---',
        '*Generated by OpenAdab host adapter. Do not edit manually unless you know what you are doing.*',
      ].join('\n');
      return { path: `.agents/skills/adab-${cmd.name}/SKILL.md`, content };
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
   * @param files Array of command definitions.
   * @returns Array of generated files.
   */
  generate(files: CommandDef[]): GeneratedFile[] {
    const lines: string[] = ['# OpenAdab Commands', ''];
    for (const cmd of files) {
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
      if (cmd.parameters.length > 0) {
        lines.push('### Parameters');
        for (const p of cmd.parameters) {
          const req = p.required ? ' (required)' : '';
          const def = p.default !== undefined ? ` — default: \`${p.default}\`` : '';
          lines.push(`- \`${p.name}\` (${p.type})${req}${def}`);
        }
        lines.push('');
      }
      lines.push('### Workflow');
      for (const step of cmd.steps) {
        if (step.action === 'cli' && step.command !== undefined) {
          lines.push(`1. Run \`${this.interpolateParameters(step.command, { change: '<change-id>', artifact: '<artifact-id>' })}\``);
        } else if (step.action === 'read' && step.paths !== undefined) {
          lines.push(`2. Read \`${step.paths}\``);
        } else if (step.action === 'write' && step.path !== undefined) {
          lines.push(`3. Write output to \`${step.path}\``);
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
      sections.push('## Output', '', `Write the generated content to: \`${this.context.outputPath}\``, '');
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
      // Backtrack to the last complete `## ` section boundary
      const lastSection = content.lastIndexOf('\n## ');
      if (lastSection > 0) {
        content = content.slice(0, lastSection);
      }
      content += '\n\n[Content truncated to fit token budget]\n';
    }

    return [{ path: 'PROMPT.md', content }];
  }
}

import { AdapterFactory } from './adapter-factory.js';

// Register built-in adapters
AdapterFactory.register('opencode', OpencodeAdapter);
AdapterFactory.register('cursor', CursorAdapter);
AdapterFactory.register('copilot', CopilotAdapter);
AdapterFactory.register('generic', GenericAdapter);
AdapterFactory.register('monolithic', MonolithicPromptAdapter);

/**
 * Detect the host environment based on directory markers.
 *
 * Checks for the presence of host-specific directories in the project root.
 *
 * @param projectRoot Absolute path to the project root.
 * @returns Detected host name, or `null` if none detected.
 */
export async function detectHost(projectRoot: string): Promise<string | null> {
  const markers: Record<string, string> = {
    '.opencode': 'opencode',
    '.cursor': 'cursor',
    '.github/copilot-instructions.md': 'copilot',
  };
  for (const [dir, host] of Object.entries(markers)) {
    if (await fileExists(join(projectRoot, dir))) {
      return host;
    }
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
 * Write generated files, preserving user modifications when baselines differ.
 *
 * For each generated file:
 * - If the file does not exist, it is created and its hash is stored as a baseline.
 * - If the file exists and its content hash matches the stored baseline, the file
 *   is safely overwritten (user has not modified it).
 * - If the file exists but its content hash differs from the stored baseline,
 *   the file is **skipped** (user has modified it) and a warning is emitted.
 *
 * @param projectRoot Absolute path to the project root.
 * @param files       Array of generated files.
 * @returns Array of paths that were written.
 */
export async function isUnchanged(filePath: string, expectedContent: string): Promise<boolean> {
  const existingContent = await safeReadFile(filePath);
  if (existingContent === null) {
    return false;
  }
  return existingContent === expectedContent;
}

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

        if (baselineHash !== undefined && existingHash !== baselineHash) {
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
