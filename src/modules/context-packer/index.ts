/**
 * Context Packer — assembles a prioritized, budget-aware context pack for a
 * given artifact within a change directory.
 *
 * The packer scores candidate files by relevance (always-include, artifact
 * dependencies, scene-plan entities, active threads, POV characters, adjacent
 * chapters, and related graph entities) and then performs a greedy pack into
 * `mustRead`, `optionalRead`, and `excluded` buckets.
 */
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';

import YAML from 'yaml';

import type { ContextPack } from '../../schemas/types.js';
import type { SchemaDef } from '../../schemas/schema-def.js';
import { safeReadFile, fileExists } from '../../utils/fs.js';
import { extractFrontmatter } from '../../utils/markdown.js';
import { estimateTokens } from '../../utils/token-counter.js';
import type { MentionIndexer } from '../mention-indexer/index.js';
import type { ProgressionTracker } from '../progression-tracker/index.js';
import type { ConfigLoader } from '../project-config/index.js';
import type { WikiEngine } from '../wiki-engine/index.js';
import { SchemaLoader } from '../schema-engine/index.js';
import { ManifestManager } from '../change-manifest/index.js';

/**
 * A single candidate file with an assigned priority score and an optional
 * estimated token count.
 */
export interface Candidate {
  /** Absolute or project-relative file path. */
  path: string;
  /** Priority score (higher = more important). */
  priority: number;
  /** Estimated token count for budget checks. */
  tokens: number;
  /** Human-readable reason for inclusion. */
  reason: string;
}

/**
 * Assembles context packs for artifact generation.
 */
export class ContextPacker {
  private readonly projectRoot: string;

  /**
   * Public accessor for the project root (required by instruction-loader).
   */
  get projectRootPath(): string {
    return this.projectRoot;
  }
  private readonly wikiEngine: WikiEngine;
  private readonly mentionIndexer: MentionIndexer;
  private readonly progressionTracker: ProgressionTracker;
  private readonly configLoader: ConfigLoader;

  /**
   * @param projectRoot        Absolute path to the project root.
   * @param wikiEngine         Wiki engine for reading pages.
   * @param mentionIndexer     Mention indexer for entity lookups.
   * @param progressionTracker Progression tracker for thread awareness.
   * @param configLoader       Config loader for budgets and always-include.
   */
  constructor(
    projectRoot: string,
    wikiEngine: WikiEngine,
    mentionIndexer: MentionIndexer,
    progressionTracker: ProgressionTracker,
    configLoader: ConfigLoader,
  ) {
    this.projectRoot = projectRoot;
    this.wikiEngine = wikiEngine;
    this.mentionIndexer = mentionIndexer;
    this.progressionTracker = progressionTracker;
    this.configLoader = configLoader;
  }

  /**
   * Build a context pack for the specified artifact in the given change
   * directory.
   *
   * @param changeDir  Change directory name (e.g. `ch-012`).
   * @param artifactId Artifact identifier (e.g. `draft`).
   * @returns A {@link ContextPack} with must-read, optional-read, and
   *          excluded file lists plus selection reasons.
   */
  async packContext(changeDir: string, artifactId: string): Promise<ContextPack> {
    const staleWarning = await this.checkStaleIndex();
    const candidates = await this.buildCandidates(changeDir, artifactId);
    const budget = await this.resolveBudget(artifactId, changeDir);
    const pack = this.greedyPack(candidates, budget);
    if (staleWarning !== null && staleWarning !== '') {
      // eslint-disable-next-line no-console
      console.warn(`[ContextPacker] ${staleWarning}`);
      pack.reasons.__stale_index_warning = staleWarning;
    }
    return pack;
  }

  /**
   * Build the full candidate list with priority scores for an artifact.
   *
   * Combines always-include, schema dependencies, scene-plan entities, active
   * threads, POV characters, adjacent chapters, and related graph entities.
   *
   * @param changeDir  Change directory name.
   * @param artifactId Artifact identifier.
   * @returns Array of scored candidates.
   */
  async buildCandidates(changeDir: string, artifactId: string): Promise<Candidate[]> {
    const candidates: Candidate[] = [];

    const alwaysInclude = this.configLoader.getAlwaysInclude();
    for (const rel of alwaysInclude) {
      const abs = join(this.projectRoot, rel);
      if (await fileExists(abs)) {
        candidates.push({
          path: abs,
          priority: 100,
          tokens: await this.estimateTokens(abs),
          reason: 'config.alwaysInclude',
        });
      }
    }

    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const artifactDeps = await this.resolveArtifactDeps(artifactId, changeDir);
    for (const dep of artifactDeps) {
      const abs = join(changePath, dep);
      if (await fileExists(abs)) {
        candidates.push({
          path: abs,
          priority: 90,
          tokens: await this.estimateTokens(abs),
          reason: 'artifact dependency',
        });
      }
    }

    const entityPages = await this.linkEntitiesFromScenePlan(changeDir);
    for (const page of entityPages) {
      const abs = join(this.projectRoot, 'adab', 'wiki', page);
      if (await fileExists(abs)) {
        const wikiPage = await this.wikiEngine.readPage(page);
        const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
        const type = typeof wikiPage.frontmatter.type === 'string' ? wikiPage.frontmatter.type : '';
        candidates.push({
          path: abs,
          priority: 80,
          tokens: await this.estimateTokens(abs),
          reason: `entity: ${name}${type ? ` (${type})` : ''}`,
        });
      }
    }

    const threadPages = await this.getActiveThreads(changeDir);
    for (const page of threadPages) {
      const abs = join(this.projectRoot, 'adab', 'wiki', page);
      if (await fileExists(abs)) {
        const wikiPage = await this.wikiEngine.readPage(page);
        const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
        candidates.push({
          path: abs,
          priority: 70,
          tokens: await this.estimateTokens(abs),
          reason: `thread: ${name}`,
        });
      }
    }

    const povPage = await this.detectPOVCharacters(changeDir);
    if (povPage !== null) {
      const abs = join(this.projectRoot, 'adab', 'wiki', povPage);
      if (await fileExists(abs)) {
        candidates.push({
          path: abs,
          priority: 60,
          tokens: await this.estimateTokens(abs),
          reason: 'POV character',
        });
      }
    }

    const adjacent = await this.detectAdjacentChapter(changeDir);
    if (adjacent !== null) {
      const abs = join(this.projectRoot, 'adab', 'manuscript', 'chapters', adjacent);
      if (await fileExists(abs)) {
        const match = /ch-(\d+)/i.exec(adjacent);
        const chapterLabel = match ? match[0] : adjacent;
        candidates.push({
          path: abs,
          priority: 55,
          tokens: await this.estimateTokens(abs),
          reason: `previous chapter (last written: ${chapterLabel.toLowerCase()})`,
        });
      }
    }

    const relatedEntities = await this.detectRelatedEntities(entityPages);
    for (const page of relatedEntities) {
      const abs = join(this.projectRoot, 'adab', 'wiki', page);
      if (await fileExists(abs)) {
        const already = candidates.some((c) => c.path === abs);
        if (!already) {
          const wikiPage = await this.wikiEngine.readPage(page);
          const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
          const source = page.replace(/\.md$/, '');
          candidates.push({
            path: abs,
            priority: 40,
            tokens: await this.estimateTokens(abs),
            reason: `related entity: ${name} (via ${source})`,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Link entities mentioned in the scene-plan to their wiki pages.
   *
   * Reads `scene-plan.md` from the change directory, uses the mention
   * indexer context-map to identify referenced entities, and returns the
   * corresponding wiki page paths.
   *
   * @param changeDir Change directory name.
   * @returns Array of wiki page paths.
   */
  async linkEntitiesFromScenePlan(changeDir: string): Promise<string[]> {
    const schema = await this.resolveChangeSchema(changeDir);
    const scenePlanArt = schema?.artifacts.find((a) => a.id === 'scene-plan');
    const scenePlanFile = scenePlanArt?.generates ?? 'scene-plan.md';
    const scenePlanPath = join(this.projectRoot, 'adab', 'changes', changeDir, scenePlanFile);
    const raw = await safeReadFile(scenePlanPath);
    if (raw === null) {
      return [];
    }

    const contextMapPath = join(this.projectRoot, 'adab', 'index', 'context-map.json');
    const contextMapRaw = await safeReadFile(contextMapPath);
    if (contextMapRaw === null) {
      return [];
    }

    let contextMap: Record<string, string[]>;
    try {
      contextMap = JSON.parse(contextMapRaw) as Record<string, string[]>;
    } catch (err) {
      console.warn('[ContextPacker] Failed to parse context-map.json:', err instanceof Error ? err.message : String(err));
      return [];
    }

    // Normalize keys to OS-native paths for consistent lookup across platforms.
    const normalizedMap: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(contextMap)) {
      normalizedMap[normalize(key)] = value;
    }
    const entities = normalizedMap[normalize(scenePlanPath)] ?? [];
    const pages: string[] = [];
    // Build name/alias → page lookup map once (O(n) instead of O(n*m)).
    const allPages = await this.wikiEngine.listPages();
    const nameToPage = new Map<string, string>();
    for (const page of allPages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
        if (name) nameToPage.set(name, page);
        const aliases = Array.isArray(wikiPage.frontmatter.aliases)
          ? wikiPage.frontmatter.aliases.map((a: unknown) => String(a))
          : [];
        for (const alias of aliases) {
          if (alias && !nameToPage.has(alias)) nameToPage.set(alias, page);
        }
      } catch (err) {
        console.warn('[ContextPacker] Skipped unreadable page during entity lookup:', err instanceof Error ? err.message : String(err));
      }
    }
    for (const entity of entities) {
      const page = nameToPage.get(entity);
      if (page) pages.push(page);
    }
    return pages;
  }

  /**
   * Identify active threads from the continuity report.
   *
   * Reads `continuity-report.md` from the change directory, extracts active
   * thread references, and links them to thread wiki pages.
   *
   * @param changeDir Change directory name.
   * @returns Array of thread wiki page paths.
   */
  async getActiveThreads(changeDir: string): Promise<string[]> {
    const schema = await this.resolveChangeSchema(changeDir);
    const reportArt = schema?.artifacts.find((a) => a.id === 'continuity-report');
    const reportFile = reportArt?.generates ?? 'continuity-report.md';
    const reportPath = join(this.projectRoot, 'adab', 'changes', changeDir, reportFile);
    const raw = await safeReadFile(reportPath);
    if (raw === null) {
      return [];
    }

    const threadPages = await this.wikiEngine.listPages('thread');
    const active: string[] = [];
    for (const page of threadPages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
        if (name !== '' && raw.includes(name)) {
          active.push(page);
        }
      } catch (err) {
        console.warn('[ContextPacker] Skipped unreadable thread page during active thread detection:', err instanceof Error ? err.message : String(err));
      }
    }
    return active;
  }

  /**
   * Detect POV characters from scene-plan or brief frontmatter.
   *
   * Extracts the `pov` field from `scene-plan.md` or `brief.md` frontmatter
   * and returns the corresponding character wiki page path if one exists.
   *
   * @param changeDir Change directory name.
   * @returns Wiki page path for the POV character, or `null`.
   */
  async detectPOVCharacters(changeDir: string): Promise<string | null> {
    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const schema = await this.resolveChangeSchema(changeDir);
    const scenePlanArt = schema?.artifacts.find((a) => a.id === 'scene-plan');
    const briefArt = schema?.artifacts.find((a) => a.id === 'brief');
    const candidates = [scenePlanArt?.generates ?? 'scene-plan.md', briefArt?.generates ?? 'brief.md'];
    for (const file of candidates) {
      const raw = await safeReadFile(join(changePath, file));
      if (raw === null) {continue;}
      const { data } = extractFrontmatter(raw);
      const pov = data.pov;
      if (pov !== undefined && pov !== null) {
        const povName = typeof pov === 'string' ? pov : JSON.stringify(pov);
        try {
          const charPages = await this.wikiEngine.listPages('character');
          for (const page of charPages) {
            const wikiPage = await this.wikiEngine.readPage(page);
            const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
            if (name === povName) {
              return page;
            }
          }
        } catch (err) {
          console.warn('[ContextPacker] Wiki read error during POV character detection:', err instanceof Error ? err.message : String(err));
        }
      }
    }
    return null;
  }

  /**
   * Estimate the token count of a file on disk.
   *
   * Uses the project language setting to choose the heuristic divisor.
   *
   * @param path Absolute or relative path to the file.
   * @returns Estimated token count (≥ 0).
   */
  async estimateTokens(path: string): Promise<number> {
    const raw = await safeReadFile(path);
    if (raw === null) {
      return 0;
    }
    const language = this.configLoader.getLanguage();
    const heuristic = this.configLoader.getTokenHeuristic();
    const isZh = language.startsWith('zh');
    // Use language-specific divisor when heuristic is 'chars-per-token';
    // otherwise fall back to the default English divisor regardless of language.
    if (heuristic === 'chars-per-token') {
      return estimateTokens(raw, isZh ? 'zh' : 'en');
    }
    return estimateTokens(raw);
  }

  /**
   * Greedy packing algorithm.
   *
   * Sorts candidates by descending priority, fills `mustRead` until the token
   * budget is exhausted. Files with priority >= 80 are forced into `mustRead`
   * regardless of budget (per spec). Remaining items with priority 60-79 go
   * into `optionalRead`, and the rest into `excluded`.
   *
   * @param candidates Array of scored candidates.
   * @param budget     Maximum token budget.
   * @returns A {@link ContextPack}.
   */
  greedyPack(candidates: Candidate[], budget: number): ContextPack {
    const deduped = new Map<string, Candidate>();
    for (const c of candidates) {
      const existing = deduped.get(c.path);
      if (!existing || c.priority > existing.priority) {
        deduped.set(c.path, c);
      }
    }

    const sorted = Array.from(deduped.values()).sort((a, b) => b.priority - a.priority);
    const mustRead: string[] = [];
    const optionalRead: string[] = [];
    const excluded: string[] = [];
    const reasons: Record<string, string> = {};
    let remaining = budget;

    for (const c of sorted) {
      // Config-defined alwaysInclude files bypass the budget check entirely.
      if (c.reason === 'config.alwaysInclude') {
        mustRead.push(c.path);
        remaining -= c.tokens;
        reasons[c.path] = c.reason;
      } else if (c.priority >= 80) {
        // Priority >= 80 SHALL remain in mustRead regardless of budget (per spec).
        mustRead.push(c.path);
        remaining -= c.tokens;
        reasons[c.path] = c.reason;
      } else if (c.tokens <= remaining) {
        mustRead.push(c.path);
        remaining -= c.tokens;
        reasons[c.path] = c.reason;
      } else if (c.priority >= 60) {
        optionalRead.push(c.path);
        reasons[c.path] = c.reason;
      } else {
        excluded.push(c.path);
        reasons[c.path] = `budget exceeded, priority ${String(c.priority)} vs threshold 60`;
      }
    }

    // Prevent remaining from going negative (defensive guard).
    if (remaining < 0) {
      remaining = 0;
    }

    return { mustRead, optionalRead, excluded, reasons };
  }

  /**
   * Resolve the token budget for an artifact.
   *
   * Uses the artifact's `contextBudget` if defined, otherwise falls back to
   * the global `maxTokens` from config.
   *
   * @param artifactId Artifact identifier.
   * @returns Token budget.
   */
  private async resolveBudget(artifactId: string, changeDir?: string): Promise<number> {
    const schema = await this.resolveChangeSchema(changeDir);
    if (schema) {
      const art = schema.artifacts.find((a) => a.id === artifactId);
      if (art?.contextBudget !== undefined) {
        return art.contextBudget;
      }
    }
    return this.configLoader.getMaxTokens();
  }

  /**
   * Resolve artifact dependency file names from the active schema.
   *
   * @param artifactId Artifact identifier.
   * @returns Array of dependency file names (e.g. `brief.md`).
   */
  private async resolveArtifactDeps(artifactId: string, changeDir?: string): Promise<string[]> {
    const schema = await this.resolveChangeSchema(changeDir);
    if (!schema) return [];
    const art = schema.artifacts.find((a) => a.id === artifactId);
    if (!art) return [];
    const deps: string[] = [];
    for (const reqId of art.requires) {
      const depArt = schema.artifacts.find((a) => a.id === reqId);
      if (depArt) deps.push(depArt.generates);
    }
    return deps;
  }

  /**
   * Resolve the schema definition for a change by reading its manifest.
   *
   * Falls back to the active config schema when the change manifest is unavailable.
   *
   * @param changeDir Change directory name (optional).
   * @returns Loaded SchemaDef, or undefined if unresolvable.
   */
  private async resolveChangeSchema(changeDir?: string): Promise<SchemaDef | undefined> {
    // Try change manifest first (per-change schema fidelity).
    if (changeDir) {
      try {
        const manifestManager = new ManifestManager();
        const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
        const manifest = await manifestManager.readManifest(changePath);
        const schemaDir = join(this.projectRoot, 'adab', 'schemas', manifest.schema);
        const loader = new SchemaLoader(schemaDir);
        return await loader.load();
      } catch {
        // Manifest unavailable; fall back to active config schema.
      }
    }
    // Fallback: use active config schema.
    try {
      const schemaName = this.configLoader.getActiveSchema();
      const schemaDir = join(this.projectRoot, 'adab', 'schemas', schemaName);
      const loader = new SchemaLoader(schemaDir);
      return await loader.load();
    } catch (err) {
      console.warn('[ContextPacker] Failed to load schema:', err instanceof Error ? err.message : String(err));
      return undefined;
    }
  }

  /**
   * Detect the previous adjacent chapter file name.
   *
   * If the immediate predecessor (`num - 1`) does not exist, scans the
   * manuscript directory and returns the highest-numbered existing chapter
   * that is still lower than the current change's chapter number.
   *
   * @param changeDir Change directory name.
   * @returns Previous chapter file name (e.g. `ch-001.md`), or `null`.
   */
  private async detectAdjacentChapter(changeDir: string): Promise<string | null> {
    const match = /ch-(\d+)/i.exec(changeDir);
    if (!match) {
      return null;
    }
    const num = parseInt(match[1], 10);
    if (num <= 1) {
      return null;
    }
    const prev = `ch-${String(num - 1).padStart(3, '0')}.md`;
    const prevPath = join(this.projectRoot, 'adab', 'manuscript', 'chapters', prev);
    if (await fileExists(prevPath)) {
      return prev;
    }

    // Gapped sequence: find the highest existing chapter < num.
    const chaptersDir = join(this.projectRoot, 'adab', 'manuscript', 'chapters');
    const { glob } = await import('fast-glob');
    const files = await glob('ch-*.md', { cwd: chaptersDir, onlyFiles: true });
    let best: number | null = null;
    for (const f of files) {
      const m = /ch-(\d+)/i.exec(f);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n < num && (best === null || n > best)) {
          best = n;
        }
      }
    }
    return best !== null ? `ch-${String(best).padStart(3, '0')}.md` : null;
  }

   /**
    * Check whether the mention index is stale by comparing `.last-mention-indexed`
    * against the most recent manuscript modification time.
    *
    * @returns Warning string if stale, otherwise `null`.
    */
   private async checkStaleIndex(): Promise<string | null> {
     const lastIndexedPath = join(this.projectRoot, 'adab', 'index', '.last-mention-indexed');
    const lastIndexedRaw = await safeReadFile(lastIndexedPath);
    if (lastIndexedRaw === null) {
      return 'Mention index has never been built. Run `openadab sync` or `openadab wiki index` first.';
    }
    const lastIndexed = parseInt(lastIndexedRaw.trim(), 10);
    if (Number.isNaN(lastIndexed)) {
      return 'Mention index timestamp is corrupt. Rebuild recommended.';
    }

    const manuscriptDir = join(this.projectRoot, 'adab', 'manuscript');
    const { glob } = await import('fast-glob');
    const files = await glob('**/*.md', { cwd: manuscriptDir, onlyFiles: true, absolute: true });
    let maxMtime = 0;
    for (const file of files) {
      try {
        const s = await stat(file);
        if (s.mtimeMs > maxMtime) {
          maxMtime = s.mtimeMs;
        }
      } catch (err) {
        console.warn('[ContextPacker] Skipped unreadable manuscript file during stale index check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (maxMtime > lastIndexed) {
      return `Mention index is stale (last indexed ${new Date(lastIndexed).toISOString()}, manuscript updated ${new Date(maxMtime).toISOString()}). Run \`openadab sync\` to refresh.`;
    }
    return null;
  }

  /**
   * Detect related entities from the wikilink graph.
   *
   * Given a list of wiki page paths, looks up their forward links in the
   * wikilinks index and returns linked pages that are characters, locations,
   * or factions.
   *
   * @param sourcePages Source wiki page paths.
   * @returns Related wiki page paths.
   */
  private async detectRelatedEntities(sourcePages: string[]): Promise<string[]> {
    const wikilinksPath = join(this.projectRoot, 'adab', 'index', 'wikilinks.json');
    const raw = await safeReadFile(wikilinksPath);
    if (raw === null) {
      return [];
    }
    let graph: Record<string, { links: string[] } | undefined>;
    try {
      graph = JSON.parse(raw) as Record<string, { links: string[] } | undefined>;
    } catch (err) {
      console.warn('[ContextPacker] Failed to parse wikilinks.json:', err instanceof Error ? err.message : String(err));
      return [];
    }

    const related = new Set<string>();
    for (const page of sourcePages) {
      const key = page.replace(/\.md$/, '');
      const entry = graph[key];
      if (entry !== undefined) {
        for (const link of entry.links) {
          related.add(`${link}.md`);
        }
      }
    }

    const filtered: string[] = [];
    for (const page of related) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const type = typeof wikiPage.frontmatter.type === 'string' ? wikiPage.frontmatter.type : '';
        if (type === 'character' || type === 'location' || type === 'faction') {
          filtered.push(page);
        }
      } catch (err) {
        console.warn('[ContextPacker] Skipped unreadable page during related entity detection:', err instanceof Error ? err.message : String(err));
      }
    }
    return filtered;
  }
}
