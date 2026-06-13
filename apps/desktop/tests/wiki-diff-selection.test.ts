/**
 * Tests for operation-level wiki-diff selection helpers.
 */

import { describe, expect, it } from 'vitest';
import type { WikiDiffOperation } from '../renderer/src/types/inspector.js';
import {
  buildFilteredWikiDiffDocument,
  filterWikiDiffOperations,
  initialWikiDiffSelectionKeys,
  wikiDiffOperationKey,
} from '../renderer/src/utils/wiki-diff-selection.js';

function makeOp(overrides?: Partial<WikiDiffOperation>): WikiDiffOperation {
  return {
    target: overrides?.target ?? 'characters/hero.md',
    type: overrides?.type ?? 'update_field',
    source: overrides?.source ?? 'manuscript/chapters/ch-001.md',
    payload: overrides?.payload ?? { field: 'name', value: 'Hero' },
    warnings: overrides?.warnings,
  };
}

describe('wikiDiffOperationKey', () => {
  it('distinguishes operations with different payloads on the same target', () => {
    const opA = makeOp({ target: 'characters/hero.md', payload: { field: 'name', value: 'A' } });
    const opB = makeOp({ target: 'characters/hero.md', payload: { field: 'alias', value: 'B' } });

    expect(wikiDiffOperationKey(opA)).not.toBe(wikiDiffOperationKey(opB));
  });

  it('includes all identity fields in the key', () => {
    const op = makeOp({ target: 'threads/main.md' });
    const key = wikiDiffOperationKey(op);

    expect(key).toContain('threads/main.md');
    expect(key).toContain('update_field');
    expect(key).toContain('manuscript/chapters/ch-001.md');
  });

  it('is stable and has no positional index', () => {
    const op = makeOp();
    const key = wikiDiffOperationKey(op);

    expect(key).not.toContain('::0::');
    expect(key).not.toContain('::1::');
  });
});

describe('filterWikiDiffOperations', () => {
  const ops: WikiDiffOperation[] = [
    makeOp({ target: 'characters/hero.md', payload: { field: 'name', value: 'A' } }),
    makeOp({ target: 'characters/hero.md', payload: { field: 'alias', value: 'B' } }),
    makeOp({ target: 'threads/main.md', type: 'add_evidence', payload: {} }),
  ];

  it('selects only the checked duplicate-target operation', () => {
    const checked = [wikiDiffOperationKey(ops[1])];

    expect(filterWikiDiffOperations(ops, checked)).toEqual([ops[1]]);
  });

  it('returns operations in original order even when keys arrive out of order', () => {
    const checked = [
      wikiDiffOperationKey(ops[2]),
      wikiDiffOperationKey(ops[0]),
    ];

    expect(filterWikiDiffOperations(ops, checked)).toEqual([ops[0], ops[2]]);
  });

  it('returns an empty list for empty selection or unknown keys', () => {
    expect(filterWikiDiffOperations(ops, [])).toEqual([]);
    expect(filterWikiDiffOperations(ops, ['missing'])).toEqual([]);
  });
});

describe('initialWikiDiffSelectionKeys', () => {
  it('returns one key per operation, including duplicate targets', () => {
    const ops = [
      makeOp({ target: 'characters/hero.md', payload: { field: 'name' } }),
      makeOp({ target: 'characters/hero.md', payload: { field: 'alias' } }),
    ];

    expect(initialWikiDiffSelectionKeys(ops)).toEqual([
      wikiDiffOperationKey(ops[0]),
      wikiDiffOperationKey(ops[1]),
    ]);
  });
});

describe('buildFilteredWikiDiffDocument', () => {
  it('serializes changeId with the selected operations array', () => {
    const content = buildFilteredWikiDiffDocument('draft-ch-001', [makeOp()]);
    const parsed = JSON.parse(content) as {
      changeId?: unknown;
      operations?: unknown[];
    };

    expect(parsed.changeId).toBe('draft-ch-001');
    expect(parsed.operations).toHaveLength(1);
  });

  it('preserves an empty operation list for no-op documents', () => {
    const content = buildFilteredWikiDiffDocument('draft-ch-001', []);
    const parsed = JSON.parse(content) as { operations?: unknown[] };

    expect(parsed.operations).toEqual([]);
  });
});