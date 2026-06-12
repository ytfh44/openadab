/**
 * Wiki Engine — provides CRUD operations for wiki pages, index generation,
 * wikilink graph construction, and contradiction management.
 */
import { unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import glob from 'fast-glob';
import matter from 'gray-matter';
import { z } from 'zod';

import type { WikiPage } from '../../schemas/types.js';
import type { WikiDiffOperation } from '../../schemas/wiki-diff.js';
import { TargetNotFoundError, AdabError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';
import { extractWikiLinks } from '../../utils/markdown.js';
import { resolveWikiPage } from '../../utils/path.js';

/**
 * Valid wiki page types.
 */
export type WikiPageType = 'character' | 'location' | 'faction' | 'timeline' | 'thread' | 'style' | 'motif' | 'other';

/**
 * Base frontmatter schema shared by all wiki page types.
 *
 * `.passthrough()` is used so that custom user-defined fields are preserved
 * through validation. The spec requires that existing frontmatter fields not
 * explicitly changed during a write are preserved; stripping unknown keys
 * would violate that contract.
 */
export const BaseFrontmatterSchema = z.object({
  type: z.string(),
  name: z.string().min(1).optional(),
  status: z.string().optional(),
  first_seen: z.string().optional(),
  last_updated: z.string().optional(),
  sources: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  aliases: z.array(z.string()).optional(),
}).passthrough();

/**
 * Character-specific frontmatter schema.
 *
 * Required: type, name, status.
 */
export const CharacterFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('character'),
  name: z.string().min(1),
  status: z.string().min(1),
});

/**
 * Location-specific frontmatter schema.
 *
 * Required: type, name, location_type.
 */
export const LocationFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('location'),
  name: z.string().min(1),
  location_type: z.string().min(1),
});

/**
 * Thread-specific frontmatter schema.
 *
 * Required: type, status.
 */
export const ThreadFrontmatterSchema = BaseFrontmatterSchema.extend({
  type: z.literal('thread'),
  status: z.enum(['open', 'advanced', 'resolved']),
});

/**
 * Union of all per-type frontmatter schemas.
 */
export const FrontmatterSchema = z.union([
  CharacterFrontmatterSchema,
  LocationFrontmatterSchema,
  ThreadFrontmatterSchema,
  BaseFrontmatterSchema,
]);

/**
 * Entry in the wikilink graph.
 */
export interface WikilinkEntry {
  /** Pages this page links to. */
  links: string[];
  /** Pages that link to this page. */
  backlinks: string[];
  /** Whether any forward links point to non-existent pages. */
  broken: boolean;
}

/**
 * Full wikilink graph structure.
 */
export type WikilinkGraph = Record<string, WikilinkEntry>;

/**
 * Log callback type for recording index/overview/wikilinks updates.
 */
export interface LogCallback {
  (entry: { op: string; change: string | null; result: string }): void;
}

/**
 * A single issue reported by the wiki engine's linting surface.
 *
 * Issues are accumulated by {@link WikiEngine.checkSystemPages} and surfaced
 * to the CLI for the `wiki lint` command.  The CLI decides whether to treat
 * them as warnings or errors based on {@link severity}.
 */
export interface LintIssue {
  /** Severity classification; the CLI promotes errors to non-zero exit codes. */
  severity: 'warning' | 'error';
  /** Basename of the offending file (e.g. `index.md`). */
  file: string;
  /** Human-readable description of the issue. */
  message: string;
}

/**
 * Core engine for managing project wiki pages.
 */
export class WikiEngine {
  private readonly projectRoot: string;
  private readonly logWriter: LogCallback | null;
  private batchMode: boolean;
  private generatingIndex: boolean;
  private indexDirty: boolean;

  /**
   * @param projectRoot Absolute path to the project root.
   * @param logWriter   Optional callback for recording operations to log.md.
   */
  constructor(projectRoot: string, logWriter?: LogCallback) {
    this.projectRoot = projectRoot;
    this.logWriter = logWriter ?? null;
    this.batchMode = false;
    this.generatingIndex = false;
    this.indexDirty = false;
  }

  /**
   * Enter batch mode: defer index regeneration until `endBatch()`.
   */
  beginBatch(): void {
    this.batchMode = true;
  }

  /**
   * Exit batch mode and regenerate the wiki index once.
   *
   * Index regeneration is guarded against re-entrant calls: if a write or
   * delete is already regenerating the index, this call does not start a
   * second regeneration. Instead, the running regeneration's dirty-flag
   * re-check loop will pick up any pending writes when it completes.
   */
  async endBatch(): Promise<void> {
    this.batchMode = false;
    if (!this.generatingIndex) {
      await this.regenerateIndexAndWikilinks();
    }
  }

  /**
   * Regenerate the index and wikilinks, re-running if writes occurred
   * during the regeneration.
   *
   * Uses a dirty-flag loop so that concurrent or interleaved writes
   * (which set `indexDirty` and skip regen because `generatingIndex` is
   * already true) are picked up by the next iteration after the current
   * regeneration finishes. This avoids the lost-write window where a write
   * that landed between `listPages` and the file write of `index.md` would
   * otherwise never appear in the index.
   */
  private async regenerateIndexAndWikilinks(): Promise<void> {
    this.generatingIndex = true;
    try {
      do {
        this.indexDirty = false;
        await this.generateIndex();
        await this.generateWikilinks();
      } while (this.indexDirty);
    } finally {
      this.generatingIndex = false;
    }
  }

  /**
   * Read a wiki page, parse its frontmatter, and validate per-type schema.
   *
   * If the page has no frontmatter, or the parsed frontmatter is missing
   * the required `type` field, or the `type` field is an empty string or
   * `null` (the latter can happen when gray-matter parses `type:` with no
   * value), this method falls back to a synthetic frontmatter with
   * `{ type: options.fallbackType ?? 'unknown', title: pagePath, _synthetic: true }`.
   * This prevents pages from silently disappearing from `listPages` when a
   * type filter is applied.  Other frontmatter validation failures
   * (e.g. missing required fields for a known type, invalid enum values,
   * or an unknown `type` string) still throw an error.
   *
   * @param pagePath  Wiki page path relative to `adab/wiki/` (e.g. `characters/mara.md`).
   * @param options   Optional fallback options.
   * @param options.fallbackType  The `type` value to use for synthetic frontmatter. Defaults to `'unknown'`.
   * @returns Parsed wiki page with frontmatter and body.
   * @throws {TargetNotFoundError} If the page file does not exist.
   * @throws {AdabError} If frontmatter validation fails for reasons other than a missing or empty `type` field.
   */
  async readPage(pagePath: string, options: { fallbackType?: string } = {}): Promise<WikiPage> {
    const absPath = await resolveWikiPage(this.projectRoot, pagePath);
    const raw = await safeReadFile(absPath);
    if (raw === null) {
      throw new TargetNotFoundError(`Wiki page not found: ${pagePath}`);
    }
    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;
    const rawType = frontmatter.type;
    const hasMeaningfulType =
      Object.prototype.hasOwnProperty.call(frontmatter, 'type') &&
      typeof rawType === 'string' &&
      rawType.length > 0;

    if (!hasMeaningfulType) {
      const syntheticFrontmatter = {
        type: options.fallbackType ?? 'unknown',
        title: pagePath,
        _synthetic: true,
      };
      return {
        path: pagePath,
        frontmatter: syntheticFrontmatter,
        body: parsed.content,
      };
    }

    this.validateFrontmatter(frontmatter, pagePath);
    return {
      path: pagePath,
      frontmatter,
      body: parsed.content,
    };
  }

  /**
   * Write a wiki page with YAML frontmatter and Markdown body.
   *
   * Automatically updates `last_updated` to the current ISO timestamp.
   * Validates frontmatter before writing.  Existing frontmatter fields not
   * explicitly mentioned in the incoming `frontmatter` argument are
   * preserved, including unknown custom fields (see {@link BaseFrontmatterSchema}
   * which uses `.passthrough()`).
   *
   * Atomicity: the file write itself is atomic via
   * {@link atomicWriteFile} (temp file + rename).  `matter.stringify` is
   * called synchronously before the temp file is created, so a failure in
   * YAML serialization does not leave a stray temp file behind.  Callers
   * MUST pass a plain object for `frontmatter` (no `Map`, no `Symbol`
   * keys, no functions) — these are the documented gray-matter
   * serialization contract.  Passing a non-plain object will throw
   * synchronously from `matter.stringify` without touching the
   * filesystem.
   *
   * @param pagePath    Wiki page path relative to `adab/wiki/`.
   * @param frontmatter Frontmatter object to serialize (must be plain).
   * @param body        Markdown body.
   * @throws {AdabError} If frontmatter validation fails.
   */
  async writePage(pagePath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    const absPath = await resolveWikiPage(this.projectRoot, pagePath);
    let merged = { ...frontmatter };
    const raw = await safeReadFile(absPath);
    if (raw !== null) {
      const existing = matter(raw);
      merged = { ...existing.data, ...frontmatter };
    }
    const validated = this.validateFrontmatter(merged, pagePath);
    validated.last_updated = new Date().toISOString();
    await ensureDir(dirname(absPath));
    const output = matter.stringify(body, validated);
    await atomicWriteFile(absPath, output);
    if (this.batchMode) {
      this.indexDirty = true;
    } else if (this.generatingIndex) {
      // A regen is already running; mark dirty so it re-runs after
      // completion to pick up our write.
      this.indexDirty = true;
    } else {
      await this.regenerateIndexAndWikilinks();
    }
  }

  /**
   * List all wiki pages, optionally filtered by `type` frontmatter field.
   *
   * @param type Optional page type filter.
   * @returns Array of relative page paths.
   */
  async listPages(type?: WikiPageType): Promise<string[]> {
    const wikiDir = join(this.projectRoot, 'adab', 'wiki');
    const entries = await glob('**/*.md', { cwd: wikiDir, onlyFiles: true });
    const pages = entries.filter((e) => !e.endsWith('index.md') && !e.endsWith('overview.md') && !e.endsWith('contradictions.md'));
    if (!type) {
      return pages;
    }
    const filtered: string[] = [];
    for (const page of pages) {
      try {
        const wikiPage = await this.readPage(page);
        if (wikiPage.frontmatter.type === type) {
          filtered.push(page);
        }
      } catch (err) {
        console.warn('[WikiEngine] Skipped unreadable page during listPages filtering:', err instanceof Error ? err.message : String(err));
      }
    }
    return filtered;
  }

  /**
   * Delete a wiki page file.
   *
   * @param pagePath Wiki page path relative to `adab/wiki/`.
   * @throws {TargetNotFoundError} If the page does not exist.
   */
  async deletePage(pagePath: string): Promise<void> {
    const absPath = await resolveWikiPage(this.projectRoot, pagePath);
    if (!(await fileExists(absPath))) {
      throw new TargetNotFoundError(`Wiki page not found: ${pagePath}`);
    }
    await unlink(absPath);
    if (this.batchMode) {
      this.indexDirty = true;
    } else if (this.generatingIndex) {
      this.indexDirty = true;
    } else {
      await this.regenerateIndexAndWikilinks();
    }
  }

  /**
   * Inspect the three system-generated wiki files (`index.md`, `overview.md`,
   * `contradictions.md`) and report any issues found.
   *
   * Unlike {@link listPages}, this method does not exclude these files — it
   * treats them as first-class lint targets because the `wiki index`,
   * `wiki overview`, and contradiction management commands can silently
   * produce stale or malformed output, which would then mislead downstream
   * commands such as `wiki diff --from <page>`.
   *
   * Severity rules:
   *  - A missing system file yields a `warning` (the project may simply
   *    never have generated that artifact yet).
   *  - A present file whose frontmatter cannot be parsed or validated
   *    yields an `error` (the file is corrupted and should be regenerated).
   *    This includes the case where the file declares a frontmatter
   *    block (starts with `---`) but the parsed frontmatter has no
   *    `type` field, or has a `type` value outside the closed set
   *    of allowed wiki page types.
   *  - A present file with no frontmatter markers at all is treated as
   *    valid, because `generateIndex` and `generateOverview` write pure
   *    markdown without frontmatter; such files are exercised through
   *    the synthetic frontmatter fallback in {@link readPage} and
   *    produce a `_synthetic: true` flag.
   *
   * This method never throws — it returns the accumulated issues so the
   * caller can decide how to surface them.
   *
   * @returns Array of {@link LintIssue} entries, one per detected problem.
   */
  async checkSystemPages(): Promise<LintIssue[]> {
    const issues: LintIssue[] = [];
    const systemFiles = ['index.md', 'overview.md', 'contradictions.md'] as const;
    const wikiDir = join(this.projectRoot, 'adab', 'wiki');
    for (const file of systemFiles) {
      const filePath = join(wikiDir, file);
      if (!(await fileExists(filePath))) {
        issues.push({ severity: 'warning', file, message: 'System page missing' });
        continue;
      }
      // A system file that declares a frontmatter block but is
      // missing the required `type` field (or has a `type` value that is
      // not in the closed allow-list) must be reported as an error, even
      // though `readPage` would otherwise fall back to a synthetic
      // frontmatter.  Read the raw bytes first and check for an opening
      // frontmatter marker; if present, validate the parsed frontmatter
      // strictly so a corrupted file is not silently passed.
      const raw = await safeReadFile(filePath);
      if (raw === null) {
        issues.push({ severity: 'warning', file, message: 'System page unreadable' });
        continue;
      }
      const hasFrontmatterMarker = /^\s*---\s*$/m.test(raw.split('\n').slice(0, 2).join('\n'));
      if (hasFrontmatterMarker) {
        try {
          const parsed = matter(raw);
          const data = parsed.data as Record<string, unknown>;
          const rawType = data.type;
          const typeIsString = typeof rawType === 'string';
          const typeIsNonEmpty = typeIsString && (rawType as string).length > 0;
          if (!typeIsNonEmpty) {
            issues.push({
              severity: 'error',
              file,
              message: 'Failed to parse frontmatter: missing required `type` field',
            });
            continue;
          }
          this.validateFrontmatter(data, file);
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          issues.push({ severity: 'error', file, message: `Failed to parse frontmatter: ${detail}` });
        }
        continue;
      }
      // No frontmatter markers — exercise the synthetic fallback via
      // readPage so future schema strictness can be added without
      // re-introducing the corruption blind spot.
      try {
        await this.readPage(file);
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        issues.push({ severity: 'error', file, message: `Failed to parse frontmatter: ${detail}` });
      }
    }
    return issues;
  }

  /**
   * Generate `adab/wiki/index.md` with a table of contents grouped by type.
   *
   * Each entry is a `[[type/name]]` link with a brief summary.
   */
  async generateIndex(): Promise<void> {
    const pages = await this.listPages();
    const groups = new Map<string, { path: string; type: string; name: string; status: string; summary: string }[]>();

    for (const pagePath of pages) {
      try {
        const page = await this.readPage(pagePath);
        const type = (page.frontmatter.type as string | undefined) ?? 'other';
        const name = (page.frontmatter.name as string | undefined) ?? pagePath;
        const status = (page.frontmatter.status as string | undefined) ?? '';
        const summary = this.extractSummary(page.body);
        if (!groups.has(type)) {
          groups.set(type, []);
        }
        const group = groups.get(type);
        if (group !== undefined) {
          group.push({ path: pagePath.replace(/\.md$/, ''), type, name, status, summary });
        }
      } catch (err) {
        console.warn('[WikiEngine] Skipped unreadable page during index generation:', err instanceof Error ? err.message : String(err));
      }
    }

    const lines: string[] = ['# Wiki Index\n'];
    for (const [type, entries] of groups) {
      lines.push(`## ${this.typeLabel(type)}\n`);
      for (const entry of entries) {
        // use the lowercase page path (e.g. `characters/mara`) as the
        // wikilink target, not the original-case `type/name` from frontmatter.
        // The spec requires the link target to be the page's file path so the
        // link is stable regardless of how the human chose to name the page.
        lines.push(`- [[${entry.path}]] — ${entry.name} (${entry.status})`);
        if (entry.summary) {
          lines.push(`  - ${entry.summary}`);
        }
      }
      lines.push('');
    }

    const indexPath = join(this.projectRoot, 'adab', 'wiki', 'index.md');
    await atomicWriteFile(indexPath, lines.join('\n'));
    this.logWriter?.({ op: 'generateIndex', change: null, result: `Generated index with ${String(lines.length)} lines` });
  }

  /**
   * Generate `adab/wiki/overview.md` synopsis from wiki pages.
   *
   * Summarizes setting, characters, conflict, and current state.
   */
  async generateOverview(): Promise<void> {
    const pages = await this.listPages();
    const characters: { name: string; status: string }[] = [];
    const locations: { name: string; location_type: string }[] = [];
    const threads: { name: string; status: string }[] = [];

    for (const pagePath of pages) {
      try {
        const page = await this.readPage(pagePath);
        const type = (page.frontmatter.type as string | undefined) ?? '';
        const name = (page.frontmatter.name as string | undefined) ?? '';
        if (type === 'character' && page.frontmatter.status === 'canon') {
          characters.push({ name, status: (page.frontmatter.status as string | undefined) ?? '' });
        } else if (type === 'location') {
          locations.push({ name, location_type: (page.frontmatter.location_type as string | undefined) ?? '' });
        } else if (type === 'thread') {
          threads.push({ name, status: (page.frontmatter.status as string | undefined) ?? '' });
        }
      } catch (err) {
        console.warn('[WikiEngine] Skipped unreadable page during overview generation:', err instanceof Error ? err.message : String(err));
      }
    }

    const lines: string[] = ['# Story Overview\n'];

    lines.push('## Setting\n');
    for (const loc of locations) {
      lines.push(`- ${loc.name} (${loc.location_type})`);
    }
    if (locations.length === 0) {lines.push('- No locations recorded.');}
    lines.push('');

    lines.push('## Main Characters\n');
    for (const char of characters) {
      lines.push(`- ${char.name} — ${char.status}`);
    }
    if (characters.length === 0) {lines.push('- No characters recorded.');}
    lines.push('');

    lines.push('## Conflict\n');
    const activeThreads = threads.filter((t) => t.status === 'open' || t.status === 'advanced');
    for (const thread of activeThreads) {
      lines.push(`- ${thread.name} (${thread.status})`);
    }
    if (activeThreads.length === 0) {lines.push('- No active threads recorded.');}
    lines.push('');

    lines.push('## Current State\n');
    lines.push(`- ${String(threads.length)} thread(s), ${String(activeThreads.length)} active.`);
    lines.push(`- ${String(characters.length)} character(s).`);
    lines.push(`- ${String(locations.length)} location(s).`);
    lines.push('');

    const overviewPath = join(this.projectRoot, 'adab', 'wiki', 'overview.md');
    await atomicWriteFile(overviewPath, lines.join('\n'));
  }

  /**
   * Scan all wiki pages for `[[...]]` syntax and build `adab/index/wikilinks.json`.
   *
   * The graph includes forward links, backlinks, and broken-link flags.
   * Each link is normalized to its page-path form (no `.md` extension)
   * exactly once, before being stored in `links`; downstream consumers
   * (broken-link check, backlink pass) reuse the already-normalized value
   * to avoid redundant `replace` calls.
   */
  async generateWikilinks(): Promise<void> {
    const pages = await this.listPages();
    const graph: WikilinkGraph = {};
    const allPaths = new Set(pages.map((p) => p.replace(/\.md$/, '')));

    for (const pagePath of pages) {
      try {
        const page = await this.readPage(pagePath);
        const links = extractWikiLinks(page.body).map((l) => l.replace(/\.md$/, ''));
        const normalizedPath = pagePath.replace(/\.md$/, '');
        graph[normalizedPath] = {
          links,
          backlinks: [],
          // `links` is already normalized on the line above, so the
          // redundant `l.replace(/\.md$/, '')` here was a no-op; use `l` directly.
          broken: links.some((l) => !allPaths.has(l)),
        };
      } catch (err) {
        console.warn('[WikiEngine] Skipped unreadable page during wikilink generation:', err instanceof Error ? err.message : String(err));
      }
    }

    for (const [pagePath, entry] of Object.entries(graph)) {
      for (const link of entry.links) {
        // `link` is already normalized; the previous `link.replace`
        // was redundant.
        if (Object.hasOwn(graph, link)) {
          graph[link].backlinks.push(pagePath);
        }
      }
    }

    const indexDir = join(this.projectRoot, 'adab', 'index');
    await ensureDir(indexDir);
    await atomicWriteFile(join(indexDir, 'wikilinks.json'), JSON.stringify(graph, null, 2));
    this.logWriter?.({ op: 'generateWikilinks', change: null, result: `Generated wikilinks graph with ${String(Object.keys(graph).length)} entries` });
  }

  /**
   * Append contradiction entries from wiki-diff operations to `adab/wiki/contradictions.md`.
   *
   * When a flag_contradiction has status 'explained' or 'retconned', the method
   * first checks for an existing unresolved entry with the same description.
   * If found, the existing entry is updated in-place; otherwise a new entry is appended.
   *
   * @param diff Array of wiki-diff operations.
   */
  async updateContradictions(diff: WikiDiffOperation[]): Promise<void> {
    const contradictionsPath = join(this.projectRoot, 'adab', 'wiki', 'contradictions.md');
    let existing = (await safeReadFile(contradictionsPath)) ?? '';

    const unresolvedOps: Array<{ description: string; sources: Array<{ page: string; claim: string }>; status: string }> = [];
    const resolvedOps: Array<{ description: string; sources: Array<{ page: string; claim: string }>; status: string }> = [];

    for (const op of diff) {
      if (op.type === 'flag_contradiction') {
        if (op.status === 'explained' || op.status === 'retconned') {
          resolvedOps.push({ description: op.description, sources: op.sources, status: op.status });
        } else {
          unresolvedOps.push({ description: op.description, sources: op.sources, status: op.status });
        }
      }
    }

    // Process resolved contradictions: update every existing unresolved entry
    // that matches the description, not just the first.
    for (const op of resolvedOps) {
      const escapedDesc = op.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match the section heading and its content up to the next heading or EOF
      const sectionRegex = new RegExp(
        `(## ${escapedDesc}\\n)((?:\\n|.)*?)(?=\\n## |$)`,
        'g',
      );
      // First, determine whether there is at least one unresolved match;
      // if not, treat the operation as a brand-new entry.
      sectionRegex.lastIndex = 0;
      let probe: RegExpExecArray | null;
      let anyUnresolved = false;
      while ((probe = sectionRegex.exec(existing)) !== null) {
        if (probe[2].includes('- Status: unresolved')) {
          anyUnresolved = true;
          break;
        }
      }
      if (!anyUnresolved) {
        unresolvedOps.push(op);
        continue;
      }
      // apply the update to every matching section in a single
      // pass via `String.prototype.replace` with a callback. The previous
      // implementation only called `exec` once, so only the first section
      // was updated; subsequent sections with the same description were
      // left as "unresolved".
      sectionRegex.lastIndex = 0;
      existing = existing.replace(sectionRegex, (full, heading: string, body: string) => {
        if (!body.includes('- Status: unresolved')) {
          return full;
        }
        let updated = body;
        updated = updated.replace(/- Status: unresolved/, `- Status: ${op.status}`);
        if (!updated.includes('- Resolution:')) {
          const source = op.sources[0]?.page ?? '';
          updated = `${updated.trim()}\n- Resolution: ${op.status} by ${source}`;
        }
        return `${heading}${updated}`;
      });
    }

    // Build new entries for append
    const newEntries: string[] = [];
    for (const op of unresolvedOps) {
      newEntries.push(`## ${op.description}\n`);
      for (const src of op.sources) {
        newEntries.push(`- **${src.page}**: ${src.claim}`);
      }
      newEntries.push(`- Status: ${op.status}`);
      if (op.status === 'explained' || op.status === 'retconned') {
        newEntries.push(`- Resolution: ${op.status}`);
      }
      newEntries.push('');
    }

    if (newEntries.length === 0) {
      // Only updates were made (no new entries) — write the updated existing content
      // Only write if the file existed before (to avoid creating empty file)
      if (existing.length > 0) {
        await atomicWriteFile(contradictionsPath, existing.trim() + '\n');
      }
      return;
    }

    // Append new entries to the updated existing content (not fresh read from disk)
    const output = `${existing.trim()}\n${newEntries.join('\n')}`;
    await atomicWriteFile(contradictionsPath, `${output.trim()}\n`);
  }

  /**
   * Validate frontmatter against the appropriate per-type schema.
   *
   * The `type` field must be a non-empty string drawn from the closed set
   * of valid wiki page types (see {@link WikiPageType}).  Empty strings,
   * `null`, and any unrecognized type are rejected with an {@link AdabError}
   * — silently accepting them via {@link BaseFrontmatterSchema} would
   * pollute the type dimension used by `listPages('character')`,
   * `generateIndex`, and downstream commands.
   *
   * @param frontmatter Frontmatter object to validate.
   * @param pagePath    Page path for error messages.
   * @returns Validated frontmatter object.
   * @throws {AdabError} If validation fails.
   */
  private validateFrontmatter(frontmatter: Record<string, unknown>, pagePath: string): Record<string, unknown> {
    const type = frontmatter.type;
    // closed set of allowed types. Mirrors `WikiPageType` but
    // kept as a runtime Set so callers see a clear validation error.
    const ALLOWED_TYPES = new Set<string>([
      'character', 'location', 'faction', 'timeline', 'thread',
      'style', 'motif', 'other',
    ]);
    // empty string, null, undefined, and non-string types are
    // all rejected here, before any per-type schema is consulted.
    if (typeof type !== 'string' || type.length === 0) {
      throw new AdabError(
        `Frontmatter validation failed for ${pagePath}: type must be a non-empty string`,
        'WIKI_FRONTMATTER_INVALID',
      );
    }
    // unknown type strings must be rejected so that
    // `BaseFrontmatterSchema`'s permissive `type: z.string()` does not
    // admit arbitrary values.
    if (!ALLOWED_TYPES.has(type)) {
      throw new AdabError(
        `Frontmatter validation failed for ${pagePath}: unknown type "${type}" (allowed: ${Array.from(ALLOWED_TYPES).join(', ')})`,
        'WIKI_FRONTMATTER_INVALID',
      );
    }
    let result: z.SafeParseReturnType<unknown, unknown>;
    if (type === 'character') {
      result = CharacterFrontmatterSchema.safeParse(frontmatter);
    } else if (type === 'location') {
      result = LocationFrontmatterSchema.safeParse(frontmatter);
    } else if (type === 'thread') {
      result = ThreadFrontmatterSchema.safeParse(frontmatter);
    } else {
      // character/location/thread/faction/timeline/style/motif/other
      // — faction/timeline/style/motif/other all use the base schema.
      result = BaseFrontmatterSchema.safeParse(frontmatter);
    }

    if (!result.success) {
      const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
      throw new AdabError(`Frontmatter validation failed for ${pagePath}: ${issues}`, 'WIKI_FRONTMATTER_INVALID');
    }
    return result.data as Record<string, unknown>;
  }

  /**
   * Extract a brief summary from the body (first heading or first sentence).
   *
   * Defensive: any non-string input (`null`, `undefined`, non-string
   * values leaked through unusual frontmatter shapes) is coerced to the
   * empty string before processing so this method never throws.
   *
   * @param body Markdown body (string-like; anything else is treated as empty).
   * @returns Summary string, up to 120 characters; `''` for empty input.
   */
  private extractSummary(body: string): string {
    if (typeof body !== 'string' || body.length === 0) {
      return '';
    }
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(body);
    if (headingMatch) {
      return (headingMatch[1] ?? '').trim().slice(0, 120);
    }
    const sentence = body.split(/\n\n/)[0]?.trim() ?? '';
    return sentence.slice(0, 120);
  }

  /**
   * Capitalize the first letter of a string.
   *
   * Returns the empty string unchanged so that `capitalize('')` does not
   * yield `' '` or a stray character.
   *
   * @param str Input string.
   * @returns Capitalized string, or the empty string if input is empty.
   */
  private capitalize(str: string): string {
    if (typeof str !== 'string' || str.length === 0) {
      return '';
    }
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Map a wiki page type to its plural display label.
   *
   * For known types returns a pluralized display name; for unknown or
   * empty types returns `'Uncategorized'` so that `generateIndex` does
   * not render an empty `## ` heading for mis-typed or empty values.
   *
   * @param type The page type string (e.g. 'character').
   * @returns Plural display name (e.g. 'Characters'), or 'Uncategorized'.
   */
  private typeLabel(type: string): string {
    const labels: Record<string, string> = {
      character: 'Characters',
      location: 'Locations',
      faction: 'Factions',
      timeline: 'Timeline',
      thread: 'Threads',
      style: 'Style',
      motif: 'Motifs',
      other: 'Other',
    };
    // guard against empty / whitespace-only / unknown types so
    // the rendered index heading is always a meaningful section title.
    if (typeof type !== 'string' || type.trim().length === 0) {
      return 'Uncategorized';
    }
    if (Object.prototype.hasOwnProperty.call(labels, type)) {
      return labels[type] ?? 'Uncategorized';
    }
    return this.capitalize(type);
  }
}
