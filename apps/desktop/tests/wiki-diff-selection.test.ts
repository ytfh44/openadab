/**
 * Tests for operation-level wiki-diff selection helpers.
 *
 * Covers:
 * - Per-operation identity via target::type::source triplet
 * - Selecting individual operations independently of page-level grouping
 * - Building a CLI-accepted temporary diff file with only selected operations
 * - Deselecting an operation removes it from the temp diff
 * - Temp file written to a safe directory under the project root
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { WikiDiffOperation } from '../renderer/src/types/inspector.js';
import {
  buildFilteredWikiDiffDocument,
  filterWikiDiffOperations,
  initialWikiDiffSelectionKeys,
  wikiDiffOperationKey,
  writeWikiDiffTempFile,
} from '../renderer/src/utils/wiki-diff-selection.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeOp(overrides?: Partial<WikiDiffOperation>): WikiDiffOperation {
  return {
    target: overrides?.target ?? 'characters/hero.md',
    type: overrides?.type ?? 'update',
    source: overrides?.source ?? 'manuscript/chapters/ch-001.md',
    payload: overrides?.payload ?? { field: 'name', value: 'Hero' },
    warnings: overrides?.warnings,
  };
}

// ---------------------------------------------------------------------------
// wikiDiffOperationKey
// ---------------------------------------------------------------------------

describe('wikiDiffOperationKey', () => {
  it('produces a stable key from the identity triplet target::type::source', () => {
    const op = makeOp({ target: 'threads/main.md', type: 'add', source: 'manuscript/outline.md' });
    const key = wikiDiffOperationKey(op);
    expect(key).toBe('threads/main.md::add::manuscript/outline.md');
  });

  it('treats operations with the same triplet as identical even when payloads differ', () => {
    const opA = makeOp({ target: 'page.md', type: 'update', source: 'src.md', payload: { a: 1 } });
    const opB = makeOp({ target: 'page.md', type: 'update', source: 'src.md', payload: { b: 2 } });
    expect(wikiDiffOperationKey(opA)).toBe(wikiDiffOperationKey(opB));
  });

  it('distinguishes operations with different target pages', () => {
    const opA = makeOp({ target: 'page-a.md' });
    const opB = makeOp({ target: 'page-b.md' });
    expect(wikiDiffOperationKey(opA)).not.toBe(wikiDiffOperationKey(opB));
  });

  it('distinguishes operations with different types on the same page', () => {
    const opA = makeOp({ target: 'page.md', type: 'create' });
    const opB = makeOp({ target: 'page.md', type: 'delete' });
    expect(wikiDiffOperationKey(opA)).not.toBe(wikiDiffOperationKey(opB));
  });

  it('distinguishes operations with different sources on the same page and type', () => {
    const opA = makeOp({ target: 'page.md', type: 'update', source: 'src-a.md' });
    const opB = makeOp({ target: 'page.md', type: 'update', source: 'src-b.md' });
    expect(wikiDiffOperationKey(opA)).not.toBe(wikiDiffOperationKey(opB));
  });

  it('has no positional index in the key', () => {
    const op = makeOp();
    const key = wikiDiffOperationKey(op);
    expect(key).not.toContain('::0::');
    expect(key).not.toContain('::1::');
  });
});

// ---------------------------------------------------------------------------
// filterWikiDiffOperations
// ---------------------------------------------------------------------------

describe('filterWikiDiffOperations', () => {
  const ops: WikiDiffOperation[] = [
    makeOp({ target: 'characters/hero.md', payload: { field: 'name', value: 'A' } }),
    makeOp({ target: 'characters/villain.md', payload: { field: 'alias', value: 'B' } }),
    makeOp({ target: 'threads/main.md', type: 'create', payload: {} }),
  ];

  it('selects only the checked operation', () => {
    const checked = [wikiDiffOperationKey(ops[2])];
    expect(filterWikiDiffOperations(ops, checked)).toEqual([ops[2]]);
  });

  it('returns operations in original order even when keys arrive out of order', () => {
    const checked = [
      wikiDiffOperationKey(ops[2]),
      wikiDiffOperationKey(ops[0]),
    ];
    expect(filterWikiDiffOperations(ops, checked)).toEqual([ops[0], ops[2]]);
  });

  it('returns an empty list for empty selection', () => {
    expect(filterWikiDiffOperations(ops, [])).toEqual([]);
  });

  it('returns an empty list for unknown keys', () => {
    expect(filterWikiDiffOperations(ops, ['nonexistent::create::src.md'])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// initialWikiDiffSelectionKeys
// ---------------------------------------------------------------------------

describe('initialWikiDiffSelectionKeys', () => {
  it('returns one key per operation', () => {
    const ops = [
      makeOp({ target: 'a.md' }),
      makeOp({ target: 'b.md' }),
    ];
    expect(initialWikiDiffSelectionKeys(ops)).toEqual([
      wikiDiffOperationKey(ops[0]),
      wikiDiffOperationKey(ops[1]),
    ]);
  });

  it('returns empty array for empty operations', () => {
    expect(initialWikiDiffSelectionKeys([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildFilteredWikiDiffDocument
// ---------------------------------------------------------------------------

describe('buildFilteredWikiDiffDocument', () => {
  it('produces a JSON string with an operations array', () => {
    const content = buildFilteredWikiDiffDocument([makeOp()]);
    const parsed = JSON.parse(content) as { operations?: unknown[] };
    expect(parsed.operations).toHaveLength(1);
    expect((parsed.operations![0] as WikiDiffOperation).target).toBe('characters/hero.md');
  });

  it('produces well-formed JSON accepted by CLI format', () => {
    const ops = [makeOp({ target: 'threads/main.md', type: 'create' })];
    const content = buildFilteredWikiDiffDocument(ops);
    // Verify JSON round-trips without throwing
    const parsed = JSON.parse(content) as { operations: WikiDiffOperation[] };
    expect(parsed.operations).toEqual(ops);
  });

  it('preserves an empty operation list for no-op documents', () => {
    const content = buildFilteredWikiDiffDocument([]);
    const parsed = JSON.parse(content) as { operations?: unknown[] };
    expect(parsed.operations).toEqual([]);
  });

  it('includes all fields from each operation', () => {
    const op = makeOp({
      target: 'p.md',
      type: 'merge',
      source: 's.md',
      payload: { key: 'val' },
      warnings: ['warn1'],
    });
    const content = buildFilteredWikiDiffDocument([op]);
    const parsed = JSON.parse(content) as { operations: WikiDiffOperation[] };
    const result = parsed.operations[0];
    expect(result.target).toBe('p.md');
    expect(result.type).toBe('merge');
    expect(result.source).toBe('s.md');
    expect(result.payload).toEqual({ key: 'val' });
    expect(result.warnings).toEqual(['warn1']);
  });
});

// ---------------------------------------------------------------------------
// writeWikiDiffTempFile
// ---------------------------------------------------------------------------

describe('writeWikiDiffTempFile', () => {
  let tmpRoot: string;
  let testDirs: string[];

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openadab-test-'));
    testDirs = [];
  });

  afterEach(async () => {
    for (const dir of testDirs) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
    }
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('writes a temp file under adab/.temp/ within the project root', async () => {
    const ops = [makeOp()];
    const filePath = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);

    expect(filePath).toContain(path.join(tmpRoot, 'adab', '.temp', 'wiki-diff-selected-'));
  });

  it('creates the adab/.temp directory if it does not exist', async () => {
    const ops = [makeOp()];
    const filePath = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);

    const dir = path.dirname(filePath);
    const stat = await fs.stat(dir);
    expect(stat.isDirectory()).toBe(true);
  });

  it('writes valid JSON matching buildFilteredWikiDiffDocument output', async () => {
    const ops = [
      makeOp({ target: 'a.md', type: 'create' }),
      makeOp({ target: 'b.md', type: 'update' }),
    ];
    const filePath = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };
    expect(parsed.operations).toHaveLength(2);
    expect(parsed.operations[0].target).toBe('a.md');
    expect(parsed.operations[1].target).toBe('b.md');
  });

  it('writes only the selected operations to the temp file', async () => {
    const allOps = [
      makeOp({ target: 'keep.md', type: 'create', source: 's1.md' }),
      makeOp({ target: 'skip.md', type: 'delete', source: 's2.md' }),
      makeOp({ target: 'keep2.md', type: 'update', source: 's3.md' }),
    ];
    const selectedKeys = [
      wikiDiffOperationKey(allOps[0]),
      wikiDiffOperationKey(allOps[2]),
    ];
    const selectedOps = filterWikiDiffOperations(allOps, selectedKeys);

    const filePath = await writeWikiDiffTempFile(selectedOps, tmpRoot, fs, path);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };

    expect(parsed.operations).toHaveLength(2);
    expect(parsed.operations.map(o => o.target)).toEqual(['keep.md', 'keep2.md']);
  });

  it('removes deselected operations from the temp diff', async () => {
    const allOps = [
      makeOp({ target: 'page-a.md', type: 'create' }),
      makeOp({ target: 'page-b.md', type: 'update' }),
    ];
    // Start with both selected, then deselect page-b
    const checkedAfterDeselect = [wikiDiffOperationKey(allOps[0])];
    const selectedOps = filterWikiDiffOperations(allOps, checkedAfterDeselect);

    const filePath = await writeWikiDiffTempFile(selectedOps, tmpRoot, fs, path);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };

    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].target).toBe('page-a.md');
  });

  it('writes a valid empty-operations document when nothing is selected', async () => {
    const filePath = await writeWikiDiffTempFile([], tmpRoot, fs, path);
    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };

    expect(parsed.operations).toEqual([]);
  });

  it('uses a timestamp-based filename for uniqueness across writes', async () => {
    const ops = [makeOp()];
    const file1 = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);
    // Small delay to guarantee different timestamp
    await new Promise((r) => setTimeout(r, 5));
    const file2 = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);

    expect(file1).not.toBe(file2);
    expect(path.basename(file1)).toMatch(/^wiki-diff-selected-\d+\.json$/);
    expect(path.basename(file2)).toMatch(/^wiki-diff-selected-\d+\.json$/);
  });

  it('writes pretty-printed JSON for human readability', async () => {
    const ops = [makeOp()];
    const filePath = await writeWikiDiffTempFile(ops, tmpRoot, fs, path);
    const raw = await fs.readFile(filePath, 'utf-8');
    // Pretty-printed JSON has newlines and indentation
    expect(raw).toContain('\n');
    expect(raw).toContain('  ');
  });
});

// ---------------------------------------------------------------------------
// Integration: full selection round-trip
// ---------------------------------------------------------------------------

describe('full selection round-trip', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'openadab-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it('selects individual operations by unique identity and writes temp diff', async () => {
    const ops = [
      makeOp({ target: 'a.md', type: 'create', source: 's1.md' }),
      makeOp({ target: 'a.md', type: 'update', source: 's2.md' }), // same page, different type
      makeOp({ target: 'b.md', type: 'delete', source: 's3.md' }),
    ];

    // Select only operation at index 0 by its identity
    const key = wikiDiffOperationKey(ops[0]);
    const selected = filterWikiDiffOperations(ops, [key]);
    const filePath = await writeWikiDiffTempFile(selected, tmpRoot, fs, path);

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };
    expect(parsed.operations).toEqual([ops[0]]);
  });

  it('handles toggling an operation off after initial full selection', async () => {
    const ops = [
      makeOp({ target: 'x.md', type: 'create' }),
      makeOp({ target: 'y.md', type: 'update' }),
      makeOp({ target: 'z.md', type: 'delete' }),
    ];

    // Simulate deselecting the middle operation
    const allKeys = initialWikiDiffSelectionKeys(ops);
    const toggledOff = allKeys.filter((_, i) => i !== 1);
    const selected = filterWikiDiffOperations(ops, toggledOff);
    const filePath = await writeWikiDiffTempFile(selected, tmpRoot, fs, path);

    const raw = await fs.readFile(filePath, 'utf-8');
    const parsed = JSON.parse(raw) as { operations: WikiDiffOperation[] };
    expect(parsed.operations).toHaveLength(2);
    expect(parsed.operations.map(o => o.target)).toEqual(['x.md', 'z.md']);
  });
});
