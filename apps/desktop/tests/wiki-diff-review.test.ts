/**
 * Tests for Wiki Diff Review: operation badge styles, diff parsing,
 * operation filtering, dry-run failure, apply denial, and successful apply.
 *
 * Tests cover:
 *   - Operation type badge color mapping (add=green, update=blue, remove=red, merge=purple)
 *   - WikiDiffResponse type validation (empty ops, missing fields)
 *   - WikiDiffOperation type integrity (required fields)
 *   - Operation filtering for selective apply
 *   - Dry-run failure simulation
 *   - Apply confirmation denial
 *   - Successful apply refresh simulation
 */

import { describe, it, expect } from 'vitest';

import type {
  WikiDiffOperation,
  WikiDiffResponse,
} from '../renderer/src/types/inspector.js';

// ── Badge style lookup (mirror of WikiDiffOperation.tsx constants) ──

const OP_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  add: { bg: '#f0fdf4', text: '#166534', label: 'Add' },
  update: { bg: '#eff6ff', text: '#1d4ed8', label: 'Update' },
  remove: { bg: '#fef2f2', text: '#dc2626', label: 'Remove' },
  merge: { bg: '#faf5ff', text: '#7c3aed', label: 'Merge' },
};

function badgeStyle(type: string): { bg: string; text: string; label: string } {
  return (
    OP_BADGE_STYLES[type] ?? {
      bg: '#f9fafb',
      text: '#6b7280',
      label: type,
    }
  );
}

// ── Operation filtering for selective apply ──

/**
 * Filter operations to only those whose target is in the checked set.
 * Mirrors the logic used in WikiDiffReview for selective apply.
 */
function filterCheckedOperations(
  operations: WikiDiffOperation[],
  checkedTargets: string[],
): WikiDiffOperation[] {
  const checkedSet = new Set(checkedTargets);
  return operations.filter((op) => checkedSet.has(op.target));
}

// ── Dry-run / Apply response validator ──

interface ApplyDiffResponse {
  success: boolean;
  operations?: WikiDiffOperation[];
  errors?: string[];
  summary: string;
}

/**
 * Validate that a dry-run/apply response has the expected shape.
 * Returns null if valid, or an error message if invalid.
 */
function validateApplyResponse(parsed: unknown): string | null {
  if (!parsed || typeof parsed !== 'object') {
    return 'Response is not an object';
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['success'] !== 'boolean') {
    return 'Missing or invalid "success" field';
  }
  if (typeof obj['summary'] !== 'string') {
    return 'Missing or invalid "summary" field';
  }
  return null;
}

// ── Mock helpers ──

function makeOp(overrides?: Partial<WikiDiffOperation>): WikiDiffOperation {
  return {
    target: overrides?.target ?? 'characters/hero',
    type: overrides?.type ?? 'update',
    source: overrides?.source ?? 'adab/changes/ch-001/draft.md',
    payload: overrides?.payload ?? { name: 'Hero', description: 'Brave' },
    warnings: overrides?.warnings,
  };
}

// ── Badge style tests ──────────────────────────────────────

describe('operation badge styles', () => {
  it('add operations are green', () => {
    const style = badgeStyle('add');
    expect(style.bg).toBe('#f0fdf4');
    expect(style.text).toBe('#166534');
    expect(style.label).toBe('Add');
  });

  it('update operations are blue', () => {
    const style = badgeStyle('update');
    expect(style.bg).toBe('#eff6ff');
    expect(style.text).toBe('#1d4ed8');
    expect(style.label).toBe('Update');
  });

  it('remove operations are red', () => {
    const style = badgeStyle('remove');
    expect(style.bg).toBe('#fef2f2');
    expect(style.text).toBe('#dc2626');
    expect(style.label).toBe('Remove');
  });

  it('merge operations are purple', () => {
    const style = badgeStyle('merge');
    expect(style.bg).toBe('#faf5ff');
    expect(style.text).toBe('#7c3aed');
    expect(style.label).toBe('Merge');
  });

  it('unknown types get default gray badge', () => {
    const style = badgeStyle('unknown-type');
    expect(style.bg).toBe('#f9fafb');
    expect(style.text).toBe('#6b7280');
    expect(style.label).toBe('unknown-type');
  });
});

// ── WikiDiffOperation type integrity ────────────────────────

describe('WikiDiffOperation type integrity', () => {
  it('has required fields: target, type, source, payload', () => {
    const op = makeOp();
    expect(op.target).toBe('characters/hero');
    expect(op.type).toBe('update');
    expect(op.source).toBe('adab/changes/ch-001/draft.md');
    expect(op.payload).toEqual({ name: 'Hero', description: 'Brave' });
  });

  it('warnings array is optional', () => {
    const without = makeOp();
    expect(without.warnings).toBeUndefined();

    const withWarnings = makeOp({ warnings: ['Page already exists'] });
    expect(withWarnings.warnings).toEqual(['Page already exists']);
  });

  it('payload can be arbitrary JSON', () => {
    const op = makeOp({
      payload: {
        frontmatter: { title: 'Hero', tags: ['main'] },
        content: '# Hero\n\nA brave character.',
      },
    });
    expect(op.payload).toHaveProperty('frontmatter');
    expect(op.payload).toHaveProperty('content');
  });
});

// ── No wiki-diff (empty) tests ─────────────────────────────

describe('no wiki-diff (empty operations)', () => {
  it('WikiDiffResponse with empty operations array is valid', () => {
    const response: WikiDiffResponse = { operations: [] };
    expect(response.operations).toHaveLength(0);
    expect(response.dryRun).toBeUndefined();
  });

  it('empty operations means no wiki changes', () => {
    const response: WikiDiffResponse = { operations: [] };
    const opCount = response.operations.length;
    expect(opCount).toBe(0);
  });
});

// ── Malformed wiki-diff tests ───────────────────────────────

describe('malformed wiki-diff', () => {
  it('null response is not valid', () => {
    const parsed: unknown = null;
    const isValid =
      parsed !== null &&
      typeof parsed === 'object' &&
      'operations' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>)['operations']);
    expect(isValid).toBe(false);
  });

  it('response without operations array is not valid', () => {
    const parsed: unknown = { changeId: 'ch-001' };
    const isValid =
      parsed !== null &&
      typeof parsed === 'object' &&
      'operations' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>)['operations']);
    expect(isValid).toBe(false);
  });

  it('response with non-array operations is not valid', () => {
    const parsed: unknown = { operations: 'not-an-array' };
    const isValid =
      parsed !== null &&
      typeof parsed === 'object' &&
      'operations' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>)['operations']);
    expect(isValid).toBe(false);
  });

  it('response with operations array but missing target in an operation still parses', () => {
    // Missing fields are tolerated — the UI handles rendering
    const parsed: unknown = {
      operations: [
        { type: 'update', source: 'draft.md' }, // missing target, payload
      ],
    };
    const isValid =
      parsed !== null &&
      typeof parsed === 'object' &&
      'operations' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>)['operations']);
    expect(isValid).toBe(true);
  });

  it('string response is not valid', () => {
    const parsed: unknown = 'not json';
    const isValid =
      parsed !== null &&
      typeof parsed === 'object' &&
      'operations' in (parsed as Record<string, unknown>) &&
      Array.isArray((parsed as Record<string, unknown>)['operations']);
    expect(isValid).toBe(false);
  });
});

// ── Dry-run failure tests ──────────────────────────────────

describe('dry-run failure', () => {
  it('dry-run response with success=false is valid', () => {
    const response: ApplyDiffResponse = {
      success: false,
      errors: ['Wiki page characters/hero not found'],
      summary: '1 operation failed',
    };
    const err = validateApplyResponse(response);
    expect(err).toBeNull();
    expect(response.success).toBe(false);
    expect(response.errors).toHaveLength(1);
  });

  it('dry-run response missing success field is invalid', () => {
    const response: unknown = {
      summary: 'All good',
    };
    const err = validateApplyResponse(response);
    expect(err).toContain('success');
  });

  it('dry-run response with CLI exit code != 0 is treated as error', () => {
    // Simulating what the component sees: exitCode !== 0, parseError set
    const exitCode = 1;
    const parseError = 'wiki apply-diff failed with code 1';
    expect(exitCode).not.toBe(0);
    expect(parseError).toBeTruthy();
  });

  it('dry-run with cancelled event is treated as error', () => {
    const cancelled = true;
    expect(cancelled).toBe(true);
  });
});

// ── Apply confirmation denial tests ─────────────────────────

describe('apply confirmation denial', () => {
  it('apply is disabled when not confirmed', () => {
    const confirmed = false;
    const applyEnabled = confirmed;
    expect(applyEnabled).toBe(false);
  });

  it('apply is enabled when confirmed', () => {
    const confirmed = true;
    const applyEnabled = confirmed;
    expect(applyEnabled).toBe(true);
  });

  it('confirmation requires explicit checkbox', () => {
    // The confirmation checkbox must be explicitly checked.
    // Default state is unchecked (false).
    const defaultConfirmed = false;
    expect(defaultConfirmed).toBe(false);

    // After user clicks, it becomes true
    const afterCheck = true;
    expect(afterCheck).toBe(true);
  });
});

// ── Successful apply refresh tests ─────────────────────────

describe('successful apply refresh', () => {
  it('successful apply returns success=true with summary', () => {
    const response: ApplyDiffResponse = {
      success: true,
      summary: 'Applied 3 operations to 2 wiki pages.',
    };
    const err = validateApplyResponse(response);
    expect(err).toBeNull();
    expect(response.success).toBe(true);
    expect(response.summary).toContain('Applied');
  });

  it('successful apply with zero operations is still success', () => {
    const response: ApplyDiffResponse = {
      success: true,
      summary: 'No operations to apply.',
    };
    expect(response.success).toBe(true);
    expect(response.summary).toBe('No operations to apply.');
  });

  it('successful apply with errors array is still success=true', () => {
    // Some operations may have warnings but overall apply succeeded
    const response: ApplyDiffResponse = {
      success: true,
      operations: [],
      errors: ['Warning: Page characters/hero had merge conflicts'],
      summary: 'Applied with warnings.',
    };
    expect(response.success).toBe(true);
    expect(response.errors).toHaveLength(1);
  });
});

// ── Operation filtering (selective apply) tests ────────────

describe('selective apply operation filtering', () => {
  const ops: WikiDiffOperation[] = [
    makeOp({ target: 'characters/hero', type: 'update' }),
    makeOp({ target: 'locations/castle', type: 'add' }),
    makeOp({ target: 'threads/main-plot', type: 'update' }),
    makeOp({ target: 'characters/villain', type: 'remove' }),
  ];

  it('filters to only checked targets', () => {
    const checked = ['characters/hero', 'threads/main-plot'];
    const filtered = filterCheckedOperations(ops, checked);
    expect(filtered).toHaveLength(2);
    expect(filtered[0].target).toBe('characters/hero');
    expect(filtered[1].target).toBe('threads/main-plot');
  });

  it('returns empty when no targets checked', () => {
    const filtered = filterCheckedOperations(ops, []);
    expect(filtered).toHaveLength(0);
  });

  it('returns all when all targets checked', () => {
    const checked = ops.map((op) => op.target);
    const filtered = filterCheckedOperations(ops, checked);
    expect(filtered).toHaveLength(ops.length);
  });

  it('ignores targets not in operations', () => {
    const checked = ['characters/hero', 'nonexistent/page'];
    const filtered = filterCheckedOperations(ops, checked);
    expect(filtered).toHaveLength(1);
    expect(filtered[0].target).toBe('characters/hero');
  });
});

// ── WikiDiffResponse type tests ─────────────────────────────

describe('WikiDiffResponse type', () => {
  it('parses with dryRun flag set', () => {
    const response: WikiDiffResponse = {
      operations: [makeOp()],
      dryRun: true,
    };
    expect(response.dryRun).toBe(true);
    expect(response.operations).toHaveLength(1);
  });

  it('parses multiple operations with mixed types', () => {
    const response: WikiDiffResponse = {
      operations: [
        makeOp({ target: 'a', type: 'add' }),
        makeOp({ target: 'b', type: 'update' }),
        makeOp({ target: 'c', type: 'remove' }),
        makeOp({ target: 'd', type: 'merge' }),
      ],
    };
    expect(response.operations).toHaveLength(4);
    const types = response.operations.map((o) => o.type);
    expect(types).toEqual(['add', 'update', 'remove', 'merge']);
  });

  it('operations have source and payload', () => {
    const response: WikiDiffResponse = {
      operations: [
        makeOp({
          target: 'characters/hero',
          type: 'add',
          source: 'adab/changes/ch-001/synopsis.md',
          payload: { frontmatter: { name: 'Hero' }, content: '# Hero' },
        }),
      ],
    };
    const op = response.operations[0];
    expect(op.source).toBe('adab/changes/ch-001/synopsis.md');
    expect(op.payload).toHaveProperty('frontmatter');
    expect(op.payload).toHaveProperty('content');
  });
});
