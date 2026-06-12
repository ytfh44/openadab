/**
 * Project Init Module — scaffolds a new OpenAdab project directory.
 */
import { open, readFile, readdir, copyFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';

import YAML from 'yaml';

import { AdabError } from '../../utils/errors.js';
import { atomicWriteFile, ensureDir, fileExists, safeReadFile } from '../../utils/fs.js';
import { resolveBuiltInSchemasDir, resolveCommandsDir } from '../../utils/resource-paths.js';
import {
  detectHost,
  CommandDefLoader,
  writeGeneratedFiles,
} from '../host-adapters/index.js';
import { AdapterFactory } from '../host-adapters/adapter-factory.js';

/**
 * Options passed to {@link ProjectInitializer.init}.
 */
export interface InitOptions {
  /**
   * Schema name to set as active in the generated config.  Must reference
   * a directory under `src/schemas/built-in/` (PI-6) — unknown values
   * raise `SCHEMA_NOT_FOUND` so the failure happens at init time, not
   * later when a command actually tries to use the schema.
   */
  schema?: string;
  /**
   * Host adapter to generate (auto-detected if omitted).
   */
  host?: string;
}

/**
 * Scaffolds the `adab/` directory structure, default config, wiki templates,
 * built-in schemas, index files, and log for a fresh OpenAdab project.
 */
export class ProjectInitializer {
  private readonly targetDir: string;
  private readonly lockPath: string;
  private lockFd: { close: () => Promise<void> } | null = null;

  /**
   * @param targetDir Absolute path to the target project root.
   */
  constructor(targetDir: string) {
    this.targetDir = targetDir;
    this.lockPath = join(targetDir, '.openadab-init.lock');
  }

  /**
   * Initialize a new OpenAdab project.
   *
   * Creates all required directories, default files, and built-in schema copies.
   * If `adab/` exists but `config.yaml` is missing (half-initialized state),
   * automatically recovers by creating only the missing pieces — pre-existing
   * user content (PI-1) such as a custom `wiki/index.md`, `log.md`, an index
   * JSON, or a `forked_from` schema directory is left untouched.
   *
   * The function is concurrency-safe (PI-2): a lock file
   * `.openadab-init.lock` is created with `O_EXCL` semantics at the start
   * of the run and removed on completion.  A second init attempt while the
   * lock is held fails with `INIT_LOCKED`.
   *
   * @param options Optional initialization overrides.
   * @throws {AdabError} If the project has already been fully initialized,
   *                     the schema name is unknown, or the lock is held.
   */
  async init(options: InitOptions = {}): Promise<void> {
    const adabDir = join(this.targetDir, 'adab');
    const configPath = join(adabDir, 'config.yaml');

    if (options.schema !== undefined) {
      await this.validateSchemaName(options.schema);
    }

    await this.acquireLock();
    try {
      const isFullInit = await fileExists(adabDir) && await fileExists(configPath);
      if (isFullInit) {
        throw new AdabError(
          `Project already initialized: ${adabDir} exists. Use \`openadab update\` to refresh schemas and host adapters.`,
          'PROJECT_ALREADY_INITIALIZED'
        );
      }

      // PI-5: both fresh init and half-init recovery share the same
      // scaffold; the `safe` flag flips each user-content writer to
      // "skip if file exists" so we never clobber a half-init user's
      // pre-existing content (PI-1).
      const safe = await fileExists(adabDir);
      await this.scaffoldAll(adabDir, options, safe);
    } finally {
      await this.releaseLock();
    }
  }

  /**
   * Build the full adab/ scaffold.
   *
   * Shared by the fresh-init path and the half-init recovery path (PI-5).
   * When `safe` is `true`, every user-facing content file is written only
   * if it does not already exist; this is what protects pre-existing user
   * content during half-init recovery (PI-1).
   *
   * @param adabDir  Absolute path to the `adab/` directory.
   * @param options  Init options (schema, host hint).
   * @param safe     When `true`, skip writes for files that already exist.
   */
  private async scaffoldAll(adabDir: string, options: InitOptions, safe: boolean): Promise<void> {
    await this.scaffoldDirectories(adabDir);
    await this.createDefaultWikiTemplates(adabDir, safe);
    await this.createDefaultConfig(adabDir, options.schema ?? 'chapter-draft');
    await this.copyBuiltInSchemas(adabDir, safe);
    await this.updateGitignore();
    await this.createLogMd(adabDir, safe);
    await this.createEmptyIndexFiles(adabDir, safe);
    await this.generateHostAdapters(options.host, adabDir, safe);
  }

  /**
   * Acquire the init lock.
   *
   * Uses the `wx` open flag (equivalent to `O_EXCL | O_CREAT`) so a second
   * concurrent call fails with `EEXIST` (PI-2).  The lock file's contents
   * record the PID for debugging.
   *
   * @throws {AdabError} With code `INIT_LOCKED` if the lock is already held.
   */
  private async acquireLock(): Promise<void> {
    try {
      this.lockFd = await open(this.lockPath, 'wx');
      await this.lockFd.writeFile(`${String(process.pid)}\n`, 'utf-8');
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EEXIST') {
        throw new AdabError(
          `Another 'openadab init' appears to be in progress (lock file: ${this.lockPath}). ` +
          `If the previous run was interrupted, remove the lock file and retry.`,
          'INIT_LOCKED'
        );
      }
      throw err;
    }
  }

  /**
   * Release the init lock acquired by {@link acquireLock}.
   *
   * Closes the file handle and removes the lock file.  Both steps are
   * best-effort: a failure here is logged but not surfaced to the caller.
   */
  private async releaseLock(): Promise<void> {
    if (this.lockFd) {
      try { await this.lockFd.close(); } catch { /* best effort */ }
      this.lockFd = null;
    }
    try {
      await unlink(this.lockPath);
    } catch {
      // best effort
    }
  }

  /**
   * Confirm a user-supplied `--schema <name>` actually exists in the
   * built-in schemas directory (PI-6).  Prevents silent typos from
   * generating an unusable `config.yaml`.
   *
   * @param name Schema name to validate.
   * @throws {AdabError} With code `SCHEMA_NOT_FOUND` when the name does
   *                     not match any built-in schema directory.
   */
  private async validateSchemaName(name: string): Promise<void> {
    let builtInDir: string;
    try {
      builtInDir = resolveBuiltInSchemasDir(import.meta.url);
    } catch {
      // Cannot locate built-ins — defer to a runtime error if the
      // schemas copy later fails.  init() still proceeds.
      return;
    }
    if (!(await fileExists(builtInDir))) {
      return;
    }
    const entries = await readdir(builtInDir, { withFileTypes: true });
    const names = entries.filter((e) => e.isDirectory()).map((e) => e.name);
    if (!names.includes(name)) {
      throw new AdabError(
        `Unknown built-in schema: "${name}". Available: ${names.join(', ') || 'none'}`,
        'SCHEMA_NOT_FOUND'
      );
    }
  }

  private async scaffoldDirectories(adabDir: string): Promise<void> {
    const dirs = [
      join(adabDir, 'manuscript'),
      join(adabDir, 'manuscript', 'chapters'),
      join(adabDir, 'manuscript', 'scenes'),
      join(adabDir, 'wiki'),
      join(adabDir, 'wiki', 'characters'),
      join(adabDir, 'wiki', 'locations'),
      join(adabDir, 'wiki', 'factions'),
      join(adabDir, 'wiki', 'objects'),
      join(adabDir, 'wiki', 'timeline'),
      join(adabDir, 'wiki', 'threads'),
      join(adabDir, 'wiki', 'motifs'),
      join(adabDir, 'wiki', 'style'),
      join(adabDir, 'raw'),
      join(adabDir, 'raw', 'notes'),
      join(adabDir, 'raw', 'research'),
      join(adabDir, 'raw', 'imported-drafts'),
      join(adabDir, 'raw', 'references'),
      join(adabDir, 'changes'),
      join(adabDir, 'changes', 'archive'),
      join(adabDir, 'schemas'),
      join(adabDir, 'index'),
    ];
    for (const d of dirs) {
      await ensureDir(d);
    }
    // adab/index/ is gitignored — .gitkeep would be noise
    const gitkeepDirs = dirs.filter((d) => d !== join(adabDir, 'index'));
    for (const d of gitkeepDirs) {
      await atomicWriteFile(join(d, '.gitkeep'), '');
    }
  }

  private async createDefaultWikiTemplates(adabDir: string, safe = false): Promise<void> {
    // PI-3: capture a single timestamp so the three templates agree to
    // the millisecond.  Otherwise the same init run could end up with
    // three different `created:` values that hint at inconsistent
    // authorship.
    const now = new Date().toISOString();
    const indexMd = `---
type: index
created: ${now}
---

# Wiki Index

<!-- TOC will be regenerated by the wiki engine -->
`;
    const overviewMd = `---
type: overview
created: ${now}
---

# Overview

## Setting

## Characters

## Conflict

## Current State
`;
    const contradictionsMd = `---
type: contradictions
created: ${now}
---

# Contradictions

<!-- Contradiction entries are appended by the wiki-diff engine -->
`;
    if (safe) {
      await this.writeIfMissing(join(adabDir, 'wiki', 'index.md'), indexMd);
      await this.writeIfMissing(join(adabDir, 'wiki', 'overview.md'), overviewMd);
      await this.writeIfMissing(join(adabDir, 'wiki', 'contradictions.md'), contradictionsMd);
    } else {
      await atomicWriteFile(join(adabDir, 'wiki', 'index.md'), indexMd);
      await atomicWriteFile(join(adabDir, 'wiki', 'overview.md'), overviewMd);
      await atomicWriteFile(join(adabDir, 'wiki', 'contradictions.md'), contradictionsMd);
    }
  }

  private async createDefaultConfig(adabDir: string, schema: string): Promise<void> {
    const config = {
      schema,
      version: 1,
      project: {
        title: 'Untitled Novel',
        language: 'zh-CN',
        genre: 'fantasy',
        tense: 'past',
        pov: 'limited-third',
      },
      context: {
        maxTokens: 18000,
        alwaysInclude: [],
        tokenHeuristic: 'chars-per-token',
        excludePatterns: [],
      },
      rules: {},
      archive: {
        backupOnOverwrite: false,
      },
    };
    await atomicWriteFile(join(adabDir, 'config.yaml'), YAML.stringify(config, { indent: 2, lineWidth: 0 }));
  }

  private async copyBuiltInSchemas(adabDir: string, safe = false): Promise<void> {
    const builtInDir = resolveBuiltInSchemasDir(import.meta.url);
    if (!(await fileExists(builtInDir))) {
      throw new AdabError(
        `Built-in schema source directory not found: ${builtInDir}`,
        'BUILT_IN_SCHEMAS_NOT_FOUND'
      );
    }
    const entries = await readdir(builtInDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) {continue;}
      const srcDir = join(builtInDir, entry.name);
      const destDir = join(adabDir, 'schemas', entry.name);
      // PI-1: never clobber a user-forked schema.  The spec requires
      // preserving schemas whose schema.yaml contains `forked_from`.
      if (await this.isForkedSchema(destDir)) {
        continue;
      }
      await ensureDir(destDir);
      await this.copyDirContents(srcDir, destDir, safe);
    }
  }

  /**
   * Detect a user-forked schema directory.
   *
   * A schema is considered "forked" when its `schema.yaml` parses
   * successfully and contains a `forked_from` field.  Missing or
   * unparseable files are treated as not-forked so the recovery flow
   * can still rebuild a broken directory.
   *
   * @param schemaDir Absolute path to the project's schema directory.
   * @returns `true` when the directory contains a forked schema.
   */
  private async isForkedSchema(schemaDir: string): Promise<boolean> {
    if (!(await fileExists(schemaDir))) {
      return false;
    }
    const schemaPath = join(schemaDir, 'schema.yaml');
    const raw = await safeReadFile(schemaPath);
    if (raw === null) {
      return false;
    }
    try {
      const parsed = YAML.parse(raw) as Record<string, unknown> | null;
      if (parsed === null || typeof parsed !== 'object') {
        return false;
      }
      return parsed.forked_from !== undefined;
    } catch {
      return false;
    }
  }

  private async copyDirContents(src: string, dest: string, safe = false): Promise<void> {
    const entries = await readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(src, entry.name);
      const destPath = join(dest, entry.name);
      if (entry.isDirectory()) {
        await ensureDir(destPath);
        await this.copyDirContents(srcPath, destPath, safe);
      } else {
        if (safe && (await fileExists(destPath))) {
          // PI-1: in safe mode, never overwrite an existing template.
          continue;
        }
        await copyFile(srcPath, destPath);
      }
    }
  }

  private async updateGitignore(): Promise<void> {
    const gitignorePath = join(this.targetDir, '.gitignore');
    // PI-4: use the spec's single `.last-indexed` filename; the legacy
    // `.last-mention-indexed` / `.last-progression-indexed` split is
    // what the codebase had drifted to, but the spec wording is the
    // source of truth.
    const lines = [
      'adab/index/*.json',
      'adab/index/.last-indexed',
      'adab/log.md',
      'adab/wiki/index.md',
      'adab/wiki/overview.md',
      'adab/wiki/contradictions.md',
    ];
    let content = '';
    if (await fileExists(gitignorePath)) {
      content = await readFile(gitignorePath, 'utf-8');
    }
    for (const line of lines) {
      const isDuplicate = content.split('\n').some((l) => {
        const trimmed = l.trim();
        return trimmed === line || (trimmed.startsWith('# ') && trimmed.slice(2) === line);
      });
      if (isDuplicate) {
        // PI-7: surface a warning instead of silently skipping the
        // duplicate.  Users can audit the .gitignore to confirm
        // intent and avoid accidental double entries from prior runs.
        console.warn(`[ProjectInit] .gitignore already contains "${line}"; skipping.`);
        continue;
      }
      const prefix = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      content += `${prefix}${line}\n`;
    }
    await atomicWriteFile(gitignorePath, content);
  }

  private async createLogMd(adabDir: string, safe = false): Promise<void> {
    const now = new Date().toISOString();
    const payload = JSON.stringify({ ts: now, op: 'init', change: null, result: 'success' });
    const content = `<!-- log-entry ${payload} -->\n- **${now}** \`init\` — success\n\n`;
    if (safe) {
      await this.writeIfMissing(join(adabDir, 'log.md'), content);
    } else {
      await atomicWriteFile(join(adabDir, 'log.md'), content);
    }
  }

  private async createEmptyIndexFiles(adabDir: string, safe = false): Promise<void> {
    const files = ['mentions.json', 'wikilinks.json', 'progressions.json', 'context-map.json'];
    for (const f of files) {
      if (safe) {
        await this.writeIfMissing(join(adabDir, 'index', f), '{}');
      } else {
        await atomicWriteFile(join(adabDir, 'index', f), '{}');
      }
    }
  }

  /**
   * Write `content` to `path` only when the file does not already exist.
   *
   * Used by the half-init recovery path (PI-1) so user-supplied files
   * (curated wiki pages, running log entries, populated index JSONs)
   * are preserved verbatim.
   *
   * @param path    Absolute file path.
   * @param content Default content to write when the file is missing.
   */
  private async writeIfMissing(path: string, content: string): Promise<void> {
    if (await fileExists(path)) {
      return;
    }
    await atomicWriteFile(path, content);
  }

  /**
   * Generate host-native adapter files for the detected (or hinted) host.
   *
   * Errors are caught and recorded in two places (PI-8):
   *   1. `console.warn` for the immediate operator.
   *   2. `adab/log.md` so the failure is durably captured next to the
   *      successful `init` entry and can be inspected without rerunning
   *      the tool.
   *
   * @param hostHint Optional host name to override auto-detection.
   * @param adabDir  Absolute path to the `adab/` directory; used to
   *                 write the warning entry into `adab/log.md`.
   * @param safe     When `true`, the log.md is appended to (never
   *                 overwritten) so a pre-existing user log is preserved.
   */
  private async generateHostAdapters(hostHint: string | undefined, adabDir: string, safe: boolean): Promise<void> {
    let host: string | null;
    try {
      host = hostHint ?? (await detectHost(this.targetDir));
    } catch (err) {
      console.warn('[ProjectInit] Host detection failed:', err instanceof Error ? err.message : String(err));
      host = null;
    }
    if (host === null) {
      host = 'generic';
    }

    const commandsDir = resolveCommandsDir(import.meta.url);
    if (!(await fileExists(commandsDir))) {
      return;
    }

    let defs;
    try {
      defs = await new CommandDefLoader(commandsDir).loadAll();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ProjectInit] Command definition loading failed:', msg);
      await this.appendLogWarning(adabDir, `command definition loading failed: ${msg}`, safe);
      return;
    }
    if (defs.length === 0) {
      return;
    }

    let adapter;
    try {
      adapter = AdapterFactory.create(host);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ProjectInit] Adapter creation failed:', msg);
      await this.appendLogWarning(adabDir, `adapter creation failed: ${msg}`, safe);
      return;
    }

    let files;
    try {
      files = adapter.generate(defs);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ProjectInit] Adapter file generation failed:', msg);
      await this.appendLogWarning(adabDir, `adapter file generation failed: ${msg}`, safe);
      return;
    }

    try {
      await writeGeneratedFiles(this.targetDir, files);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn('[ProjectInit] Failed to write generated adapter files:', msg);
      await this.appendLogWarning(adabDir, `writing generated adapter files failed: ${msg}`, safe);
    }
  }

  /**
   * Append a structured warning entry to `adab/log.md`.
   *
   * Used by {@link generateHostAdapters} (PI-8) when a non-fatal step
   * fails.  The entry uses the same HTML-comment / human-readable pair
   * as {@link createLogMd} so log scrapers can parse it.
   *
   * PI-1 takes precedence: in `safe` mode (half-init recovery) the
   * user's pre-existing `log.md` is left untouched.  Warnings are
   * still surfaced via `console.warn`; they are simply not forced
   * into a user-owned log file.
   *
   * @param adabDir Absolute path to the `adab/` directory.
   * @param message Human-readable warning text.
   * @param safe    When `true`, do not write to log.md at all.
   */
  private async appendLogWarning(adabDir: string, message: string, safe: boolean): Promise<void> {
    if (safe) {
      // PI-1: user-owned log.md must not be appended to.
      return;
    }
    const logPath = join(adabDir, 'log.md');
    const now = new Date().toISOString();
    const payload = JSON.stringify({ ts: now, op: 'init-warning', change: null, result: message });
    const line = `<!-- log-entry ${payload} -->\n- **${now}** \`init-warning\` — ${message}\n\n`;
    try {
      if (await fileExists(logPath)) {
        const existing = await readFile(logPath, 'utf-8');
        await atomicWriteFile(logPath, `${existing}${line}`);
      } else {
        await atomicWriteFile(logPath, line);
      }
    } catch {
      // log.md is best-effort; do not let it crash init.
    }
  }
}
