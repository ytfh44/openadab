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

  it('skips H3 heading without wiki link (non-target headings are harmless)', async () => {
    const markdown = `---\nchangeId: draft-ch-012\n---\n\n### Just a Heading\nSome content.\n\n### [[characters/mara]]\nSource: manuscript/chapters/ch-012.md\n\n#### Add to Current State\n- Mara knows.\n`;
    const doc = await parser.parse(markdown);
    expect(doc.changeId).toBe('draft-ch-012');
    expect(doc.operations).toHaveLength(1);
    expect(doc.operations[0].type).toBe('add_current_state');
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
});
