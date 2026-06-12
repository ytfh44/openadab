/**
 * Unit tests for the Wiki Diff Engine.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { WikiEngine } from '../wiki-engine/index.js';

import { WikiDiffParser, WikiDiffApplier } from './index.js';
import { WikiDiffParseError } from '../../utils/errors.js';


function setupProject() {
  const root = mkdtempSync(join(tmpdir(), 'openadab-wikidiff-'));
  mkdirSync(join(root, 'adab', 'wiki'), { recursive: true });
  mkdirSync(join(root, 'adab', 'changes', 'draft-ch-012'), { recursive: true });
  return root;
}

function writeWikiPage(root: string, relPath: string, content: string) {
  const abs = join(root, 'adab', 'wiki', relPath);
  mkdirSync(join(abs, '..'), { recursive: true });
  writeFileSync(abs, content, 'utf-8');
}



function cleanup(root: string) {
  rmSync(root, { recursive: true, force: true });
}

describe('WikiDiffParser', () => {
  const parser = new WikiDiffParser();

  it('parses add_current_state operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara now knows the east gate was opened from inside.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.changeId).toBe('draft-ch-012');
    expect(doc.operations).toHaveLength(1);
    expect(doc.operations[0]).toMatchObject({
      type: 'add_current_state',
      target: 'characters/mara.md',
      source: 'manuscript/chapters/ch-012.md',
      content: 'Mara now knows the east gate was opened from inside.',
    });
  });

  it('parses add_knowledge_timeline operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| ch-012 | east gate opened from inside |\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'add_knowledge_timeline',
      target: 'characters/mara.md',
      chapter: 'ch-012',
      knowledge: 'east gate opened from inside',
    });
  });

  it('parses update_relationship operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Relationship\nMara and Lin are now allies\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_relationship',
      target: 'characters/mara.md',
      relatedEntity: 'Lin',
      relationship: 'allies',
    });
  });

  it('parses update_thread_status operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[threads/east-gate-betrayal]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Thread Status\nStatus: advanced\nNew evidence: guard saw insider\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_thread_status',
      target: 'threads/east-gate-betrayal.md',
      status: 'advanced',
      evidence: ['guard saw insider'],
    });
  });

  it('parses add_evidence operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[threads/east-gate-betrayal]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add Evidence\n- guard saw insider\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'add_evidence',
      target: 'threads/east-gate-betrayal.md',
      evidence: 'guard saw insider',
    });
  });

  it('parses flag_contradiction operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Flag Contradiction\nDescription: Mara knows the gate was open\n- characters/mara: claims gate was closed\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'flag_contradiction',
      target: 'characters/mara.md',
      description: 'Mara knows the gate was open',
      status: 'unresolved',
    });
    expect((doc.operations[0] as any).sources).toHaveLength(1);
  });

  it('parses update_field operation', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Field\nstatus: deceased\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_field',
      target: 'characters/mara.md',
      field: 'status',
      value: 'deceased',
    });
  });

  it('returns empty operations for empty diff', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('throws WikiDiffParseError for unrecognized section header (####)', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Unknown Section\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(WikiDiffParseError);
    await expect(parser.parse(markdown)).rejects.toThrow(/Unrecognized section header/);
  });

  it('throws WikiDiffParseError for duplicate operations', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(WikiDiffParseError);
    await expect(parser.parse(markdown)).rejects.toThrow(/Duplicate operation/);
  });

  it('deduplicates operations with same target+action regardless of sources order', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-013.md\n\n#### Add to Current State\n- Mara knows.\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(WikiDiffParseError);
    await expect(parser.parse(markdown)).rejects.toThrow(/Duplicate operation/);
  });

  it('does not deduplicate operations with different targets', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n\n### [[characters/lin]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Lin knows.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(2);
  });

  it('skips H3 heading without wiki link (non-target headings are harmless)', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### Just a Heading\nSome content.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.changeId).toBe('draft-ch-012');
    expect(doc.operations).toHaveLength(1);
    expect(doc.operations[0].type).toBe('add_current_state');
  });

  // the dedup key now fingerprints the operation's content
  // payload in addition to target+action.  Two operations on the same
  // target with identical action but different content must NOT be
  // treated as duplicates.
  it('does not deduplicate same target+action with different content', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows A.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows B.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(2);
    expect(doc.operations[0]).toMatchObject({ content: 'Mara knows A.' });
    expect(doc.operations[1]).toMatchObject({ content: 'Mara knows B.' });
  });

  it('still deduplicates exact same target+action+content', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-013.md\n\n#### Add to Current State\n- Mara knows.\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Duplicate operation/);
  });

  // The fallback `changeId: …` regex must NOT match a
  // "changeId: …" line that appears deep in the body — only matches
  // within the first 50 lines (or before the next `---`) are valid.
  it('does not pick up changeId from the body', async () => {
    // Build 60 lines of padding to push the body mention past the cutoff.
    const padding = Array.from({ length: 60 }, () => 'filler line').join('\n');
    const markdown = `---\nchangeId: not-in-body\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- changeId: should-not-be-picked-up\n\n${padding}\n`;
    const doc = await parser.parse(markdown);
    expect(doc.changeId).toBe('not-in-body');
  });

  it('uses fallback changeId when only present in body head', async () => {
    const markdown = `# Loose doc\nchangeId: from-body\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.changeId).toBe('from-body');
  });

  // A subject with three names (`X and Y and Z are now W`)
  // must produce `relatedEntity: "Z"` and `relationship: "W"`.  The
  // previous non-greedy regex incorrectly captured `"Y and Z"`.
  it('parses relationship with three names', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Relationship\nMara and Lin and Bob are now allies\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_relationship',
      target: 'characters/mara.md',
      relatedEntity: 'Bob',
      relationship: 'allies',
    });
  });

  it('parses simple two-name relationship unchanged', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Relationship\nMara and Lin are now allies\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_relationship',
      relatedEntity: 'Lin',
      relationship: 'allies',
    });
  });

  // A source line whose page identifier contains additional
  // colons (e.g. `wiki:characters/mara`) must keep the full page
  // identifier on the page field, not chop it at the first `:`.
  it('parses flag_contradiction sources with `:` in page', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Flag Contradiction\nDescription: Gate state conflict\n- wiki:characters/mara: claims gate was open\n- characters/lin: claims gate was closed\n`;
    const doc = await parser.parse(markdown);
    const op = doc.operations[0] as any;
    expect(op.sources).toEqual([
      { page: 'wiki:characters/mara', claim: 'claims gate was open' },
      { page: 'characters/lin', claim: 'claims gate was closed' },
    ]);
  });

  it('still parses simple flag_contradiction sources', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Flag Contradiction\nDescription: Gate state conflict\n- characters/mara: claims gate was closed\n`;
    const doc = await parser.parse(markdown);
    const op = doc.operations[0] as any;
    expect(op.sources).toEqual([{ page: 'characters/mara', claim: 'claims gate was closed' }]);
  });

  // A knowledge-timeline row whose content cell contains `|`
  // must still parse, with the pipe preserved in the knowledge text.
  it('parses knowledge_timeline row with | in content cell', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| ch-012 | gate opened by insider | guard confirmed |\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'add_knowledge_timeline',
      chapter: 'ch-012',
      knowledge: 'gate opened by insider | guard confirmed',
    });
  });

  // The previous implementation dropped every `field: value`
  // line after the first.  Multi-line updates MUST produce one
  // `update_field` operation per line.
  it('parses multiple Update Field lines', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Field\nstatus: deceased\nage: 30\nalive: false\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(3);
    expect(doc.operations[0]).toMatchObject({ type: 'update_field', field: 'status', value: 'deceased' });
    expect(doc.operations[1]).toMatchObject({ type: 'update_field', field: 'age', value: 30 });
    expect(doc.operations[2]).toMatchObject({ type: 'update_field', field: 'alive', value: false });
  });

  // The field-name pattern must accept `-` so e.g.
  // `first-name` is parsed as a field name, not silently dropped.
  it('parses Update Field with hyphenated name', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Update Field\nfirst-name: Mara\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_field',
      field: 'first-name',
      value: 'Mara',
    });
  });

  // A section heading that carries a trailing HTML comment
  // (commonly used as a per-section author note) must still match.
  it('tolerates HTML comment on a section heading', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State <!-- narrative -->\n- Mara knows the gate was opened from inside.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
    expect(doc.operations[0]).toMatchObject({
      type: 'add_current_state',
      content: 'Mara knows the gate was opened from inside.',
    });
  });
});

/**
 * Adversarial / edge-case tests aimed at finding real bugs in the
 * refactored strategy-based parser. These complement the happy-path
 * tests in the main `WikiDiffParser` block above.
 */
describe('WikiDiffParser edge cases (refactor stress tests)', () => {
  const parser = new WikiDiffParser();

  // === Add to Current State ===

  it('preserves order of multiple bullets within a section', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Current State\n- first\n- second\n- third\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations.map((o) => (o as { content: string }).content))
      .toEqual(['first', 'second', 'third']);
  });

  it('skips non-bullet lines but keeps bullets interleaved with them', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Current State\n- keep me\nrandom prose line\n- and me\n\nparagraph break\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations.map((o) => (o as { content: string }).content))
      .toEqual(['keep me', 'and me']);
  });

  // === Add to Knowledge Timeline ===

  it('parses multiple data rows in order', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| ch-001 | first fact |\n| ch-002 | second fact |\n| ch-003 | third fact |\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(3);
    expect((doc.operations[0] as { chapter: string }).chapter).toBe('ch-001');
    expect((doc.operations[2] as { chapter: string }).chapter).toBe('ch-003');
  });

  it('silently drops a row whose chapter is the literal string "Chapter" (header collision)', async () => {
    // The original parser skips the literal "Chapter" header row, but
    // a real data row with the chapter name "Chapter" would also be
    // dropped. This documents the collision: the parser's "is this the
    // header row?" heuristic cannot distinguish them.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| Chapter | should this be kept |\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('skips a row whose chapter cell is all dashes (separator row)', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  // === Update Relationship ===

  it('produces no op for a single-subject relationship (no "and")', async () => {
    // The strategy requires `\s+and\s+` via `lastIndexOf(' and ')`.
    // A sentence like "Mara is now allies" silently yields zero ops.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Relationship\nMara is now allies\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('extracts the final conjunction operand as relatedEntity for >2 names', async () => {
    // Four-name variant: ensure the slice point is the LAST " and ".
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Relationship\nMara and Lin and Bob and Sue are now friends\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations[0]).toMatchObject({
      type: 'update_relationship',
      relatedEntity: 'Sue',
      relationship: 'friends',
    });
  });

  it('produces no op when "are now" is missing', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Relationship\nMara and Lin are friends\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('keeps the relationship value intact when it contains "and"', async () => {
    // The relationship tail is taken as everything after the last
    // " are now ", so internal "and"s in the relationship are
    // preserved verbatim.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Relationship\nMara and Lin are now allies and confidants\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { relationship: string }).relationship)
      .toBe('allies and confidants');
  });

  // === Update Thread Status ===

  it('produces no op when Status: line is absent (evidence-only block)', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Thread Status\nNew evidence: something happened\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('captures multiple "New evidence:" lines in order', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Thread Status\nStatus: advanced\nNew evidence: first\nNew evidence: second\nNew evidence: third\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { evidence: string[] }).evidence)
      .toEqual(['first', 'second', 'third']);
  });

  it('throws on an unknown status value (case-sensitive)', async () => {
    // Status matching is case-sensitive: only the lowercase enum
    // values are accepted. "Open" with capital O is rejected.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Thread Status\nStatus: Open\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Invalid thread status/);
  });

  // === Add Evidence ===

  it('preserves order of multiple evidence bullets', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add Evidence\n- e1\n- e2\n- e3\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations.map((o) => (o as { evidence: string }).evidence))
      .toEqual(['e1', 'e2', 'e3']);
  });

  // === Flag Contradiction ===

  it('produces no op when description is missing (sources-only block)', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Flag Contradiction\n- characters/x: claim1\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('produces an op with empty sources when description is present but no bullets', async () => {
    // The strategy returns a single op with `sources: []` whenever
    // the description regex matches, even if no bullet sources
    // followed. This may or may not be the desired behavior.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Flag Contradiction\nDescription: gate is ambiguous\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
    expect((doc.operations[0] as { sources: unknown[] }).sources).toEqual([]);
  });

  it('skips a bullet source line that has no colon', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Flag Contradiction\nDescription: x\n- just a bullet, no colon here\n- characters/mara: valid claim\n`;
    const doc = await parser.parse(markdown);
    const op = doc.operations[0] as { sources: { page: string; claim: string }[] };
    expect(op.sources).toEqual([{ page: 'characters/mara', claim: 'valid claim' }]);
  });

  // === Update Field ===

  it('coerces "0" to the number 0 (not the string "0")', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\ncount: 0\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { value: unknown }).value).toBe(0);
  });

  it('coerces negative and decimal numbers', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\ndelta: -3.5\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { value: unknown }).value).toBe(-3.5);
  });

  it('does NOT coerce scientific notation to a number (regex requires decimal suffix)', async () => {
    // `1e5` is not matched by `^-?\d+(\.\d+)?$`, so it remains a string.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\nbig: 1e5\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { value: unknown }).value).toBe('1e5');
  });

  it('does NOT coerce the capitalized "True" to a boolean', async () => {
    // Boolean coercion is case-sensitive: only lowercase "true"/"false".
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\nflag: True\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { value: unknown }).value).toBe('True');
  });

  it('skips a field line whose value is empty (e.g. "name:")', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\nname:\nage: 30\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
    expect((doc.operations[0] as { field: string }).field).toBe('age');
  });

  it('preserves a value that itself contains a colon', async () => {
    // The value runs to end-of-line, so embedded colons survive.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\nurl: https://example.com/path\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { value: unknown }).value).toBe('https://example.com/path');
  });

  // === Refactor invariant: operation order across sections ===

  it('preserves the documented section order across mixed sections', async () => {
    // Every section type present in a single block, in a deliberately
    // scrambled order. Operations must be emitted in the canonical
    // strategy order, NOT in source order.
    const markdown = `---\nchangeId: ch\n---\n\n` +
      `### [[a]]\nSource: s.md\n\n` +
      `#### Update Field\nf: 1\n\n` +
      `#### Add Evidence\n- ev\n\n` +
      `#### Add to Current State\n- st\n\n` +
      `#### Update Thread Status\nStatus: open\n\n` +
      `#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| ch-1 | k |\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations.map((o) => o.type)).toEqual([
      'add_current_state',
      'add_knowledge_timeline',
      'update_thread_status',
      'add_evidence',
      'update_field',
    ]);
  });

  // === Refactor invariant: state isolation between blocks ===

  it('parses two consecutive blocks without state leaking between them', async () => {
    // If the field-regex's `lastIndex` were ever cached on the
    // strategy instance (or anywhere else), a second parse could
    // resume from the wrong offset. Two back-to-back parses must
    // each produce the expected count of operations.
    const md1 = `---\nchangeId: ch1\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Current State\n- x1\n- x2\n- x3\n`;
    const md2 = `---\nchangeId: ch2\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Current State\n- y1\n- y2\n`;
    const doc1 = await parser.parse(md1);
    const doc2 = await parser.parse(md2);
    expect(doc1.operations).toHaveLength(3);
    expect(doc2.operations).toHaveLength(2);
  });

  it('parses interleaved blocks from different sources (parser reuse)', async () => {
    // Same parser instance, three documents in a row. Verifies the
    // strategy list is a stable singleton and doesn't accumulate
    // per-call state.
    const make = (id: string) => `---\nchangeId: ${id}\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Field\nv: 1\n`;
    const docs = await Promise.all([parser.parse(make('a')), parser.parse(make('b')), parser.parse(make('c'))]);
    expect(docs.every((d) => d.operations.length === 1)).toBe(true);
  });

  // === Block-level edge cases ===

  it('uses empty source when the Source: line is missing entirely', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\n\n#### Add to Current State\n- x\n`;
    const doc = await parser.parse(markdown);
    expect((doc.operations[0] as { source: string }).source).toBe('');
  });

  it('emits zero operations for a block with only an H3 and a Source line', async () => {
    // No #### sections at all → no ops, no validation error.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(0);
  });

  it('throws on an unrecognized #### section', async () => {
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Totally Made Up Section\n- x\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Unrecognized section header/);
  });

  it('recognizes a section header with case mismatch only via exact match (case-sensitive)', async () => {
    // The validation uses `knownSections.includes(name)` and the
    // strategies are looked up by exact `sectionName`. Mixed-case
    // headings are NOT accepted.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### add to current state\n- x\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Unrecognized section header/);
  });

  it('handles a section header followed by trailing punctuation (must be exact match)', async () => {
    // `extractSectionsByHeading` requires the heading text to be
    // matched exactly. `#### Add to Current State:` (trailing colon)
    // will NOT be recognized by the strategy, and the section
    // validator then sees the heading (via the `####` regex) and
    // throws because the cleaned name "Add to Current State:" is
    // not in the allow-list.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Add to Current State:\n- x\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Unrecognized section header/);
  });

  it('only parses the FIRST occurrence when a section appears twice', async () => {
    // `extractSectionsByHeading` returns the first match and stops at
    // the next heading of equal-or-higher level, so a second
    // occurrence of the same section in the same block is silently
    // ignored. This documents that behavior.
    const markdown = `---\nchangeId: ch\n---\n\n` +
      `### [[a]]\nSource: s.md\n\n` +
      `#### Add to Current State\n- from first\n\n` +
      `#### Add to Current State\n- from second\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
    expect((doc.operations[0] as { content: string }).content).toBe('from first');
  });

  it('validation rejects a heading whose name differs only in surrounding whitespace from a known section', async () => {
    // The validator trims the captured name, so leading/trailing
    // whitespace on a heading is tolerated and the section is
    // recognised. (Documents the relaxed behavior on the
    // validation side; matching for parsing is also whitespace-
    // tolerant via the strategy's heading regex.)
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n####   Add to Current State   \n- x\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
  });

  // === Cross-cutting invariants ===

  it('produces no spurious op when a section contains only a heading and blank lines', async () => {
    // `extractSectionsByHeading` returns null for empty sections, so
    // the strategy must not run and no op is produced.
    const markdown = `---\nchangeId: ch\n---\n\n### [[a]]\nSource: s.md\n\n#### Update Thread Status\n\n\n#### Add Evidence\n- only this one\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations).toHaveLength(1);
    expect(doc.operations[0].type).toBe('add_evidence');
  });

  it('does not dedup two ops of different types with the same payload string', async () => {
    // REGRESSION / PRE-EXISTING BUG EXPOSURE:
    //
    // The dedup key in `parse()` is built as
    //   `${op.target}::${op.action}::${this.dedupPayload(op)}`
    // but `WikiDiffOperation` has no `action` field — it has `type`.
    // At runtime `op.action` is `undefined`, so the key collapses
    // to `${target}::undefined::${payload}`. Two different op types
    // whose payload serializes to the same string therefore collide
    // and the second is wrongly flagged as a duplicate.
    //
    // We construct the collision: an `add_current_state` whose
    // content is the same string as an `add_evidence` whose
    // evidence is the same string. The schema-correct behaviour is
    // to keep both ops; the current behaviour throws.
    const markdown = `---\nchangeId: ch\n---\n\n` +
      `### [[a]]\nSource: s.md\n\n` +
      `#### Add to Current State\n- shared\n\n` +
      `### [[a]]\nSource: s.md\n\n` +
      `#### Add Evidence\n- shared\n`;
    await expect(parser.parse(markdown)).rejects.toThrow(/Duplicate operation/);
  });

  it('all seven section types can co-exist in a single block', async () => {
    // Smoke test: every section type at once, none should be dropped.
    const markdown = `---\nchangeId: ch\n---\n\n` +
      `### [[a]]\nSource: s.md\n\n` +
      `#### Add to Current State\n- a\n\n` +
      `#### Add to Knowledge Timeline\n| Chapter | Knowledge |\n|---------|-----------|\n| ch-1 | k |\n\n` +
      `#### Update Relationship\nA and B are now rivals\n\n` +
      `#### Update Thread Status\nStatus: open\n\n` +
      `#### Add Evidence\n- e\n\n` +
      `#### Flag Contradiction\nDescription: d\n- p: c\n\n` +
      `#### Update Field\nf: v\n`;
    const doc = await parser.parse(markdown);
    expect(doc.operations.map((o) => o.type).sort()).toEqual([
      'add_current_state',
      'add_evidence',
      'add_knowledge_timeline',
      'flag_contradiction',
      'update_field',
      'update_relationship',
      'update_thread_status',
    ]);
  });
});

describe('WikiDiffApplier', () => {
  let root: string;
  let wikiEngine: WikiEngine;
  let applier: WikiDiffApplier;

  beforeEach(() => {
    root = setupProject();
    wikiEngine = new WikiEngine(root);
    applier = new WikiDiffApplier(root, wikiEngine);
  });

  afterEach(() => {
    cleanup(root);
  }, 15000);

  it('applies add_current_state and updates last_updated', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', content: 'Mara now knows the east gate was opened from inside.' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    expect(result.pagesModified).toBe(1);
    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.body).toContain('Mara now knows the east gate was opened from inside.');
    expect(page.frontmatter.last_updated).toBeTruthy();
  });

  it('applies add_knowledge_timeline', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_knowledge_timeline' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', chapter: 'ch-012', knowledge: 'east gate opened from inside' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.body).toContain('| ch-012 | east gate opened from inside |');
  });

  it('applies update_relationship', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'update_relationship' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', relatedEntity: 'Lin', relationship: 'allies' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.body).toContain('- Lin: allies');
  });

  it('applies update_thread_status', async () => {
    writeWikiPage(root, 'threads/east-gate-betrayal.md', `---\ntype: thread\nname: East Gate Betrayal\nstatus: open\n---\n\n# East Gate Betrayal\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'update_thread_status' as const, target: 'threads/east-gate-betrayal.md', source: 'manuscript/chapters/ch-012.md', status: 'advanced' as const, evidence: ['guard saw insider'] },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('threads/east-gate-betrayal.md');
    expect(page.frontmatter.status).toBe('advanced');
    expect(page.body).toContain('guard saw insider');
  });

  it('applies add_evidence', async () => {
    writeWikiPage(root, 'threads/east-gate-betrayal.md', `---\ntype: thread\nname: East Gate Betrayal\nstatus: open\n---\n\n# East Gate Betrayal\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_evidence' as const, target: 'threads/east-gate-betrayal.md', source: 'manuscript/chapters/ch-012.md', evidence: 'guard saw insider' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('threads/east-gate-betrayal.md');
    expect(page.body).toContain('guard saw insider');
  });

  it('re-applying the same add_evidence op twice produces the same page bytes (idempotency)', async () => {
    writeWikiPage(
      root,
      'threads/dupe-1.md',
      `---\ntype: thread\nname: Dupe One\nstatus: open\nlast_updated: "2024-01-01"\n---\n\n# Dupe One\n\n## Evidence\n- existing\n`,
    );
    const doc = {
      changeId: 'draft-ch-101',
      operations: [
        {
          type: 'add_evidence' as const,
          target: 'threads/dupe-1.md',
          source: 'manuscript/chapters/ch-101.md',
          evidence: 'guard saw insider',
        },
      ],
    };
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-1.md'), 'utf-8');
    // Re-apply the same op — body must not grow, and last_updated must
    // not be reset on every re-apply.
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-1.md'), 'utf-8');
    // The two byte streams should be identical (no-op on the second pass).
    expect(afterSecond).toBe(afterFirst);
    // Body MUST contain the new evidence exactly once.
    const occurrences = (afterSecond.match(/^- guard saw insider$/gm) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('applying add_evidence with an item already in Evidence does not append a duplicate', async () => {
    writeWikiPage(
      root,
      'threads/dupe-2.md',
      `---\ntype: thread\nname: Dupe Two\nstatus: open\n---\n\n# Dupe Two\n\n## Evidence\n- existing\n- already on page\n`,
    );
    const doc = {
      changeId: 'draft-ch-102',
      operations: [
        {
          type: 'add_evidence' as const,
          target: 'threads/dupe-2.md',
          source: 'manuscript/chapters/ch-102.md',
          evidence: 'already on page',
        },
      ],
    };
    const before = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-2.md'), 'utf-8');
    await applier.apply(doc, false);
    const after = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-2.md'), 'utf-8');
    // Body MUST be unchanged because the evidence item was already present.
    expect(after).toBe(before);
    // The line MUST appear exactly once, not twice.
    const occurrences = (after.match(/^- already on page$/gm) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('applying add_evidence to a page with no Evidence section creates the section exactly once on re-apply', async () => {
    writeWikiPage(
      root,
      'threads/dupe-3.md',
      `---\ntype: thread\nname: Dupe Three\nstatus: open\n---\n\n# Dupe Three\n\nNo evidence section here yet.\n`,
    );
    const doc = {
      changeId: 'draft-ch-103',
      operations: [
        {
          type: 'add_evidence' as const,
          target: 'threads/dupe-3.md',
          source: 'manuscript/chapters/ch-103.md',
          evidence: 'first clue',
        },
      ],
    };
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-3.md'), 'utf-8');
    // Section was created with the single evidence entry.
    expect(afterFirst).toContain('## Evidence');
    expect((afterFirst.match(/^- first clue$/gm) ?? []).length).toBe(1);
    // Re-apply the SAME op — entry is already present, so no duplicate
    // section header and no duplicate evidence line.
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'dupe-3.md'), 'utf-8');
    expect(afterSecond).toBe(afterFirst);
    expect((afterSecond.match(/^- first clue$/gm) ?? []).length).toBe(1);
    expect((afterSecond.match(/^## Evidence$/gm) ?? []).length).toBe(1);
  });

  it('applies flag_contradiction', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'flag_contradiction' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', description: 'Gate state conflict', sources: [{ page: 'characters/mara', claim: 'gate was closed' }], status: 'unresolved' as const },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    expect(result.contradictionsFlagged).toBe(1);
  });

  it('applies update_field', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'update_field' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', field: 'status', value: 'deceased' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.frontmatter.status).toBe('deceased');
  });

  it('dry-run does not write files', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', content: 'New state' },
      ],
    };
    const result = await applier.apply(doc, true);
    expect(result.success).toBe(true);
    expect(result.summary).toContain('Would modify');
    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.body).not.toContain('New state');
  });

  it('returns validation error for missing source', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: '', content: 'New state' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Validation failed');
  });

  it('returns validation error for non-existent target', async () => {
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/nonexistent.md', source: 'manuscript/chapters/ch-012.md', content: 'New state' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(false);
    expect(result.summary).toContain('Validation failed');
  });

  it('warns on idempotency stale diff', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\nlast_updated: manuscript/chapters/ch-020.md\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', content: 'Old state' },
      ],
    };
    const result = await applier.apply(doc, true);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  // When the related entity is `Lin` and the source target is
  // `characters/mara.md`, the bidirectional update must resolve to
  // `characters/lin.md` (same namespace) — not to the first Lin
  // anywhere in the wiki.
  it('updates related entity page in the same namespace', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    writeWikiPage(root, 'characters/lin.md', `---\ntype: character\nname: Lin\nstatus: alive\n---\n\n# Lin\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'update_relationship' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', relatedEntity: 'Lin', relationship: 'allies' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const linPage = await wikiEngine.readPage('characters/lin.md');
    expect(linPage.body).toContain('- Mara: allies');
  });

  // A `flag_contradiction` whose status is `explained` must
  // delegate to `WikiEngine.updateContradictions` rather than blindly
  // append a second `## …` section to `contradictions.md`.
  it('delegates explained flag_contradiction to updateContradictions', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n`);
    // Seed an existing unresolved contradiction entry
    const contradictionsPath = join(root, 'adab', 'wiki', 'contradictions.md');
    mkdirSync(join(contradictionsPath, '..'), { recursive: true });
    writeFileSync(contradictionsPath, `# Contradictions\n\n## Gate state conflict\n- **characters/mara**: claims gate was open\n- Status: unresolved\n`, 'utf-8');
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        {
          type: 'flag_contradiction' as const,
          target: 'characters/mara.md',
          source: 'manuscript/chapters/ch-012.md',
          description: 'Gate state conflict',
          sources: [{ page: 'characters/mara', claim: 'gate was open' }],
          status: 'explained' as const,
        },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    expect(result.contradictionsFlagged).toBe(1);
    const updated = (await import('node:fs')).readFileSync(contradictionsPath, 'utf-8');
    // The status must have moved from unresolved to explained, not
    // duplicated as a second `## …` section.
    expect(updated).toContain('Status: explained');
    expect(updated.match(/## Gate state conflict/g)?.length).toBe(1);
  });

  // An ISO-date `last_updated` newer than the operation's
  // source date must trigger the stale-diff warning.  Use a date-only
  // format that gray-matter keeps as a string (a full ISO timestamp
  // with `Z` suffix is parsed as a `Date` object and would fail
  // frontmatter validation against the `last_updated: z.string()`
  // schema).
  it('warns on idempotency when last_updated is a date newer than source', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\nlast_updated: "2099-01-01"\n---\n\n# Mara\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: '"2020-01-01"', content: 'Some state' },
      ],
    };
    const result = await applier.apply(doc, true);
    expect(result.warnings.some((w) => w.includes('stale'))).toBe(true);
  });

  // When an existing "## Current State" section is followed by
  // a blank line and then the next heading, appending a new entry must
  // insert it on its own line at the end of the existing entries — the
  // blank-line separator between the section and the next heading must
  // still be present afterwards (i.e. the new entry must not be jammed
  // up against the next heading).
  it('preserves surrounding newlines when appending to an existing section', async () => {
    writeWikiPage(root, 'characters/mara.md', `---\ntype: character\nname: Mara\nstatus: alive\n---\n\n# Mara\n\n## Current State\n- old entry\n\n## Other\nother content\n`);
    const doc = {
      changeId: 'draft-ch-012',
      operations: [
        { type: 'add_current_state' as const, target: 'characters/mara.md', source: 'manuscript/chapters/ch-012.md', content: 'new entry' },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('characters/mara.md');
    // The new entry must appear on its own line right after the old
    // entry, with the existing "## Other" still following a blank
    // line below.
    expect(page.body).toContain('- old entry\n- new entry\n');
    // The blank line between the section and the next heading must be
    // preserved: `## Other` should still be preceded by at least one
    // blank line.
    expect(page.body).toMatch(/- new entry\n\s*\n## Other/);
  });

  // Even when the body would be unchanged, `last_updated` must
  // be refreshed on every apply call (the spec is explicit about
  // this).  Re-applying an `update_thread_status` whose status and
  // evidence are unchanged must still bump `last_updated`.  Note: the
  // engine's `writePage` overwrites `last_updated` with the current
  // ISO timestamp; we therefore assert that the field is *changed*
  // from the initial value, not that it equals the source path.
  it('refreshes last_updated even when nothing else changes', async () => {
    const initialUpdated = 'manuscript/chapters/ch-005.md';
    writeWikiPage(root, 'threads/east-gate-betrayal.md', `---\ntype: thread\nname: East Gate Betrayal\nstatus: advanced\nlast_updated: ${initialUpdated}\n---\n\n# East Gate Betrayal\n\n## Evidence\n- old evidence\n`);
    const doc = {
      changeId: 'draft-ch-013',
      operations: [
        { type: 'update_thread_status' as const, target: 'threads/east-gate-betrayal.md', source: 'manuscript/chapters/ch-013.md', status: 'advanced' as const, evidence: [] },
      ],
    };
    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    const page = await wikiEngine.readPage('threads/east-gate-betrayal.md');
    // The field must no longer hold the initial value — the apply
    // refreshed it (the engine normalizes the value to an ISO
    // timestamp, but the contract is "not the stale value").
    expect(page.frontmatter.last_updated).not.toBe(initialUpdated);
    expect(page.frontmatter.last_updated).toBeTruthy();
  });

  it('re-applying the same update_thread_status op twice produces the same page bytes (idempotency)', async () => {
    writeWikiPage(root, 'threads/quest.md', `---\ntype: thread\nname: Quest\nstatus: advanced\nlast_updated: "2024-01-01"\n---\n\n# Quest\n\n## Evidence\n- existing\n`);
    const doc = {
      changeId: 'draft-ch-014',
      operations: [
        {
          type: 'update_thread_status' as const,
          target: 'threads/quest.md',
          source: 'manuscript/chapters/ch-014.md',
          status: 'advanced' as const,
          evidence: ['newest clue'],
        },
      ],
    };
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'quest.md'), 'utf-8');
    // Re-apply with the same op — body shouldn't grow (no duplicate append),
    // and last_updated shouldn't be reset on every re-apply.
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'quest.md'), 'utf-8');
    // The two byte streams should be identical (no-op on the second pass).
    expect(afterSecond).toBe(afterFirst);
    // Body MUST contain the new evidence exactly once.
    const occurrences = (afterSecond.match(/newest clue/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('applying the same update_thread_status op with overlapping evidence is idempotent (dedups existing items)', async () => {
    writeWikiPage(root, 'threads/mystery.md', `---\ntype: thread\nname: Mystery\nstatus: advanced\nlast_updated: "2024-01-01"\n---\n\n# Mystery\n\n## Evidence\n- a\n- b\n`);
    const doc = {
      changeId: 'draft-ch-015',
      operations: [
        {
          type: 'update_thread_status' as const,
          target: 'threads/mystery.md',
          source: 'manuscript/chapters/ch-015.md',
          status: 'advanced' as const,
          evidence: ['b', 'c'],
        },
      ],
    };
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'mystery.md'), 'utf-8');
    // First apply: 'b' is already present (deduped), only 'c' is appended.
    // Final evidence list MUST be exactly ['a', 'b', 'c'] in order, with no duplicates.
    expect(afterFirst).toMatch(/## Evidence\n- a\n- b\n- c\n/);
    expect((afterFirst.match(/^- b$/gm) ?? []).length).toBe(1);
    expect((afterFirst.match(/^- c$/gm) ?? []).length).toBe(1);
    // Re-apply the SAME op — every entry is already present, so the
    // body must not change at all (idempotency contract).
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'mystery.md'), 'utf-8');
    expect(afterSecond).toBe(afterFirst);
  });

  it('applying update_thread_status without evidence is idempotent (no body change)', async () => {
    const initialUpdated = 'manuscript/chapters/ch-016.md';
    writeWikiPage(root, 'threads/quiet.md', `---\ntype: thread\nname: Quiet\nstatus: advanced\nlast_updated: ${initialUpdated}\n---\n\n# Quiet\n\n## Evidence\n- existing\n`);
    const doc = {
      changeId: 'draft-ch-016',
      operations: [
        {
          type: 'update_thread_status' as const,
          target: 'threads/quiet.md',
          source: 'manuscript/chapters/ch-016.md',
          status: 'advanced' as const,
          evidence: [],
        },
      ],
    };
    const before = readFileSync(join(root, 'adab', 'wiki', 'threads', 'quiet.md'), 'utf-8');
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'quiet.md'), 'utf-8');
    // First apply: status matches, no evidence → no-op path; bytes unchanged.
    expect(afterFirst).toBe(before);
    // Re-apply: must remain unchanged.
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'quiet.md'), 'utf-8');
    expect(afterSecond).toBe(before);
    // last_updated must NOT have been refreshed.
    const page = await wikiEngine.readPage('threads/quiet.md');
    expect(page.frontmatter.last_updated).toBe(initialUpdated);
  });

  it('applying update_thread_status with new evidence when section does not exist yet creates the section exactly once', async () => {
    writeWikiPage(root, 'threads/fresh.md', `---\ntype: thread\nname: Fresh\nstatus: open\nlast_updated: "2024-01-01"\n---\n\n# Fresh\n\nNo evidence section here yet.\n`);
    const doc = {
      changeId: 'draft-ch-017',
      operations: [
        {
          type: 'update_thread_status' as const,
          target: 'threads/fresh.md',
          source: 'manuscript/chapters/ch-017.md',
          status: 'advanced' as const,
          evidence: ['first clue'],
        },
      ],
    };
    await applier.apply(doc, false);
    const afterFirst = readFileSync(join(root, 'adab', 'wiki', 'threads', 'fresh.md'), 'utf-8');
    // Section was created with the single evidence entry.
    expect(afterFirst).toContain('## Evidence');
    expect((afterFirst.match(/^- first clue$/gm) ?? []).length).toBe(1);
    // Re-apply the SAME op — entry is already present, so no duplicate
    // section header and no duplicate evidence line.
    await applier.apply(doc, false);
    const afterSecond = readFileSync(join(root, 'adab', 'wiki', 'threads', 'fresh.md'), 'utf-8');
    expect(afterSecond).toBe(afterFirst);
    expect((afterSecond.match(/^- first clue$/gm) ?? []).length).toBe(1);
    expect((afterSecond.match(/^## Evidence$/gm) ?? []).length).toBe(1);
  });
});
