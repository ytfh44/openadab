/**
 * Mention Indexer — scans manuscript, drafts, and wiki pages for mentions of
 * known wiki entities, building `mentions.json` and `context-map.json` indexes.
 */
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';

import glob from 'fast-glob';
import { z } from 'zod';

import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';
import { TargetNotFoundError } from '../../utils/errors.js';
import type { WikiEngine } from '../wiki-engine/index.js';

/**
 * Single appearance of an entity in a source file.
 */
export interface Appearance {
  /** Absolute or relative file path. */
  file: string;
  /** 1-based line number. */
  line: number;
  /** Surrounding text context. */
  context: string;
}

/**
 * Registry entry for a single entity.
 */
export interface EntityEntry {
  /** Wiki page type. */
  type: string;
  /** All known aliases (including the canonical name). */
  aliases: string[];
  /** All recorded appearances. */
  appearances: Appearance[];
}

/**
 * Full mentions index: entity name → entry.
 */
export type MentionsIndex = Record<string, EntityEntry>;

/**
 * Inverse context map: file path → entity names.
 */
export type ContextMap = Record<string, string[]>;

/**
 * Zod schema for a single {@link Appearance} entry, used to validate
 * `mentions.json` before restoring it during incremental indexing.
 */
const AppearanceSchema = z.object({
  file: z.string(),
  line: z.number().int().positive(),
  context: z.string(),
});

/**
 * Zod schema for a single {@link EntityEntry} on disk.
 */
const EntityEntrySchema = z.object({
  type: z.string(),
  aliases: z.array(z.string()),
  appearances: z.array(AppearanceSchema),
});

/**
 * Zod schema for the full `mentions.json` file.
 */
export const MentionsIndexSchema = z.record(z.string(), EntityEntrySchema);

/**
 * Compiled regex pattern for an entity.
 */
interface CompiledPattern {
  entity: string;
  regex: RegExp;
}

/**
 * CJK Unicode block detector.  Returns `true` when `segment` contains any
 * character from the CJK Unified Ideographs, Hiragana, Katakana, or Hangul
 * Syllables blocks.  Used by {@link MentionIndexer.buildRegexPattern} to
 * decide whether a given alias segment should be wrapped with `\b…\b`
 * word boundaries.
 *
 * @param segment Single alias segment to test.
 * @returns `true` if the segment contains at least one CJK character.
 */
function hasCjkChar(segment: string): boolean {
  return /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uf900-\ufaff]/.test(segment);
}

/**
 * Maximum total context length, in characters, that {@link
 * MentionIndexer.extractContext} may return.
 */
const MAX_CONTEXT_LENGTH = 100;

/**
 * Escape every regex metacharacter in `value` so it can be embedded as a
 * literal in a constructed RegExp pattern.  Handles all standard
 * metacharacters, the forward slash, and the ASCII control characters
 * (NUL, LF, CR, TAB) that would otherwise be parsed as part of the
 * surrounding pattern.
 *
 * @param value Raw alias text.
 * @returns Escaped pattern fragment safe to drop into a `RegExp` body.
 */
function escapeRegex(value: string): string {
  return value
    .replace(/[\\^$.*+?()[\]{}|/]/g, '\\$&')
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}

/**
 * Build the per-alias sub-pattern that decides whether word boundaries
 * should wrap the variant.  Mixed CJK + ASCII aliases are split on
 * whitespace and each segment is evaluated independently so that the
 * CJK pieces match as substrings while the ASCII pieces remain
 * word-boundary constrained.  Segments are joined by an optional
 * whitespace matcher so multi-word aliases such as `the stranger`
 * or `流浪者 Alice` match regardless of the spacing in the source.
 *
 * @param alias Single raw alias.
 * @returns Sub-pattern fragment, possibly empty if the alias trims away.
 */
function buildVariantSubPattern(alias: string): string {
  const segments = alias.split(/\s+/).filter((s) => s.length > 0);
  if (segments.length === 0) {
    return '';
  }
  const subPatterns = segments.map((seg) => {
    const escapedSeg = escapeRegex(seg);
    if (hasCjkChar(seg)) {
      return `(?:${escapedSeg})`;
    }
    return `(?:\\b${escapedSeg}\\b)`;
  });
  return subPatterns.join('\\s*?');
}

/**
 * Indexes entity mentions across project source files.
 */
export class MentionIndexer {
  private readonly projectRoot: string;
  private readonly wikiEngine: WikiEngine;
  private readonly caseSensitive: boolean;
  private entityRegistry = new Map<string, EntityEntry>();
  private compiledPatterns: CompiledPattern[] = [];
  private aliasToEntities = new Map<string, Set<string>>();

  /**
   * @param projectRoot   Absolute path to the project root.
   * @param wikiEngine    Reference to the wiki engine for loading pages.
   * @param caseSensitive Whether entity name matching is case-sensitive (default true).
   */
  constructor(projectRoot: string, wikiEngine: WikiEngine, caseSensitive = true) {
    this.projectRoot = projectRoot;
    this.wikiEngine = wikiEngine;
    this.caseSensitive = caseSensitive;
  }

  /**
   * Load all wiki pages and build the entity registry.
   *
   * Extracts `name` and `aliases` from each page's frontmatter.  Pages
   * whose `name` is missing, not a string, or contains only whitespace
   * are skipped — they cannot meaningfully participate in a mention index.
   */
  async buildEntityRegistry(): Promise<void> {
    this.entityRegistry.clear();
    this.aliasToEntities.clear();
    this.compiledPatterns = [];
    const pages = await this.wikiEngine.listPages();
    for (const pagePath of pages) {
      try {
        const page = await this.wikiEngine.readPage(pagePath);
        const rawName = page.frontmatter.name;
        const name = typeof rawName === 'string' ? rawName.trim() : '';
        const type = typeof page.frontmatter.type === 'string' ? page.frontmatter.type : 'other';
        const aliasesRaw = page.frontmatter.aliases;
        const aliases: string[] = Array.isArray(aliasesRaw)
          ? aliasesRaw.map((a) => String(a))
          : [];
        if (name.length > 0) {
          this.entityRegistry.set(name, {
            type,
            aliases: [name, ...aliases.filter((a) => a.trim().length > 0 && a !== name)],
            appearances: [],
          });
        }
      } catch (err) {
        console.warn('[MentionIndexer] Skipped unreadable page during entity registry build:', err instanceof Error ? err.message : String(err));
      }
    }
    this.refreshAliasMap();
    this.rebuildCompiledPatterns();
  }

  /**
   * Refresh the {@link aliasToEntities} lookup table.  Called automatically
   * from {@link buildEntityRegistry}; exposed for tests that mutate the
   * registry directly.
   */
  private refreshAliasMap(): void {
    this.aliasToEntities.clear();
    for (const [name, entry] of this.entityRegistry) {
      for (const alias of entry.aliases) {
        const trimmed = alias.trim();
        if (trimmed.length === 0) {
          continue;
        }
        if (!this.aliasToEntities.has(trimmed)) {
          this.aliasToEntities.set(trimmed, new Set());
        }
        this.aliasToEntities.get(trimmed)!.add(name);
      }
    }
  }

  /**
   * Re-derive `compiledPatterns` from the current entity registry.
   */
  private rebuildCompiledPatterns(): void {
    this.compiledPatterns = [];
    for (const [name, entry] of this.entityRegistry) {
      this.compiledPatterns.push({ entity: name, regex: this.buildRegexPattern(entry) });
    }
  }

  /**
   * Build a word-boundary regex pattern for an entity.
   *
   * Combines the canonical name with all aliases and escapes special
   * regex characters.  Each alias is split on whitespace and each
   * segment is evaluated independently for CJK content so that mixed
   * scripts (e.g. `流浪者 Alice`) get word boundaries only on the
   * ASCII part.  The resulting pattern matches any of the variants.
   *
   * @param entity Entity registry entry.
   * @returns Compiled RegExp with global flag.
   */
  buildRegexPattern(entity: EntityEntry): RegExp {
    const variants = entity.aliases
      .map((v) => buildVariantSubPattern(v))
      .filter((p) => p.length > 0);
    const pattern = variants.join('|');
    if (pattern.length === 0) {
      // No usable variant — return a regex that never matches.
      return new RegExp('(?!)', this.caseSensitive ? 'g' : 'gi');
    }
    const flags = this.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  }

  /**
   * Scan a single file for entity mentions.
   *
   * The caller MUST resolve `filePath` to an existing file.  When the
   * file is missing, this method throws {@link TargetNotFoundError} so
   * that callers can distinguish "no such file" from "file scanned,
   * zero mentions found".
   *
   * @param filePath Absolute path to the file to scan.
   * @returns Map of entity name → appearances found in this file.
   * @throws {TargetNotFoundError} When the file does not exist.
   */
  async scanFile(filePath: string): Promise<Map<string, Appearance[]>> {
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      throw new TargetNotFoundError(`scanFile: file not found at "${filePath}"`);
    }
    const lines = raw.split(/\r?\n/);
    const results = new Map<string, Appearance[]>();
    const seenLines = new Map<string, Set<number>>();

    const hasCRLF = raw.includes('\r\n');
    const lineSepLen = hasCRLF ? 2 : 1;

    let byteOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { regex } of this.compiledPatterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          const matchedText = match[0];
          const candidateEntities = this.aliasToEntities.get(matchedText);
          if (!candidateEntities) {
            continue;
          }
          const context = this.extractContext(raw, byteOffset + match.index, match[0].length, hasCRLF);
          for (const entity of candidateEntities) {
            if (!results.has(entity)) {
              results.set(entity, []);
              seenLines.set(entity, new Set());
            }
            const lineSet = seenLines.get(entity)!;
            const appearanceLine = i + 1;
            if (!lineSet.has(appearanceLine)) {
              lineSet.add(appearanceLine);
              results.get(entity)!.push({ file: filePath, line: appearanceLine, context });
            }
          }
        }
      }
      byteOffset += line.length + lineSepLen;
    }

    return results;
  }

  /**
   * Extract context around a match.
   *
   * Captures up to 50 characters before and after the match, stopping at
   * paragraph boundaries. The total context is hard-capped at
   * {@link MAX_CONTEXT_LENGTH} (100) characters even when both sides are
   * truncated — the spec's "limited to 100 characters" promise is now
   * an invariant rather than a side-effect of the math.
   *
   * @param content     Full file content.
   * @param matchIndex  Start index of the match in the raw content.
   * @param matchLength Length of the match.
   * @param hasCRLF     Whether the file uses CRLF line endings.
   * @returns Context string, never longer than {@link MAX_CONTEXT_LENGTH} chars.
   */
  extractContext(content: string, matchIndex: number, matchLength: number, hasCRLF = false): string {
    const paraSep = hasCRLF ? '\r\n\r\n' : '\n\n';
    const paraSepLen = hasCRLF ? 4 : 2;
    const beforeStart = Math.max(0, matchIndex - 50);
    const afterEnd = Math.min(content.length, matchIndex + matchLength + 50);

    let start = beforeStart;
    if (start > 0) {
      const prevNewline = content.lastIndexOf(paraSep, matchIndex);
      if (prevNewline !== -1 && prevNewline + paraSepLen > start) {
        start = prevNewline + paraSepLen;
      }
    }

    let end = afterEnd;
    const nextNewline = content.indexOf(paraSep, matchIndex + matchLength);
    if (nextNewline !== -1 && nextNewline < end) {
      end = nextNewline;
    }

    const sliced = content.slice(start, end).replace(/\s+/g, ' ').trim();
    return sliced.slice(0, MAX_CONTEXT_LENGTH);
  }

  /**
   * Write `adab/index/mentions.json` from the current entity registry.
   */
  async generateMentionsJson(): Promise<void> {
    const index: MentionsIndex = {};
    for (const [name, entry] of this.entityRegistry) {
      index[name] = entry;
    }
    const indexDir = join(this.projectRoot, 'adab', 'index');
    await ensureDir(indexDir);
    await atomicWriteFile(join(indexDir, 'mentions.json'), JSON.stringify(index, null, 2));
  }

  /**
   * Write `adab/index/context-map.json` from the current entity registry.
   *
   * Entries with an empty `aliases` array are skipped — without a name
   * we cannot usefully include them in the inverse index, and pushing
   * `undefined` would corrupt the JSON.
   */
  async generateContextMap(): Promise<void> {
    const map: ContextMap = {};
    for (const [, entry] of this.entityRegistry) {
      if (entry.aliases.length === 0) {
        continue;
      }
      const canonical = entry.aliases[0];
      for (const appearance of entry.appearances) {
        if (!map[appearance.file]) {
          map[appearance.file] = [];
        }
        if (!map[appearance.file].includes(canonical)) {
          map[appearance.file].push(canonical);
        }
      }
    }
    const indexDir = join(this.projectRoot, 'adab', 'index');
    await ensureDir(indexDir);
    await atomicWriteFile(join(indexDir, 'context-map.json'), JSON.stringify(map, null, 2));
  }

  /**
   * Perform a full re-index of all source files.
   *
   * Clears existing index data, rebuilds the entity registry, scans all
   * manuscript + wiki + draft files, and writes both index files.
   */
  async indexAll(): Promise<void> {
    await this.buildEntityRegistry();

    // Build a temporary results map to avoid mutating shared registry entries
    // during scanning, preventing potential race conditions (B13 fix).
    const scanResults = new Map<string, Appearance[]>();

    const files = await this.collectSourceFiles();
    for (const file of files) {
      const results = await this.scanFile(file);
      for (const [entity, appearances] of results) {
        const existing = scanResults.get(entity) ?? [];
        existing.push(...appearances);
        scanResults.set(entity, existing);
      }
    }

    for (const [entity, appearances] of scanResults) {
      const entry = this.entityRegistry.get(entity);
      if (entry) {
        entry.appearances = appearances;
      }
    }

    await this.generateMentionsJson();
    await this.generateContextMap();
    await this.writeLastIndexed();
  }

  /**
   * Perform an incremental re-index of only modified files.
   *
   * Compares file mtimes against the last index timestamp.  Removes stale
   * appearances from modified files, re-scans them, and updates both indexes.
   */
  async incrementalIndex(): Promise<void> {
    const lastIndexed = await this.readLastIndexed();
    if (lastIndexed === null) {
      await this.indexAll();
      return;
    }

    await this.buildEntityRegistry();

    // Restore existing appearances from the last index so we only refresh
    // modified files rather than dropping all mention data.  Validate
    // the on-disk shape with zod — if the file is corrupt or externally
    // tampered with, treat it as a full rebuild rather than crashing
    // the caller.
    const mentionsPath = join(this.projectRoot, 'adab', 'index', 'mentions.json');
    const existingMentionsRaw = await safeReadFile(mentionsPath);
    let existingMentions: MentionsIndex | null = null;
    if (existingMentionsRaw !== null) {
      try {
        const parsed = JSON.parse(existingMentionsRaw);
        const validated = MentionsIndexSchema.safeParse(parsed);
        if (validated.success) {
          existingMentions = validated.data as MentionsIndex;
          for (const [name, existingEntry] of Object.entries(existingMentions)) {
            const registryEntry = this.entityRegistry.get(name);
            if (registryEntry) {
              registryEntry.appearances = existingEntry.appearances || [];
            }
          }
        } else {
          console.warn('[MentionIndexer] Corrupted mentions.json — rebuilding from scratch.');
          existingMentions = null;
        }
      } catch {
        console.warn('[MentionIndexer] Corrupted mentions.json — rebuilding from scratch.');
        existingMentions = null;
      }
    }

    // Identify newly registered entities (not in the existing index).
    // These need a full scan of ALL files, not just modifiedFiles.
    const newEntityNames: string[] = [];
    for (const [name] of this.entityRegistry) {
      if (!existingMentions?.[name]) {
        newEntityNames.push(name);
      }
    }

    const files = await this.collectSourceFiles();
    const modifiedFiles: string[] = [];
    for (const file of files) {
      try {
        const s = await stat(file);
        if (s.mtimeMs > lastIndexed) {
          modifiedFiles.push(file);
        }
      } catch {
        // Skip unreadable files.
      }
    }

    if (modifiedFiles.length === 0 && newEntityNames.length === 0) {
      return;
    }

    if (newEntityNames.length > 0) {
      this.applyScanResults(files, new Set(newEntityNames));
    }

    if (modifiedFiles.length > 0) {
      // Remove stale appearances from modified files for EXISTING entities only
      for (const [, entry] of this.entityRegistry) {
        if (entry.appearances.length > 0) {
          entry.appearances = entry.appearances.filter((a) => !modifiedFiles.includes(a.file));
        }
      }
      this.applyScanResults(modifiedFiles, null);
    }

    await this.generateMentionsJson();
    await this.generateContextMap();
    await this.writeLastIndexed();
  }

  /**
   * Run {@link scanFile} over `files` and merge the per-entity results
   * back into the entity registry.  Encapsulates the two distinct scan
   * semantics used by {@link incrementalIndex}:
   *
   * - **Full scan for new entities** (`restrictTo !== null`): results
   *   are APPENDED to the registry entries, so newly discovered
   *   mentions accumulate alongside any restored appearances.
   * - **Re-scan of modified files** (`restrictTo === null`): the
   *   filtered registry entries are now empty (the caller has already
   *   removed stale appearances), so APPEND is effectively REPLACE.
   *
   * @param files       Files to scan.
   * @param restrictTo  When non-null, only merge results for entity
   *                    names in this set (used for the "new entity
   *                    needs a full scan" path).  When null, merge
   *                    every result.
   */
  private async applyScanResults(
    files: string[],
    restrictTo: Set<string> | null,
  ): Promise<void> {
    for (const file of files) {
      const results = await this.scanFile(file);
      for (const [entity, appearances] of results) {
        if (restrictTo && !restrictTo.has(entity)) {
          continue;
        }
        const entry = this.entityRegistry.get(entity);
        if (entry) {
          entry.appearances.push(...appearances);
        }
      }
    }
  }

  /**
   * Collect all source files to scan.
   *
   * @returns Array of absolute file paths.
   */
  private async collectSourceFiles(): Promise<string[]> {
    const dirs = [
      join(this.projectRoot, 'adab', 'manuscript'),
      join(this.projectRoot, 'adab', 'wiki'),
      join(this.projectRoot, 'adab', 'changes'),
      join(this.projectRoot, 'adab', 'raw'),
    ];
    const files: string[] = [];
    for (const dir of dirs) {
      if (!(await fileExists(dir))) {continue;}
      const found = await glob('**/*.md', {
        cwd: dir,
        onlyFiles: true,
        absolute: true,
        ignore: ['**/archive/**'],
      });
      files.push(...found.map((f) => normalize(f)));
    }
    return files;
  }

   /**
    * Read the timestamp of the last full or incremental index.
    *
    * @returns Timestamp in milliseconds, or `null` if never indexed.
    */
   private async readLastIndexed(): Promise<number | null> {
     const path = join(this.projectRoot, 'adab', 'index', '.last-mention-indexed');
     const raw = await safeReadFile(path);
     if (raw === null) {return null;}
     const ts = parseInt(raw.trim(), 10);
     return Number.isNaN(ts) ? null : ts;
   }

   /**
    * Write the current timestamp as the last index time.
    */
   private async writeLastIndexed(): Promise<void> {
     const path = join(this.projectRoot, 'adab', 'index', '.last-mention-indexed');
     await atomicWriteFile(path, String(Date.now()));
   }
}
