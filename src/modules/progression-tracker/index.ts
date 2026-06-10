/**
 * Progression Tracker — parses continuity reports and wiki-diffs to build a
 * timeline of entity state changes, stored in `adab/index/progressions.json`.
 */
import { join } from 'node:path';


import { safeReadFile, atomicWriteFile, ensureDir } from '../../utils/fs.js';
import { extractFrontmatter, extractSectionsByHeading } from '../../utils/markdown.js';

/**
 * A single progression event.
 */
export interface ProgressionEvent {
  /** Chapter identifier (e.g. `ch-012`). */
  chapter: string;
  /** Primary entity or thread name. */
  entity: string;
  /** Event category. */
  type: 'knowledge' | 'relationship' | 'thread_status' | 'state' | 'other';
  /** Human-readable description of the change. */
  change: string;
  /** ISO timestamp when the event was recorded. */
  timestamp: string;
  /** Related entity (for relationship events). */
  relatedEntity?: string;
  /** Previous value (for status changes). */
  from?: string;
  /** New value (for status changes). */
  to?: string;
}

/**
 * Chapter-grouped progression data.
 */
export interface ProgressionChapter {
  chapter: string;
  events: ProgressionEvent[];
}

/**
 * Full progressions index.
 */
export interface ProgressionsIndex {
  chapters: ProgressionChapter[];
}

/**
 * Tracks story progression by parsing continuity reports and wiki-diffs.
 */
export class ProgressionTracker {
  private readonly projectRoot: string;

  /**
   * @param projectRoot Absolute path to the project root.
   */
  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  /**
   * Parse a continuity-report Markdown file and extract progression events.
   *
   * @param path Absolute path to the continuity-report file.
   * @returns Array of extracted events.
   */
  async parseContinuityReport(path: string): Promise<ProgressionEvent[]> {
    const raw = await safeReadFile(path);
    if (raw === null) {return [];}
    const events: ProgressionEvent[] = [];
    const chapter = this.inferChapterFromPath(path);

    const knowledgeSection = extractSectionsByHeading(raw, 'Character Knowledge');
    if (knowledgeSection !== null && knowledgeSection.length > 0) {
      for (const line of knowledgeSection.split('\n')) {
        const match = /^-\s+(.+?)\s+now\s+knows?\s+(.+)$/i.exec(line);
        if (match !== null) {
          events.push(this.recordEvent({
            chapter,
            entity: match[1].trim(),
            type: 'knowledge',
            change: `Learned ${match[2].trim()}`,
          }));
        }
      }
    }

    const relationshipSection = extractSectionsByHeading(raw, 'Relationships');
    if (relationshipSection !== null && relationshipSection.length > 0) {
      for (const line of relationshipSection.split('\n')) {
        const match = /^-\s+(.+?)\s+and\s+(.+?)\s+are\s+now\s+(.+)$/i.exec(line);
        if (match !== null) {
          events.push(this.recordEvent({
            chapter,
            entity: match[1].trim(),
            type: 'relationship',
            change: match[3].trim(),
            relatedEntity: match[2].trim(),
          }));
        }
      }
    }

    const locationSection = extractSectionsByHeading(raw, 'Location State');
    if (locationSection !== null && locationSection.length > 0) {
      for (const line of locationSection.split('\n')) {
        const match = /^-\s+(.+?)\s+is\s+now\s+(.+)$/i.exec(line);
        if (match !== null) {
          events.push(this.recordEvent({
            chapter,
            entity: match[1].trim(),
            type: 'state',
            change: match[2].trim(),
          }));
        }
      }
    }

    return events;
  }

  /**
   * Parse a wiki-diff and extract progression-relevant operations.
   *
   * @param path Absolute path to the wiki-diff file.
   * @returns Array of extracted events.
   */
  async parseWikiDiff(path: string): Promise<ProgressionEvent[]> {
    const raw = await safeReadFile(path);
    if (raw === null) {return [];}
    const events: ProgressionEvent[] = [];
    const chapter = this.inferChapterFromPath(path);

    const { data: frontmatter } = extractFrontmatter(raw);
    const changeId = typeof frontmatter.changeId === 'string' ? frontmatter.changeId : chapter;

    const opsSection = extractSectionsByHeading(raw, 'Operations');
    if (opsSection === null || opsSection.length === 0) {return events;}

    for (const line of opsSection.split('\n')) {
      const threadMatch = /^-\s+update_thread_status:\s+(.+?)\s+from\s+(\S+)\s+to\s+(\S+)$/i.exec(line);
      if (threadMatch !== null) {
        events.push(this.recordEvent({
          chapter: changeId,
          entity: threadMatch[1].trim(),
          type: 'thread_status',
          change: `Thread status changed from ${threadMatch[2]} to ${threadMatch[3]}`,
          from: threadMatch[2],
          to: threadMatch[3],
        }));
      }

      const knowledgeMatch = /^-\s+add_knowledge_timeline:\s+(.+?)\s+learns?\s+(.+)$/i.exec(line);
      if (knowledgeMatch !== null) {
        events.push(this.recordEvent({
          chapter: changeId,
          entity: knowledgeMatch[1].trim(),
          type: 'knowledge',
          change: `Learned ${knowledgeMatch[2].trim()}`,
        }));
      }

      const relationshipMatch = /^-\s+update_relationship:\s+(.+?)\s+(.+?)\s+(.+)$/i.exec(line);
      if (relationshipMatch !== null) {
        events.push(this.recordEvent({
          chapter: changeId,
          entity: relationshipMatch[1].trim(),
          type: 'relationship',
          change: relationshipMatch[3].trim(),
          relatedEntity: relationshipMatch[2].trim(),
        }));
      }
    }

    return events;
  }

  /**
   * Format and timestamp a progression event.
   *
   * @param event Partial event data (without timestamp).
   * @returns Complete event with timestamp.
   */
  recordEvent(event: Omit<ProgressionEvent, 'timestamp'>): ProgressionEvent {
    return {
      ...event,
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Generate `adab/index/progressions.json` from all parsed sources.
   *
   * Scans `adab/changes/` for continuity-report and wiki-diff files,
   * parses them, and writes the combined chapter-ordered index.
   */
  async generateProgressionsJson(): Promise<void> {
    const chapters = await this.loadAllEvents();
    const indexDir = join(this.projectRoot, 'adab', 'index');
    await ensureDir(indexDir);
    await atomicWriteFile(join(indexDir, 'progressions.json'), JSON.stringify({ chapters }, null, 2));
  }

  /**
   * Get all events for a specific entity across all chapters.
   *
   * @param entity Entity name to filter by.
   * @returns Chronologically ordered array of events.
   */
  async getProgression(entity: string): Promise<ProgressionEvent[]> {
    const chapters = await this.loadAllEvents();
    const events: ProgressionEvent[] = [];
    for (const chapter of chapters) {
      for (const ev of chapter.events) {
        if (ev.entity === entity || ev.relatedEntity === entity) {
          events.push(ev);
        }
      }
    }
    return events;
  }

  /**
   * Compare new events against existing progressions and flag contradictions.
   *
   * @param newEvents Events to check.
   * @returns Array of contradictory event pairs.
   */
  async detectContradictions(newEvents: ProgressionEvent[]): Promise<{ existing: ProgressionEvent; new: ProgressionEvent; reason: string }[]> {
    const chapters = await this.loadAllEvents();
    const existingEvents: ProgressionEvent[] = [];
    for (const chapter of chapters) {
      existingEvents.push(...chapter.events);
    }

    const contradictions: { existing: ProgressionEvent; new: ProgressionEvent; reason: string }[] = [];
    for (const newEv of newEvents) {
      for (const oldEv of existingEvents) {
        if (oldEv.entity === newEv.entity && oldEv.type === newEv.type) {
          if (this.isContradictory(oldEv, newEv)) {
            contradictions.push({
              existing: oldEv,
              new: newEv,
              reason: `Contradictory ${newEv.type} for ${newEv.entity}: "${oldEv.change}" vs "${newEv.change}"`,
            });
          }
        }
      }
    }
    return contradictions;
  }

  /**
   * Incrementally update progressions by appending new events.
   *
   * Scans change directories for modified continuity-report/wiki-diff files
   * (mtime newer than `.last-indexed`), parses them, and merges.
   */
  async incrementalUpdate(): Promise<void> {
    const indexPath = join(this.projectRoot, 'adab', 'index', 'progressions.json');
    const lastIndexedPath = join(this.projectRoot, 'adab', 'index', '.last-indexed');
    const lastIndexedRaw = await safeReadFile(lastIndexedPath);
    const lastIndexed = lastIndexedRaw !== null ? parseInt(lastIndexedRaw.trim(), 10) : 0;
    const cutoff = Number.isNaN(lastIndexed) ? 0 : lastIndexed;

    const existingRaw = await safeReadFile(indexPath);
    let existingChapters: ProgressionChapter[] = [];
    if (existingRaw !== null) {
      try {
        const parsed: unknown = JSON.parse(existingRaw);
        if (Array.isArray(parsed)) {
          existingChapters = parsed as ProgressionChapter[];
        } else if (typeof parsed === 'object' && parsed !== null && 'chapters' in parsed) {
          existingChapters = (parsed as ProgressionsIndex).chapters;
        }
      } catch (err) {
        console.warn('[ProgressionTracker] Corrupt progressions.json, rebuilding:', err instanceof Error ? err.message : String(err));
      }
    }

    const newChapters = await this.collectEventsFromChanges(cutoff);
    const chapterMap = new Map<string, ProgressionChapter>();
    for (const ch of existingChapters) {
      chapterMap.set(ch.chapter, ch);
    }
    for (const newCh of newChapters) {
      // H6: Replace prior entries when re-processing an edited chapter
      chapterMap.set(newCh.chapter, { chapter: newCh.chapter, events: [...newCh.events] });
    }

    const chapters = Array.from(chapterMap.values());
    // M12: Numeric chapter sort
    chapters.sort((a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter));
    // Write .last-indexed BEFORE progressions.json so a crash between writes
    // doesn't cause duplicate events on restart (B9 fix).
    await atomicWriteFile(lastIndexedPath, String(Date.now()));
    await atomicWriteFile(indexPath, JSON.stringify({ chapters }, null, 2));
  }

  /**
   * Determine whether two events of the same entity and type contradict.
   *
   * Checks for knowledge contradictions (learning vs forgetting), relationship
   * state reversals (allies → enemies, etc.), state changes (destroyed vs
   * repaired), and thread status backward progression.
   *
   * @param a Existing event.
   * @param b New event.
   * @returns `true` if they appear contradictory.
   */
  private isContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    if (a.type === 'knowledge') {
      return this.isKnowledgeContradictory(a, b);
    }
    if (a.type === 'relationship') {
      return this.isRelationshipContradictory(a, b);
    }
    if (a.type === 'state') {
      return this.isStateContradictory(a, b);
    }
    if (a.type === 'thread_status') {
      return this.isThreadStatusContradictory(a, b);
    }
    return false;
  }

  /**
   * Check knowledge contradiction: one event showing knowledge gained and
   * another showing it lost, forgotten, or never known.
   */
  private isKnowledgeContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    const negations = ['does not know', 'never learned', 'forgot', 'lost knowledge of', 'no longer knows'];
    const aNeg = negations.some((n) => a.change.toLowerCase().includes(n));
    const bNeg = negations.some((n) => b.change.toLowerCase().includes(n));
    if (aNeg !== bNeg) {return true;}
    const learnMarkers = ['learned', 'discovered', 'found out', 'realized'];
    const aLearn = learnMarkers.some((m) => a.change.toLowerCase().includes(m));
    const bLearn = learnMarkers.some((m) => b.change.toLowerCase().includes(m));
    if (aLearn !== bLearn) {return true;}
    return false;
  }

  /**
   * Check relationship contradiction: one event describes a positive or
   * neutral state and the other a contradictory negative state (allies ↔
   * enemies, trusts ↔ distrusts/betrayed, loves ↔ hates, etc.).
   */
  private isRelationshipContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    const opposites: Array<[string, string]> = [
      ['allies', 'enemies'],
      ['allies', 'rivals'],
      ['trusts', 'distrusts'],
      ['trusts', 'betrayed'],
      ['allies', 'betrayed'],
      ['loves', 'hates'],
      ['loves', 'despises'],
      ['friends', 'enemies'],
      ['friends', 'rivals'],
      ['respects', 'despises'],
      ['loyal to', 'betrayed'],
      ['close to', 'estranged from'],
    ];
    const aLower = a.change.toLowerCase();
    const bLower = b.change.toLowerCase();
    for (const [pos, neg] of opposites) {
      const aPos = aLower.includes(pos);
      const bNeg = bLower.includes(neg);
      const aNeg = aLower.includes(neg);
      const bPos = bLower.includes(pos);
      if ((aPos && bNeg) || (aNeg && bPos)) {return true;}
    }
    return false;
  }

  /**
   * Check state contradiction: one event describes a state and the other
   * describes an incompatible state (destroyed ↔ repaired, alive ↔ dead,
   * empty ↔ full, etc.).
   */
  private isStateContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    const stateOpposites: Array<[string, string]> = [
      ['destroyed', 'repaired'],
      ['destroyed', 'restored'],
      ['destroyed', 'rebuilt'],
      ['alive', 'dead'],
      ['alive', 'killed'],
      ['empty', 'full'],
      ['empty', 'occupied'],
      ['open', 'closed'],
      ['locked', 'unlocked'],
      ['present', 'absent'],
      ['present', 'gone'],
      ['visible', 'hidden'],
      ['functioning', 'broken'],
      ['intact', 'damaged'],
      ['clean', 'dirty'],
    ];
    const aLower = a.change.toLowerCase();
    const bLower = b.change.toLowerCase();
    for (const [pos, neg] of stateOpposites) {
      const aPos = aLower.includes(pos);
      const bNeg = bLower.includes(neg);
      const aNeg = aLower.includes(neg);
      const bPos = bLower.includes(pos);
      if ((aPos && bNeg) || (aNeg && bPos)) {return true;}
    }
    return false;
  }

  /**
   * Check thread status contradiction: one event shows backward progression
   * (resolved → open) while another shows forward progression.
   */
  private isThreadStatusContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    if (a.from === undefined || a.to === undefined || b.from === undefined || b.to === undefined) {
      return false;
    }
    const rank: Record<string, number> = { open: 0, advanced: 1, resolved: 2 };
    const aFromRank = rank[a.from];
    const aToRank = rank[a.to];
    const bFromRank = rank[b.from];
    const bToRank = rank[b.to];
    if (aFromRank === undefined || aToRank === undefined || bFromRank === undefined || bToRank === undefined) {
      return false;
    }
    const aIsBackward = aToRank < aFromRank;
    const bIsBackward = bToRank < bFromRank;
    return aIsBackward !== bIsBackward;
  }

  /**
   * Extract numeric chapter number from a chapter ID like "ch-012".
   *
   * @param chapter Chapter identifier.
   * @returns Numeric chapter number, or 0 if unparseable.
   */
  private extractChapterNumber(chapter: string): number {
    const match = /ch-(\d+)/i.exec(chapter);
    return match ? parseInt(match[1], 10) : 0;
  }

  /**
   * Infer chapter identifier from a file path.
   *
   * @param path File path.
   * @returns Inferred chapter ID.
   */
  private inferChapterFromPath(path: string): string {
    const match = /ch-\d+/i.exec(path);
    return match ? match[0] : 'unknown';
  }

  /**
   * Load all progression events from existing `progressions.json` or rebuild.
   *
   * @returns Array of chapter-grouped events.
   */
  private async loadAllEvents(): Promise<ProgressionChapter[]> {
    const indexPath = join(this.projectRoot, 'adab', 'index', 'progressions.json');
    const raw = await safeReadFile(indexPath);
    if (raw !== null) {
      try {
        const parsed: unknown = JSON.parse(raw);
        if (Array.isArray(parsed)) {return parsed as ProgressionChapter[];}
        if (typeof parsed === 'object' && parsed !== null && 'chapters' in parsed) {
          return (parsed as ProgressionsIndex).chapters;
        }
        console.warn('[ProgressionTracker] Unexpected progressions.json format, rebuilding');
      } catch (err) {
        console.warn('[ProgressionTracker] Failed to parse progressions.json, rebuilding:', err instanceof Error ? err.message : String(err));
      }
    }
    return this.collectEventsFromChanges();
  }

  /**
   * Collect events by scanning all change directories.
   *
   * @param cutoff Only include files with mtime newer than this timestamp (ms).
   * @returns Array of chapter-grouped events.
   */
  private async collectEventsFromChanges(cutoff = 0): Promise<ProgressionChapter[]> {
    const { glob } = await import('fast-glob');
    const { stat } = await import('node:fs/promises');
    const reportPaths = await glob('**/continuity-report.md', {
      cwd: join(this.projectRoot, 'adab', 'changes'),
      onlyFiles: true,
      absolute: true,
    });
    const diffPaths = await glob('**/wiki-diff.md', {
      cwd: join(this.projectRoot, 'adab', 'changes'),
      onlyFiles: true,
      absolute: true,
    });

    const chapterMap = new Map<string, ProgressionEvent[]>();
    for (const path of reportPaths) {
      try {
        const s = await stat(path);
        if (s.mtimeMs < cutoff) {continue;}
      } catch (err) {
        console.warn('[ProgressionTracker] Skipped unreadable continuity report:', err instanceof Error ? err.message : String(err));
        continue;
      }
      const events = await this.parseContinuityReport(path);
      for (const ev of events) {
        if (!chapterMap.has(ev.chapter)) {chapterMap.set(ev.chapter, []);}
        const arr = chapterMap.get(ev.chapter);
        if (arr === undefined) {continue;}
        arr.push(ev);
      }
    }
    for (const path of diffPaths) {
      try {
        const s = await stat(path);
        if (s.mtimeMs < cutoff) {continue;}
      } catch (err) {
        console.warn('[ProgressionTracker] Skipped unreadable wiki-diff file:', err instanceof Error ? err.message : String(err));
        continue;
      }
      const events = await this.parseWikiDiff(path);
      for (const ev of events) {
        if (!chapterMap.has(ev.chapter)) {chapterMap.set(ev.chapter, []);}
        const arr = chapterMap.get(ev.chapter);
        if (arr === undefined) {continue;}
        arr.push(ev);
      }
    }

    const chapters: ProgressionChapter[] = [];
    for (const [chapter, events] of chapterMap) {
      chapters.push({ chapter, events });
    }
    // M12: Numeric chapter sort
    chapters.sort((a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter));
    return chapters;
  }
}
