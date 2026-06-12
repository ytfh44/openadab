import { mkdtempSync, writeFileSync, mkdirSync, utimesSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { ProgressionTracker } from './index.js';
import type { ProgressionsIndex } from './index.js';


/**
 * Helpers for creating isolated temporary working directories and
 * scaffolding the `adab/index/` folder that the tracker writes into.
 */
function setupTracker() {
  const root = mkdtempSync(join(tmpdir(), 'openadab-pt-'));
  const tracker = new ProgressionTracker(root);
  return { root, tracker };
}

function writeIndex(root: string, body: unknown) {
  const indexDir = join(root, 'adab', 'index');
  mkdirSync(indexDir, { recursive: true });
  writeFileSync(join(indexDir, 'progressions.json'), JSON.stringify(body));
}

/**
 * Re-run the full incremental-update pipeline and return the chapters
 * it wrote to `adab/index/progressions.json`.
 */
async function runIncrementalAndRead(root: string, tracker: ProgressionTracker): Promise<ProgressionsIndex['chapters']> {
  await tracker.incrementalUpdate();
  const raw = readFileSync(join(root, 'adab', 'index', 'progressions.json'), 'utf-8');
  return (JSON.parse(raw) as ProgressionsIndex).chapters;
}

describe('ProgressionTracker', () => {
  // ----- Existing baseline scenarios (kept verbatim) -----
  it('parses continuity-report knowledge entries', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'continuity-report.md');
    writeFileSync(file, '## Character Knowledge\n- Alice now knows the secret\n');
    const events = await tracker.parseContinuityReport(file);
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
    expect(events[0].type).toBe('knowledge');
    expect(events[0].change).toContain('secret');
  });

  it('parses wiki-diff knowledge entry', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'wiki-diff.md');
    writeFileSync(file, `---\nchangeId: ch-002\n---\n\n### [[characters/Alice]]\nSource: manuscript/chapters/ch-002.md\n\n#### Add to Current State\n- Alice learns the truth\n`);
    const events = await tracker.parseWikiDiff(file);
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
    expect(events[0].type).toBe('knowledge');
  });

  it('detects thread status changes', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'wiki-diff.md');
    writeFileSync(file, `---\nchangeId: ch-003\n---\n\n### [[threads/The Prophecy]]\nSource: manuscript/chapters/ch-003.md\n\n#### Update Thread Status\nStatus: resolved\n`);
    const events = await tracker.parseWikiDiff(file);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('thread_status');
    expect(events[0].to).toBe('resolved');
  });

  it('flags contradictions', async () => {
    const { root, tracker } = setupTracker();
    writeIndex(root, {
      chapters: [{
        chapter: 'ch-001',
        events: [{ chapter: 'ch-001', entity: 'Alice', type: 'knowledge' as const, change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' }],
      }],
    });
    const newEvents = [{ chapter: 'ch-002', entity: 'Alice', type: 'knowledge' as const, change: 'does not know secret', timestamp: '2024-01-02T00:00:00Z' }];
    const contradictions = await tracker.detectContradictions(newEvents);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].reason).toContain('Contradictory');
  });

  it('entity query returns matching events', async () => {
    const { root, tracker } = setupTracker();
    writeIndex(root, {
      chapters: [{
        chapter: 'ch-001',
        events: [
          { chapter: 'ch-001', entity: 'Alice', type: 'knowledge', change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' },
          { chapter: 'ch-001', entity: 'Bob', type: 'knowledge', change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' },
        ],
      }],
    });
    const events = await tracker.getProgression('Alice');
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
  });

  // ----- PT-1: thread status backward detection must work even when `from` is absent -----
  describe('PT-1 thread status backward detection', () => {
    it('detects backward progression (advanced → open) when from is missing and history chains to advanced', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'The Prophecy', type: 'thread_status' as const, change: 'Thread status changed to advanced', to: 'advanced', timestamp: '2024-01-01T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-002', entity: 'The Prophecy', type: 'thread_status' as const, change: 'Thread status changed to open', to: 'open', timestamp: '2024-01-02T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBeGreaterThan(0);
      expect(contradictions[0].reason).toContain('thread_status');
    });

    it('does not flag forward progression (open → advanced → resolved) as contradictory', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'The Prophecy', type: 'thread_status' as const, change: 'Thread status changed to open', to: 'open', timestamp: '2024-01-01T00:00:00Z' }] },
          { chapter: 'ch-002', events: [{ chapter: 'ch-002', entity: 'The Prophecy', type: 'thread_status' as const, change: 'Thread status changed to advanced', to: 'advanced', timestamp: '2024-01-02T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-003', entity: 'The Prophecy', type: 'thread_status' as const, change: 'Thread status changed to resolved', to: 'resolved', timestamp: '2024-01-03T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBe(0);
    });

    it('detects mixed forward (existing) vs backward (new) for the same thread', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Quest', type: 'thread_status' as const, change: 'Thread status changed to open', to: 'open', timestamp: '2024-01-01T00:00:00Z' }] },
          { chapter: 'ch-002', events: [{ chapter: 'ch-002', entity: 'Quest', type: 'thread_status' as const, change: 'Thread status changed to resolved', to: 'resolved', timestamp: '2024-01-02T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-003', entity: 'Quest', type: 'thread_status' as const, change: 'Thread status changed to open', to: 'open', timestamp: '2024-01-03T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBeGreaterThan(0);
    });
  });

  // ----- PT-2: parseWikiDiff must use the target of [[Target|Alias]], not the alias -----
  describe('PT-2 parseWikiDiff entity extraction (alias trap)', () => {
    it('extracts target name (not alias) for `[[characters/Alice|The Alice]]`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-005\n---\n\n### [[characters/Alice|The Alice]]\nSource: manuscript/chapters/ch-005.md\n\n#### Add to Current State\n- Alice learns the truth\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Alice');
    });

    it('still extracts the target when alias is empty `[[Alice|]]`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-005\n---\n\n### [[characters/Alice|]]\nSource: manuscript/chapters/ch-005.md\n\n#### Add to Current State\n- Alice learns the truth\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Alice');
    });

    it('handles nested-path target with alias `[[threads/Quest Of Rings|Hero Quest]]`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-006\n---\n\n### [[threads/Quest Of Rings|Hero Quest]]\n\n#### Update Thread Status\nStatus: advanced\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Quest Of Rings');
    });
  });

  // ----- PT-3: `#### Update Relationship` must scan beyond just lines[i+1] -----
  describe('PT-3 parseWikiDiff Update Relationship scanning', () => {
    it('finds relationship description when separated from header by a blank line', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-007\n---\n\n### [[characters/Mara]]\n\n#### Update Relationship\n\n- Mara and Lin are now allies against the priesthood\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].type).toBe('relationship');
      expect(events[0].entity).toBe('Mara');
      expect(events[0].relatedEntity).toBe('Lin');
      expect(events[0].change).toContain('allies');
    });

    it('finds relationship description when separated by a comment line', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-007\n---\n\n### [[characters/Mara]]\n\n#### Update Relationship\n<!-- author note -->\n- Mara and Lin are now rivals in the contest\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].relatedEntity).toBe('Lin');
      expect(events[0].change).toContain('rivals');
    });

    it('still parses when relationship description is on the immediate next line', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, `---\nchangeId: ch-007\n---\n\n### [[characters/Mara]]\n\n#### Update Relationship\n- Mara and Lin are now friends\n`);
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].change).toContain('friends');
    });
  });

  // ----- PT-4: parseContinuityReport must skip negated knowledge lines -----
  describe('PT-4 parseContinuityReport negation filter', () => {
    it('skips `does not know` lines', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Alice does not know the secret\n- Bob now knows the secret\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Bob');
    });

    it('skips `no longer knows` lines', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Alice no longer knows the truth\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(0);
    });

    it('skips `forgot` and `never learned` lines', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Alice forgot the spell\n- Bob never learned the spell\n- Cara now knows the spell\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Cara');
    });
  });

  // ----- PT-5: relationship / state matches must be word-boundary safe -----
  describe('PT-5 word-boundary state/relationship matching', () => {
    it('relationship: does not flag "allies" substring inside unrelated word', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Mara', type: 'relationship' as const, change: 'allies of the crown', timestamp: '2024-01-01T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-002', entity: 'Mara', type: 'relationship' as const, change: 'alliesome companions of the queen', timestamp: '2024-01-02T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBe(0);
    });

    it('relationship: detects allies ↔ enemies across two events', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Mara', type: 'relationship' as const, change: 'allies against Lin', timestamp: '2024-01-01T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-002', entity: 'Mara', type: 'relationship' as const, change: 'enemies of Lin', timestamp: '2024-01-02T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBeGreaterThan(0);
    });

    it('state: detects destroyed ↔ repaired without false-positive on "undestroyed"', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Bridge', type: 'state' as const, change: 'destroyed by fire', timestamp: '2024-01-01T00:00:00Z' }] },
        ],
      });
      const newEvents = [
        { chapter: 'ch-002', entity: 'Bridge', type: 'state' as const, change: 'undestroyed landmark', timestamp: '2024-01-02T00:00:00Z' },
      ];
      const contradictions = await tracker.detectContradictions(newEvents);
      expect(contradictions.length).toBe(0);
    });
  });

  // ----- PT-6: chapter keys must be unified between continuity-report and wiki-diff -----
  describe('PT-6 chapter key normalization across sources', () => {
    it('merges wiki-diff changeId `ch-002` with continuity-report path `ch-002` into one chapter bucket', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes', 'ch-002');
      mkdirSync(changesDir, { recursive: true });
      writeFileSync(join(changesDir, 'continuity-report.md'),
        '## Character Knowledge\n- Mara now knows the truth\n');
      writeFileSync(join(changesDir, 'wiki-diff.md'),
        `---\nchangeId: ch-002\n---\n\n### [[threads/Quest]]\n\n#### Update Thread Status\nStatus: advanced\n`);
      // bump mtime to ensure both files are picked up
      const now = new Date();
      utimesSync(join(changesDir, 'continuity-report.md'), now, now);
      utimesSync(join(changesDir, 'wiki-diff.md'), now, now);

      const chapters = await runIncrementalAndRead(root, tracker);
      const ch002 = chapters.find((c) => c.chapter === 'ch-002');
      expect(ch002).toBeDefined();
      expect(ch002!.events.length).toBe(2);
    });

    it('uses inferred chapter from wiki-diff path when frontmatter changeId is missing', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes', 'ch-009');
      mkdirSync(changesDir, { recursive: true });
      writeFileSync(join(changesDir, 'wiki-diff.md'),
        `### [[threads/Quest]]\n\n#### Update Thread Status\nStatus: resolved\n`);
      const now = new Date();
      utimesSync(join(changesDir, 'wiki-diff.md'), now, now);

      const chapters = await runIncrementalAndRead(root, tracker);
      const ch009 = chapters.find((c) => c.chapter === 'ch-009');
      expect(ch009).toBeDefined();
      expect(ch009!.events[0].entity).toBe('Quest');
    });

    it('normalizes changeId `draft-ch-005` to inferred `ch-005` for merging with continuity-report', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes', 'ch-005');
      mkdirSync(changesDir, { recursive: true });
      writeFileSync(join(changesDir, 'continuity-report.md'),
        '## Character Knowledge\n- Mara now knows the truth\n');
      writeFileSync(join(changesDir, 'wiki-diff.md'),
        `---\nchangeId: draft-ch-005\n---\n\n### [[threads/Quest]]\n\n#### Update Thread Status\nStatus: open\n`);
      const now = new Date();
      utimesSync(join(changesDir, 'continuity-report.md'), now, now);
      utimesSync(join(changesDir, 'wiki-diff.md'), now, now);

      const chapters = await runIncrementalAndRead(root, tracker);
      const ch005 = chapters.find((c) => c.chapter === 'ch-005');
      expect(ch005).toBeDefined();
      expect(ch005!.events.length).toBe(2);
    });
  });

  // ----- PT-7: getProgression must return events in chronological chapter order -----
  describe('PT-7 getProgression chronological order', () => {
    it('returns events in numeric chapter order even when progressions.json is out of order', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-005', events: [{ chapter: 'ch-005', entity: 'Mara', type: 'knowledge', change: 'Learned X', timestamp: '2024-01-05T00:00:00Z' }] },
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Mara', type: 'knowledge', change: 'Learned Y', timestamp: '2024-01-01T00:00:00Z' }] },
          { chapter: 'ch-003', events: [{ chapter: 'ch-003', entity: 'Mara', type: 'knowledge', change: 'Learned Z', timestamp: '2024-01-03T00:00:00Z' }] },
        ],
      });
      const events = await tracker.getProgression('Mara');
      expect(events.map((e) => e.chapter)).toEqual(['ch-001', 'ch-003', 'ch-005']);
    });

    it('handles non-padded chapter numbers like `ch-3` and `ch-12` numerically', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-12', events: [{ chapter: 'ch-12', entity: 'Mara', type: 'knowledge', change: 'L', timestamp: '2024-01-12T00:00:00Z' }] },
          { chapter: 'ch-3', events: [{ chapter: 'ch-3', entity: 'Mara', type: 'knowledge', change: 'L', timestamp: '2024-01-03T00:00:00Z' }] },
        ],
      });
      const events = await tracker.getProgression('Mara');
      expect(events.map((e) => e.chapter)).toEqual(['ch-3', 'ch-12']);
    });

    it('returns events from both entity and relatedEntity fields in chronological order', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'ch-002', events: [{ chapter: 'ch-002', entity: 'Mara', type: 'relationship', change: 'allies', relatedEntity: 'Lin', timestamp: '2024-01-02T00:00:00Z' }] },
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Lin', type: 'state', change: 'tired', timestamp: '2024-01-01T00:00:00Z' }] },
        ],
      });
      const events = await tracker.getProgression('Lin');
      expect(events.map((e) => e.chapter)).toEqual(['ch-001', 'ch-002']);
    });
  });

  // ----- PT-8: `unknown` chapter must not be treated as chapter 0 -----
  describe('PT-8 unknown chapter sorting', () => {
    it('sorts `unknown` chapter after every numbered chapter', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'unknown', events: [{ chapter: 'unknown', entity: 'Mara', type: 'knowledge', change: 'L', timestamp: '2024-01-99T00:00:00Z' }] },
          { chapter: 'ch-001', events: [{ chapter: 'ch-001', entity: 'Mara', type: 'knowledge', change: 'L', timestamp: '2024-01-01T00:00:00Z' }] },
          { chapter: 'ch-005', events: [{ chapter: 'ch-005', entity: 'Mara', type: 'knowledge', change: 'L', timestamp: '2024-01-05T00:00:00Z' }] },
        ],
      });
      const events = await tracker.getProgression('Mara');
      expect(events.map((e) => e.chapter)).toEqual(['ch-001', 'ch-005', 'unknown']);
    });

    it('collectEventsFromChanges puts numbered chapters before `unknown`', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes');
      mkdirSync(changesDir, { recursive: true });
      // file inside a directory that has no `ch-NNN` pattern → chapter becomes `unknown`
      const looseDir = join(changesDir, 'loose-chapter');
      mkdirSync(looseDir, { recursive: true });
      writeFileSync(join(looseDir, 'continuity-report.md'),
        '## Character Knowledge\n- Mara now knows the truth\n');
      const numberedDir = join(changesDir, 'ch-002');
      mkdirSync(numberedDir, { recursive: true });
      writeFileSync(join(numberedDir, 'continuity-report.md'),
        '## Character Knowledge\n- Bob now knows the truth\n');
      const now = new Date();
      utimesSync(join(looseDir, 'continuity-report.md'), now, now);
      utimesSync(join(numberedDir, 'continuity-report.md'), now, now);

      const chapters = await runIncrementalAndRead(root, tracker);
      const ch002Idx = chapters.findIndex((c) => c.chapter === 'ch-002');
      const unknownIdx = chapters.findIndex((c) => c.chapter === 'unknown');
      expect(ch002Idx).toBeGreaterThanOrEqual(0);
      expect(unknownIdx).toBeGreaterThanOrEqual(0);
      expect(ch002Idx).toBeLessThan(unknownIdx);
    });

    it('keeps stable order between multiple `unknown` chapters', async () => {
      const { root, tracker } = setupTracker();
      writeIndex(root, {
        chapters: [
          { chapter: 'unknown', events: [{ chapter: 'unknown', entity: 'Mara', type: 'knowledge', change: 'A', timestamp: '2024-01-01T00:00:00Z' }] },
          { chapter: 'unknown', events: [{ chapter: 'unknown', entity: 'Mara', type: 'knowledge', change: 'B', timestamp: '2024-01-02T00:00:00Z' }] },
        ],
      });
      const events = await tracker.getProgression('Mara');
      expect(events.length).toBe(2);
    });
  });

  // ----- PT-9: `#### Add to Current State` must scan to the next heading, not a hard 10 lines -----
  describe('PT-9 Add to Current State full block', () => {
    it('captures content beyond 10 lines', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      const lines: string[] = [
        '---',
        'changeId: ch-010',
        '---',
        '',
        '### [[characters/Alice]]',
        '',
        '#### Add to Current State',
      ];
      for (let i = 0; i < 15; i++) {
        lines.push(`- Fact number ${i + 1}`);
      }
      writeFileSync(file, lines.join('\n') + '\n');
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(1);
      expect(events[0].change).toContain('Fact number 15');
    });

    it('stops at next `####` sub-heading', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, [
        '---', 'changeId: ch-010', '---', '',
        '### [[characters/Alice]]', '',
        '#### Add to Current State',
        '- first',
        '- second',
        '#### Add Evidence',
        '- third',
      ].join('\n') + '\n');
      const events = await tracker.parseWikiDiff(file);
      const knowledge = events.find((e) => e.type === 'knowledge');
      expect(knowledge).toBeDefined();
      expect(knowledge!.change).not.toContain('third');
    });

    it('stops at next `###` entity heading', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, [
        '---', 'changeId: ch-010', '---', '',
        '### [[characters/Alice]]', '',
        '#### Add to Current State',
        '- first',
        '### [[characters/Bob]]',
        '- should not be captured',
      ].join('\n') + '\n');
      const events = await tracker.parseWikiDiff(file);
      const aliceEvents = events.filter((e) => e.entity === 'Alice');
      expect(aliceEvents.length).toBe(1);
      expect(aliceEvents[0].change).not.toContain('should not be captured');
    });
  });

  // ----- PT-10: parseWikiDiff must guard against empty / whitespace-only entity names -----
  describe('PT-10 currentEntity null guard', () => {
    it('produces no events when file has no `### [[Entity]]` block', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, '---\nchangeId: ch-011\n---\n\n#### Add to Current State\n- some fact\n');
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(0);
    });

    it('produces no events for an empty `### [[]]` header', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, '---\nchangeId: ch-011\n---\n\n### [[]]\n\n#### Add to Current State\n- some fact\n');
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(0);
    });

    it('produces no events for a whitespace-only `### [[   ]]` header', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'wiki-diff.md');
      writeFileSync(file, '---\nchangeId: ch-011\n---\n\n### [[   ]]\n\n#### Add to Current State\n- some fact\n');
      const events = await tracker.parseWikiDiff(file);
      expect(events.length).toBe(0);
    });
  });

  // ----- PT-11: loadAllEvents must cache parsed progressions.json until mtime changes -----
  describe('PT-11 loadAllEvents in-memory cache', () => {
    it('serves subsequent getProgression calls from cache while progressions.json mtime is unchanged', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes', 'ch-013');
      mkdirSync(changesDir, { recursive: true });
      writeFileSync(join(changesDir, 'continuity-report.md'),
        '## Character Knowledge\n- Mara now knows the truth\n');
      const now = new Date();
      utimesSync(join(changesDir, 'continuity-report.md'), now, now);

      // prime the cache by running incrementalUpdate
      await tracker.incrementalUpdate();
      const first = await tracker.getProgression('Mara');
      expect(first.length).toBe(1);

      // write a NEW continuity-report file AFTER the cache has been primed;
      // the index file's mtime does not change, so the next read should
      // return the cached value (which does not include ch-014).
      const changesDir2 = join(root, 'adab', 'changes', 'ch-014');
      mkdirSync(changesDir2, { recursive: true });
      writeFileSync(join(changesDir2, 'continuity-report.md'),
        '## Character Knowledge\n- Bob now knows the truth\n');
      const later = new Date(now.getTime() + 5000);
      utimesSync(join(changesDir2, 'continuity-report.md'), later, later);

      const cached = await tracker.getProgression('Mara');
      expect(cached.length).toBe(1);
      expect(cached[0].chapter).toBe('ch-013');

      // also verify Bob is not visible in the cached view
      const cachedBob = await tracker.getProgression('Bob');
      expect(cachedBob.length).toBe(0);
    });

    it('invalidates the cache when progressions.json mtime changes', async () => {
      const { root, tracker } = setupTracker();
      const changesDir = join(root, 'adab', 'changes', 'ch-015');
      mkdirSync(changesDir, { recursive: true });
      writeFileSync(join(changesDir, 'continuity-report.md'),
        '## Character Knowledge\n- Mara now knows the truth\n');
      const now = new Date();
      utimesSync(join(changesDir, 'continuity-report.md'), now, now);

      await tracker.incrementalUpdate();

      // Simulate a fresh index file written by a previous run with extra data
      const indexPath = join(root, 'adab', 'index', 'progressions.json');
      mkdirSync(join(root, 'adab', 'index'), { recursive: true });
      writeFileSync(indexPath, JSON.stringify({
        chapters: [
          { chapter: 'ch-099', events: [{ chapter: 'ch-099', entity: 'Synthetic', type: 'knowledge', change: 'L', timestamp: '2024-02-09T00:00:00Z' }] },
        ],
      }));
      const refreshed = await tracker.getProgression('Synthetic');
      expect(refreshed.length).toBe(1);
      expect(refreshed[0].chapter).toBe('ch-099');
    });
  });

  // ----- PT-12: parseContinuityReport must accept knew/learned/has learned tenses -----
  describe('PT-12 knew/learned tense support', () => {
    it('matches `now knew`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Alice now knew the secret\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Alice');
    });

    it('matches `has learned`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Bob has learned the spell\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(1);
      expect(events[0].change).toContain('spell');
    });

    it('still matches `now knows`', async () => {
      const { root, tracker } = setupTracker();
      const file = join(root, 'continuity-report.md');
      writeFileSync(file, '## Character Knowledge\n- Cara now knows the truth\n');
      const events = await tracker.parseContinuityReport(file);
      expect(events.length).toBe(1);
      expect(events[0].entity).toBe('Cara');
    });
  });
});
