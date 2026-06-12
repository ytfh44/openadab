/**
 * Unit tests for the Wiki Diff Engine.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
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
});
