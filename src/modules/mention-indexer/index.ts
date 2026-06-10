/**
 * Mention Indexer — scans manuscript, drafts, and wiki pages for mentions of
 * known wiki entities, building `mentions.json` and `context-map.json` indexes.
 */
import { stat } from 'node:fs/promises';
import { join, normalize } from 'node:path';

import glob from 'fast-glob';

import { safeReadFile, atomicWriteFile, ensureDir, fileExists } from '../../utils/fs.js';
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
 * Compiled regex pattern for an entity.
 */
interface CompiledPattern {
  entity: string;
  regex: RegExp;
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
   * Extracts `name` and `aliases` from each page's frontmatter.
   */
  async buildEntityRegistry(): Promise<void> {
    this.entityRegistry.clear();
    const pages = await this.wikiEngine.listPages();
    for (const pagePath of pages) {
      try {
        const page = await this.wikiEngine.readPage(pagePath);
        const name = typeof page.frontmatter.name === 'string' ? page.frontmatter.name : '';
        const type = typeof page.frontmatter.type === 'string' ? page.frontmatter.type : 'other';
        const aliasesRaw = page.frontmatter.aliases;
        const aliases: string[] = Array.isArray(aliasesRaw)
          ? aliasesRaw.map((a) => String(a))
          : [];
        if (name) {
          this.entityRegistry.set(name, {
            type,
            aliases: [name, ...aliases.filter((a) => a !== name)],
            appearances: [],
          });
        }
      } catch (err) {
        console.warn('[MentionIndexer] Skipped unreadable page during entity registry build:', err instanceof Error ? err.message : String(err));
      }
    }
  }

  /**
   * Build a word-boundary regex pattern for an entity.
   *
   * Combines the canonical name with all aliases and escapes special regex
   * characters.  The resulting pattern matches any of the variants as whole
   * words.
   *
   * @param entity Entity registry entry.
   * @returns Compiled RegExp with global flag.
   */
  buildRegexPattern(entity: EntityEntry): RegExp {
    const variants = entity.aliases;
    const escaped = variants.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    const pattern = escaped.map((v) => {
      if (/[\u4e00-\u9fff]/.test(v)) {
        return `(?:${v})`;
      }
      return `(?:\\b${v}\\b)`;
    }).join('|');
    const flags = this.caseSensitive ? 'g' : 'gi';
    return new RegExp(pattern, flags);
  }

  /**
   * Scan a single file for entity mentions.
   *
   * @param filePath Absolute path to the file to scan.
   * @returns Map of entity name → appearances found in this file.
   */
  async scanFile(filePath: string): Promise<Map<string, Appearance[]>> {
    const raw = await safeReadFile(filePath);
    if (raw === null) {
      return new Map();
    }
    const lines = raw.split(/\r?\n/);
    const results = new Map<string, Appearance[]>();
    const seenLines = new Map<string, Set<number>>();

    const hasCRLF = raw.includes('\r\n');
    const lineSepLen = hasCRLF ? 2 : 1;

    let byteOffset = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      for (const { entity, regex } of this.compiledPatterns) {
        regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = regex.exec(line)) !== null) {
          const context = this.extractContext(raw, byteOffset + match.index, match[0].length, hasCRLF);
          const appearance: Appearance = {
            file: filePath,
            line: i + 1,
            context,
          };
          if (!results.has(entity)) {
            results.set(entity, []);
            seenLines.set(entity, new Set());
          }
          const lineSet = seenLines.get(entity)!;
          if (!lineSet.has(appearance.line)) {
            lineSet.add(appearance.line);
            results.get(entity)!.push(appearance);
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
   * paragraph boundaries. The total context is limited to 100 characters
   * (50 before + 50 after) and does not cross paragraph boundaries.
   *
   * @param content     Full file content.
   * @param matchIndex  Start index of the match in the raw content.
   * @param matchLength Length of the match.
   * @param hasCRLF     Whether the file uses CRLF line endings.
   * @returns Context string.
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

    return content.slice(start, end).replace(/\s+/g, ' ').trim();
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
   */
  async generateContextMap(): Promise<void> {
    const map: ContextMap = {};
    for (const [, entry] of this.entityRegistry) {
      for (const appearance of entry.appearances) {
        if (!map[appearance.file]) {
          map[appearance.file] = [];
        }
        if (!map[appearance.file].includes(entry.aliases[0])) {
          map[appearance.file].push(entry.aliases[0]);
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
    this.compiledPatterns = [];
    for (const [, entry] of this.entityRegistry) {
      this.compiledPatterns.push({ entity: entry.aliases[0], regex: this.buildRegexPattern(entry) });
    }

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
    this.compiledPatterns = [];
    for (const [, entry] of this.entityRegistry) {
      this.compiledPatterns.push({ entity: entry.aliases[0], regex: this.buildRegexPattern(entry) });
    }

    // Restore existing appearances from the last index so we only refresh
    // modified files rather than dropping all mention data.
    const mentionsPath = join(this.projectRoot, 'adab', 'index', 'mentions.json');
    const existingMentionsRaw = await safeReadFile(mentionsPath);
    if (existingMentionsRaw !== null) {
      try {
        const existingMentions: MentionsIndex = JSON.parse(existingMentionsRaw);
        for (const [name, existingEntry] of Object.entries(existingMentions)) {
          const registryEntry = this.entityRegistry.get(name);
          if (registryEntry) {
            registryEntry.appearances = existingEntry.appearances || [];
          }
        }
      } catch {
        console.warn('[MentionIndexer] Corrupted mentions.json — rebuilding from scratch.');
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

    if (modifiedFiles.length === 0) {
      return;
    }

    for (const [, entry] of this.entityRegistry) {
      entry.appearances = entry.appearances.filter((a) => !modifiedFiles.includes(a.file));
    }

    for (const file of modifiedFiles) {
      const results = await this.scanFile(file);
      for (const [entity, appearances] of results) {
        const entry = this.entityRegistry.get(entity);
        if (entry) {
          entry.appearances.push(...appearances);
        }
      }
    }

    await this.generateMentionsJson();
    await this.generateContextMap();
    await this.writeLastIndexed();
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
      const found = await glob('**/*.md', { cwd: dir, onlyFiles: true, absolute: true });
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
    const path = join(this.projectRoot, 'adab', 'index', '.last-indexed');
    const raw = await safeReadFile(path);
    if (raw === null) {return null;}
    const ts = parseInt(raw.trim(), 10);
    return Number.isNaN(ts) ? null : ts;
  }

  /**
   * Write the current timestamp as the last index time.
   */
  private async writeLastIndexed(): Promise<void> {
    const path = join(this.projectRoot, 'adab', 'index', '.last-indexed');
    await atomicWriteFile(path, String(Date.now()));
  }
}
