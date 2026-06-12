/**
 * Progression Tracker — parses continuity reports and wiki-diffs to build a
 * timeline of entity state changes, stored in `adab/index/progressions.json`.
 */
import { join } from 'node:path';
import { stat } from 'node:fs/promises';

import glob from 'fast-glob';

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
   * In-memory cache of `loadAllEvents` keyed by the mtimeMs of
   * `progressions.json`.  PT-11: avoids re-globbing the entire
   * `adab/changes/` tree on every read.
   */
  private eventsCache: { mtimeMs: number; chapters: ProgressionChapter[] } | null = null;

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
        // PT-4: skip lines that negate or revoke knowledge before pattern matching.
        if (this.isNegatedKnowledgeLine(line)) {continue;}
        // PT-12: accept knew / learned / has learned tenses in addition to `now knows`.
        const match = /^-\s+(.+?)\s+(?:now\s+knows?|now\s+knew|knew|has\s+learned|learned|knows?)\s+(.+)$/i.exec(line);
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
   * Heuristic that decides whether a single `- Entity ...` line in the
   * `## Character Knowledge` section is *negating* or *revoking* knowledge
   * rather than asserting it.  PT-4 fix.
   *
   * @param line Raw Markdown bullet line, e.g. `- Alice does not know the secret`.
   * @returns `true` if the line should be skipped when recording knowledge events.
   */
  private isNegatedKnowledgeLine(line: string): boolean {
    const negationPattern = /\b(?:does\s+not|doesn't|did\s+not|didn't|do\s+not|don't|no\s+longer|never|forgot|forgets|lost\s+knowledge\s+of|forgotten)\b/i;
    return negationPattern.test(line);
  }

  /**
   * Parse a wiki-diff and extract progression-relevant operations.
   *
   * The wiki-diff uses `### [[Entity]]` blocks with sub-sections:
   * - `#### Add to Current State` — entity knowledge updates
   * - `#### Add to Knowledge Timeline` — timeline entries
   * - `#### Update Thread Status` — thread status changes
   * - `#### Update Relationship` — relationship changes
   *
   * @param path Absolute path to the wiki-diff file.
   * @returns Array of extracted events.
   */
  async parseWikiDiff(path: string): Promise<ProgressionEvent[]> {
    const raw = await safeReadFile(path);
    if (raw === null) {return [];}
    const events: ProgressionEvent[] = [];
    const inferredChapter = this.inferChapterFromPath(path);

    const { data: frontmatter } = extractFrontmatter(raw);
    // PT-6: prefer the chapter inferred from the file path so that wiki-diff
    // and continuity-report files under the same `adab/changes/ch-NNN/`
    // directory end up in the same chapter bucket.
    const changeId = this.normalizeChangeId(frontmatter.changeId, inferredChapter);

    // Parse each ### [[Entity]] block
    const lines = raw.split('\n');
    // PT-10: use `null` to mean "no entity seen yet" so empty/whitespace
    // targets can be rejected by a single `=== null` guard.
    let currentEntity: string | null = null;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Match ### [[entity/path]] (with optional `|alias`)
      const entityMatch = /^###\s+\[\[([^\[\]|\n]+)(?:\|[^\]\n]*)?\]\]/.exec(line);
      if (entityMatch !== null) {
        // PT-2: take only the target portion (alias discarded), then the
        // last path segment without the `.md` extension.
        const target = entityMatch[1].trim();
        const tail = target.replace(/\.md$/i, '').split('/').pop() ?? '';
        // PT-10: empty / whitespace-only entity names are ignored entirely.
        currentEntity = tail.trim() === '' ? null : tail;
        continue;
      }

      if (currentEntity === null) {continue;}

      // Match #### Update Thread Status
      if (/^####\s+Update Thread Status/i.test(line)) {
        let status = 'unknown';
        for (let j = i + 1; j < lines.length; j++) {
          const statusMatch = /^Status:\s*(\S+)/i.exec(lines[j]);
          if (statusMatch !== null) {
            status = statusMatch[1];
            break;
          }
          if (/^#{1,6}\s/.test(lines[j])) {break;}
        }
        events.push(this.recordEvent({
          chapter: changeId,
          entity: currentEntity,
          type: 'thread_status',
          change: `Thread status changed to ${status}`,
          to: status,
        }));
      }

      // Match #### Add to Current State
      if (/^####\s+Add to Current State/i.test(line)) {
        const contentParts: string[] = [];
        // PT-9: scan to the next heading rather than a fixed 10-line window.
        for (let j = i + 1; j < lines.length; j++) {
          const next = lines[j];
          if (/^#{1,6}\s/.test(next)) {break;}
          const contentMatch = /^-\s+(.+)/.exec(next);
          if (contentMatch !== null) {
            contentParts.push(contentMatch[1].trim());
          }
        }
        if (contentParts.length > 0) {
          events.push(this.recordEvent({
            chapter: changeId,
            entity: currentEntity,
            type: 'knowledge',
            change: contentParts.join('; '),
          }));
        }
      }

      // Match #### Update Relationship
      if (/^####\s+Update Relationship/i.test(line)) {
        // PT-3: scan the whole sub-section (up to the next heading) and
        // capture the first line that matches the relationship pattern.
        const relMatch = this.findRelationshipInSection(lines, i + 1);
        if (relMatch !== null) {
          events.push(this.recordEvent({
            chapter: changeId,
            entity: currentEntity,
            type: 'relationship',
            change: relMatch.change,
            relatedEntity: relMatch.relatedEntity,
          }));
        }
      }
    }

    return events;
  }

  /**
   * Normalize the wiki-diff `changeId` frontmatter to a chapter identifier
   * that is consistent with the value inferred from the file path.
   *
   * PT-6 fix: a `changeId` of `draft-ch-005` is rewritten to `ch-005` so
   * that the wiki-diff events land in the same chapter bucket as the
   * continuity-report parsed from the sibling `ch-005` folder.
   *
   * @param rawChangeId Value of the `changeId` frontmatter key, if any.
   * @param inferredChapter Chapter inferred from the file path.
   * @returns Canonical chapter identifier.
   */
  private normalizeChangeId(rawChangeId: unknown, inferredChapter: string): string {
    if (typeof rawChangeId !== 'string' || rawChangeId.length === 0) {
      return inferredChapter;
    }
    const chMatch = /ch-\d+/i.exec(rawChangeId);
    if (chMatch !== null) {return chMatch[0];}
    return inferredChapter;
  }

  /**
   * Scan forward from `startIndex` looking for the first bullet line that
   * matches a relationship description (`A and B are now ...`).
   *
   * PT-3 fix: previously the parser only inspected `lines[i+1]`, which
   * missed the relationship description when it was separated from the
   * `#### Update Relationship` heading by blank lines, HTML comments, or
   * other non-matching content.
   *
   * @param lines All lines of the wiki-diff file.
   * @param startIndex First line to consider (immediately after the heading).
   * @returns Parsed relationship or `null` if none was found in the section.
   */
  private findRelationshipInSection(
    lines: string[],
    startIndex: number,
  ): { entity: string; relatedEntity: string; change: string } | null {
    for (let j = startIndex; j < lines.length; j++) {
      const candidate = lines[j];
      if (/^#{1,6}\s/.test(candidate)) {return null;}
      const relMatch = /^-\s+(.+?)\s+and\s+(.+?)\s+are\s+now\s+(.+)$/i.exec(candidate);
      if (relMatch !== null) {
        return {
          entity: relMatch[1].trim(),
          relatedEntity: relMatch[2].trim(),
          change: relMatch[3].trim(),
        };
      }
    }
    return null;
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
    const indexPath = join(indexDir, 'progressions.json');
    await atomicWriteFile(indexPath, JSON.stringify({ chapters }, null, 2));
    // Re-stat the freshly-written file so the in-memory cache records the
    // real on-disk mtime.  loadAllEvents had to seed the cache with 0
    // (or the pre-write mtime) when it ran, so a follow-up read would
    // otherwise either re-glob the change tree unnecessarily (when the
    // pre-write mtime was 0) or be flagged as stale for the wrong reason.
    if (this.eventsCache !== null) {
      let mtimeMs = 0;
      try {
        const s = await stat(indexPath);
        mtimeMs = s.mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      this.eventsCache = { mtimeMs, chapters: this.eventsCache.chapters };
    }
  }

  /**
   * Get all events for a specific entity across all chapters.
   *
   * When the in-memory cache records a `0` mtime (meaning the previous
   * `loadAllEvents` stat failed) a full rebuild is triggered here as
   * well, so that callers see a freshly collected view of the change
   * tree even when the index file's mtime is unknown.
   *
   * @param entity Entity name to filter by.
   * @returns Chronologically ordered array of events.
   */
  async getProgression(entity: string): Promise<ProgressionEvent[]> {
    // PT-7: re-sort by numeric chapter before returning, even when the
    // on-disk `progressions.json` was written in an arbitrary order.
    let chapters = await this.loadAllEvents();
    // When the prior stat failed (mtime === 0) and the just-loaded chapters
    // are still empty, force a full rebuild so callers see a freshly
    // collected view of the change tree even when the index file's mtime
    // is unknown.  If loadAllEvents already produced non-empty chapters
    // (the common case after a successful full rebuild), the existing
    // data is good — no second rebuild is needed.
    if (this.eventsCache !== null && this.eventsCache.mtimeMs === 0 && chapters.length === 0) {
      const rebuilt = await this.collectEventsFromChanges();
      const indexPath = join(this.projectRoot, 'adab', 'index', 'progressions.json');
      let rebuiltMtimeMs = 0;
      try {
        const s = await stat(indexPath);
        rebuiltMtimeMs = s.mtimeMs;
      } catch {
        rebuiltMtimeMs = 0;
      }
      this.eventsCache = { mtimeMs: rebuiltMtimeMs, chapters: rebuilt };
      chapters = rebuilt;
    }
    const sortedChapters = [...chapters].sort(
      (a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter),
    );
    const events: ProgressionEvent[] = [];
    for (const chapter of sortedChapters) {
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
    // PT-1: thread_status events need the per-entity chain to know whether
    // each event represents forward or backward progression; we cannot
    // determine that from a single `(a, b)` pair when neither carries an
    // explicit `from`.
    const threadChains = this.buildThreadStatusChains(existingEvents, newEvents);
    const newEventSet = new Set<ProgressionEvent>(newEvents);
    for (const newEv of newEvents) {
      if (newEv.type !== 'thread_status') {continue;}
      const chain = threadChains.get(newEv.entity);
      if (chain === undefined) {continue;}
      const newEntry = chain.find((c) => c.ev === newEv);
      if (newEntry === undefined) {continue;}
      for (const oldEv of existingEvents) {
        if (oldEv.type !== 'thread_status' || oldEv.entity !== newEv.entity) {continue;}
        const oldEntry = chain.find((c) => c.ev === oldEv);
        if (oldEntry === undefined) {continue;}
        if (newEntry.isBackward !== oldEntry.isBackward) {
          const newDir = newEntry.isBackward ? 'backward' : 'forward';
          const oldDir = oldEntry.isBackward ? 'backward' : 'forward';
          contradictions.push({
            existing: oldEv,
            new: newEv,
            reason: `Contradictory thread_status ${newDir} progression for ${newEv.entity}: "${oldEv.change}" (${oldDir}) vs "${newEv.change}" (${newDir})`,
          });
        }
      }
    }
    for (const newEv of newEvents) {
      if (newEventSet.has(newEv) === false) {continue;}
      for (const oldEv of existingEvents) {
        if (oldEv.entity === newEv.entity && oldEv.type === newEv.type && newEv.type !== 'thread_status') {
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
    * Perform an incremental update of the progressions index.
    *
    * Scans change directories for modified continuity-report/wiki-diff files
    * (mtime newer than `.last-progression-indexed`), parses them, and merges.
    */
   async incrementalUpdate(): Promise<void> {
     const indexPath = join(this.projectRoot, 'adab', 'index', 'progressions.json');
     const lastIndexedPath = join(this.projectRoot, 'adab', 'index', '.last-progression-indexed');
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
    // M12: Numeric chapter sort (PT-8: `unknown` is pushed to the end via POSITIVE_INFINITY)
    chapters.sort((a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter));
    // Write progressions.json BEFORE .last-progression-indexed so a crash between writes
    // doesn't cause data loss on restart (B5 fix).
    await atomicWriteFile(indexPath, JSON.stringify({ chapters }, null, 2));
    await atomicWriteFile(lastIndexedPath, String(Date.now()));
    // PT-11: invalidate the in-memory cache so the next read observes the new file.
    this.eventsCache = null;
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
    // PT-5: use word-boundary matching so that words like "alliesome" or
    // "undestroyed" do not trigger false positives.
    for (const [pos, neg] of opposites) {
      const aPos = this.hasWord(aLower, pos);
      const bNeg = this.hasWord(bLower, neg);
      const aNeg = this.hasWord(aLower, neg);
      const bPos = this.hasWord(bLower, pos);
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
    // PT-5: use word-boundary matching to avoid "undestroyed" matching "destroyed".
    for (const [pos, neg] of stateOpposites) {
      const aPos = this.hasWord(aLower, pos);
      const bNeg = this.hasWord(bLower, neg);
      const aNeg = this.hasWord(aLower, neg);
      const bPos = this.hasWord(bLower, pos);
      if ((aPos && bNeg) || (aNeg && bPos)) {return true;}
    }
    return false;
  }

  /**
   * Check thread status contradiction between two same-entity events.
   *
   * PT-1 fix: previously the function returned `false` whenever either
   * event lacked an explicit `from` field.  `parseWikiDiff` only writes
   * `to`, so detection was effectively disabled.  The richer per-entity
   * chain analysis is performed by {@link detectContradictions} which
   * builds a chronologically-sorted history first; this helper is now
   * unused but kept (it still answers `(a, b)` correctly when both carry
   * explicit `from` / `to` values).
   */
  private isThreadStatusContradictory(a: ProgressionEvent, b: ProgressionEvent): boolean {
    if (a.type !== 'thread_status' || b.type !== 'thread_status') {return false;}
    if (a.entity !== b.entity) {return false;}
    if (a.from === undefined || a.to === undefined || b.from === undefined || b.to === undefined) {
      return false;
    }
    const aIsBackward = this.isThreadStatusTransitionBackward(a.from, a.to);
    const bIsBackward = this.isThreadStatusTransitionBackward(b.from, b.to);
    return aIsBackward !== bIsBackward;
  }

  /**
   * Compare two thread-status values and decide whether moving from `from`
   * to `to` represents a *backward* progression.  `open` (0) → `advanced`
   * (1) → `resolved` (2); any transition with a lower rank on the right
   * side is a regression.
   */
  private isThreadStatusTransitionBackward(from: string | undefined, to: string | undefined): boolean {
    const rank: Record<string, number> = { open: 0, advanced: 1, resolved: 2 };
    if (from === undefined || to === undefined) {return false;}
    const fromRank = rank[from];
    const toRank = rank[to];
    if (fromRank === undefined || toRank === undefined) {return false;}
    return toRank < fromRank;
  }

  /**
   * Build a chapter-sorted chain of all `thread_status` events relevant to
   * {@link detectContradictions} (existing + newly supplied).  Each entry
   * carries an `isBackward` flag that is computed by walking the chain
   * and using each event's own `from` (when present) or the previous
   * same-entity event's `to` as the effective starting point.
   */
  private buildThreadStatusChains(
    existing: ProgressionEvent[],
    incoming: ProgressionEvent[],
  ): Map<string, Array<{ ev: ProgressionEvent; isBackward: boolean }>> {
    const all = [...existing, ...incoming].filter((ev) => ev.type === 'thread_status');
    all.sort((a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter));
    const byEntity = new Map<string, Array<{ ev: ProgressionEvent; isBackward: boolean }>>();
    for (const ev of all) {
      const list = byEntity.get(ev.entity);
      const prev = list === undefined ? undefined : list[list.length - 1];
      const effectiveFrom = ev.from ?? prev?.ev.to;
      const isBackward = this.isThreadStatusTransitionBackward(effectiveFrom, ev.to);
      const entry = { ev, isBackward };
      if (list === undefined) {
        byEntity.set(ev.entity, [entry]);
      } else {
        list.push(entry);
      }
    }
    return byEntity;
  }

  /**
   * Word-boundary test used by the relationship / state contradiction
   * checks.  PT-5: a plain `String.prototype.includes` match would also
   * fire on substrings (e.g. `alliesome`, `undestroyed`), so we wrap the
   * multi-word phrases in `\b...\b`.
   *
   * @param haystack Lower-cased change text.
   * @param needle   Lower-cased word or phrase to look for.
   * @returns `true` when `needle` occurs as a whole word inside `haystack`.
   */
  private hasWord(haystack: string, needle: string): boolean {
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${escaped}\\b`, 'i').test(haystack);
  }

  /**
   * Extract numeric chapter number from a chapter ID like "ch-012".
   *
   * PT-8 fix: unparseable values (e.g. `"unknown"`) now resolve to
   * `Number.POSITIVE_INFINITY` so they sort *after* every numbered chapter
   * in numeric ascending order.  The previous `0` caused unknown-chapter
   * events to appear *before* `ch-001`.
   *
   * @param chapter Chapter identifier.
   * @returns Numeric chapter number, or `Number.POSITIVE_INFINITY` when unparseable.
   */
  private extractChapterNumber(chapter: string): number {
    const match = /ch-(\d+)/i.exec(chapter);
    return match ? parseInt(match[1], 10) : Number.POSITIVE_INFINITY;
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
   * PT-11: the parsed result is memoised in memory, keyed by the mtime of
   * `progressions.json`.  Subsequent calls with an unchanged file return
   * the cached array without re-globbing the change tree.  When the index
   * is missing or unparseable the chapters are rebuilt from the change
   * tree; the cache is then seeded with a fresh `stat` of the index file
   * (or `0` when the file is still unavailable) so that subsequent reads
   * can benefit from the cache instead of forcing another rebuild.
   *
   * @returns Array of chapter-grouped events.
   */
  private async loadAllEvents(): Promise<ProgressionChapter[]> {
    const indexPath = join(this.projectRoot, 'adab', 'index', 'progressions.json');
    const raw = await safeReadFile(indexPath);
    if (raw !== null) {
      let mtimeMs = 0;
      try {
        const s = await stat(indexPath);
        mtimeMs = s.mtimeMs;
      } catch {
        mtimeMs = 0;
      }
      if (this.eventsCache !== null && this.eventsCache.mtimeMs === mtimeMs) {
        return this.eventsCache.chapters;
      }
      try {
        const parsed: unknown = JSON.parse(raw);
        let chapters: ProgressionChapter[];
        if (Array.isArray(parsed)) {
          chapters = parsed as ProgressionChapter[];
        } else if (typeof parsed === 'object' && parsed !== null && 'chapters' in parsed) {
          chapters = (parsed as ProgressionsIndex).chapters;
        } else {
          console.warn('[ProgressionTracker] Unexpected progressions.json format, rebuilding');
          chapters = await this.collectEventsFromChanges();
        }
        // PT-7: keep the cached output chronologically ordered.
        chapters.sort(
          (a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter),
        );
        this.eventsCache = { mtimeMs, chapters };
        return chapters;
      } catch (err) {
        console.warn('[ProgressionTracker] Failed to parse progressions.json, rebuilding:', err instanceof Error ? err.message : String(err));
      }
    }
    const rebuilt = await this.collectEventsFromChanges();
    let rebuiltMtimeMs = 0;
    try {
      const s = await stat(indexPath);
      rebuiltMtimeMs = s.mtimeMs;
    } catch {
      rebuiltMtimeMs = 0;
    }
    this.eventsCache = { mtimeMs: rebuiltMtimeMs, chapters: rebuilt };
    return rebuilt;
  }

  /**
   * Collect events by scanning all change directories.
   *
   * @param cutoff Only include files with mtime newer than this timestamp (ms).
   * @returns Array of chapter-grouped events.
   */
  private async collectEventsFromChanges(cutoff = 0): Promise<ProgressionChapter[]> {
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
      // PT-6: chapter key is sourced from the parsed event (already inferred from path)
      // rather than mixed with the wiki-diff frontmatter `changeId`.
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
    // M12: Numeric chapter sort (PT-8 puts `unknown` at the end).
    chapters.sort((a, b) => this.extractChapterNumber(a.chapter) - this.extractChapterNumber(b.chapter));
    return chapters;
  }
}
