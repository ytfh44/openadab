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
});

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
 * Core engine for managing project wiki pages.
 */
export class WikiEngine {
  private readonly projectRoot: string;
  private readonly logWriter: LogCallback | null;
  private batchMode: boolean;
  private generatingIndex = false;

  /**
   * @param projectRoot Absolute path to the project root.
   * @param logWriter   Optional callback for recording operations to log.md.
   */
  constructor(projectRoot: string, logWriter?: LogCallback) {
    this.projectRoot = projectRoot;
    this.logWriter = logWriter ?? null;
    this.batchMode = false;
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
   * Guarded against concurrent invocations — if a write or delete is
   * already regenerating the index, subsequent calls are no-ops.
   */
  async endBatch(): Promise<void> {
    if (!this.generatingIndex) {
      this.generatingIndex = true;
      try {
        await this.generateIndex();
        await this.generateWikilinks();
      } finally {
        this.generatingIndex = false;
      }
    }
    this.batchMode = false;
  }

  /**
   * Read a wiki page, parse its frontmatter, and validate per-type schema.
   *
   * @param pagePath Wiki page path relative to `adab/wiki/` (e.g. `characters/mara.md`).
   * @returns Parsed wiki page with frontmatter and body.
   * @throws {TargetNotFoundError} If the page file does not exist.
   * @throws {AdabError} If frontmatter validation fails.
   */
  async readPage(pagePath: string): Promise<WikiPage> {
    const absPath = resolveWikiPage(this.projectRoot, pagePath);
    const raw = await safeReadFile(absPath);
    if (raw === null) {
      throw new TargetNotFoundError(`Wiki page not found: ${pagePath}`);
    }
    const parsed = matter(raw);
    const frontmatter = parsed.data as Record<string, unknown>;
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
   * Validates frontmatter before writing.
   *
   * @param pagePath    Wiki page path relative to `adab/wiki/`.
   * @param frontmatter Frontmatter object to serialize.
   * @param body        Markdown body.
   * @throws {AdabError} If frontmatter validation fails.
   */
  async writePage(pagePath: string, frontmatter: Record<string, unknown>, body: string): Promise<void> {
    const absPath = resolveWikiPage(this.projectRoot, pagePath);
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
    if (!this.batchMode && !this.generatingIndex) {
      this.generatingIndex = true;
      try {
        await this.generateIndex();
        await this.generateWikilinks();
      } finally {
        this.generatingIndex = false;
      }
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
    const absPath = resolveWikiPage(this.projectRoot, pagePath);
    if (!(await fileExists(absPath))) {
      throw new TargetNotFoundError(`Wiki page not found: ${pagePath}`);
    }
    await unlink(absPath);
    if (!this.batchMode && !this.generatingIndex) {
      this.generatingIndex = true;
      try {
        await this.generateIndex();
        await this.generateWikilinks();
      } finally {
        this.generatingIndex = false;
      }
    }
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
        lines.push(`- [[${entry.type}/${entry.name}]] — ${entry.name} (${entry.status})`);
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
          broken: links.some((l) => !allPaths.has(l.replace(/\.md$/, ''))),
        };
      } catch (err) {
        console.warn('[WikiEngine] Skipped unreadable page during wikilink generation:', err instanceof Error ? err.message : String(err));
      }
    }

    for (const [pagePath, entry] of Object.entries(graph)) {
      for (const link of entry.links) {
        const normalizedLink = link.replace(/\.md$/, '');
        if (Object.hasOwn(graph, normalizedLink)) {
          graph[normalizedLink].backlinks.push(pagePath);
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

    // Process resolved contradictions: update existing unresolved entries
    for (const op of resolvedOps) {
      const escapedDesc = op.description.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      // Match the section heading and its content up to the next heading or EOF
      const sectionRegex = new RegExp(
        `(## ${escapedDesc}\\n)((?:\\n|.)*?)(?=\\n## |$)`,
        'g',
      );
      const match = sectionRegex.exec(existing);
      if (match && match[2].includes('- Status: unresolved')) {
        // Update existing unresolved entry
        let updated = match[2];
        updated = updated.replace(/- Status: unresolved/, `- Status: ${op.status}`);
        if (!updated.includes('- Resolution:')) {
          const source = op.sources[0]?.page ?? '';
          updated = `${updated.trim()}\n- Resolution: ${op.status} by ${source}`;
        }
        existing = existing.replace(match[0], `${match[1]}${updated}`);
      } else {
        // No matching unresolved entry — treat as new
        unresolvedOps.push(op);
      }
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
   * @param frontmatter Frontmatter object to validate.
   * @param pagePath    Page path for error messages.
   * @returns Validated frontmatter object.
   * @throws {AdabError} If validation fails.
   */
  private validateFrontmatter(frontmatter: Record<string, unknown>, pagePath: string): Record<string, unknown> {
    const type = frontmatter.type;
    let result: z.SafeParseReturnType<unknown, unknown>;
    if (type === 'character') {
      result = CharacterFrontmatterSchema.safeParse(frontmatter);
    } else if (type === 'location') {
      result = LocationFrontmatterSchema.safeParse(frontmatter);
    } else if (type === 'thread') {
      result = ThreadFrontmatterSchema.safeParse(frontmatter);
    } else {
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
   * @param body Markdown body.
   * @returns Summary string, up to 120 characters.
   */
  private extractSummary(body: string): string {
    const headingMatch = /^#{1,6}\s+(.+)$/m.exec(body);
    if (headingMatch) {
      return headingMatch[1].trim().slice(0, 120);
    }
    const sentence = body.split(/\n\n/)[0]?.trim() ?? '';
    return sentence.slice(0, 120);
  }

  /**
   * Capitalize the first letter of a string.
   *
   * @param str Input string.
   * @returns Capitalized string.
   */
  private capitalize(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  /**
   * Map a wiki page type to its plural display label.
   *
   * @param type The page type string (e.g. 'character').
   * @returns Plural display name (e.g. 'Characters').
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
    return labels[type] ?? this.capitalize(type);
  }
}
