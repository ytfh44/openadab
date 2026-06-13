/**
 * Tests for Changes Workbench: DAG node parsing, layout computation,
 * status parsing, and failure handling.
 *
 * Tests cover:
 *   - Linear DAGs (sequential dependencies)
 *   - Parallel DAGs (multiple branches)
 *   - Optional artifacts
 *   - Failed status command (non-zero exit)
 *   - Schema changes (different artifact structures)
 *   - Validation error detection
 *   - Apply-ready detection
 *   - All-artifacts-done detection
 */

import { describe, it, expect } from 'vitest';

import type { ArtifactStatus } from '../renderer/src/types/changes.js';
import { parseStatusJson } from '../renderer/src/routes/ChangesWorkbench.js';
import { computeLayout } from '../renderer/src/components/ArtifactDAG.js';
import {
  allArtifactsDone,
  hasValidationErrors,
  isApplyReady,
} from '../renderer/src/routes/ChangesWorkbench.js';

// ── Helpers ────────────────────────────────────────────────

/** Create a minimal artifact for testing. */
function makeArtifact(overrides?: Partial<ArtifactStatus>): ArtifactStatus {
  return {
    id: overrides?.id ?? 'test-artifact',
    status: overrides?.status ?? 'ready',
    generatedFile: overrides?.generatedFile,
    dependencies: overrides?.dependencies,
    validations: overrides?.validations,
    blockingIssues: overrides?.blockingIssues,
    nextStep: overrides?.nextStep,
  };
}

/** Create mock status JSON for a linear DAG: brief → outline → draft. */
function mockLinearStatus(): unknown {
  return {
    changeId: 'ch-001',
    schemaType: 'chapter-draft',
    artifacts: [
      {
        id: 'brief',
        status: 'done',
        generatedFile: 'adab/changes/ch-001/brief.md',
        dependencies: [],
        validations: { errors: [], warnings: [] },
      },
      {
        id: 'outline',
        status: 'done',
        generatedFile: 'adab/changes/ch-001/outline.md',
        dependencies: ['brief'],
        validations: { errors: [], warnings: [] },
      },
      {
        id: 'draft',
        status: 'ready',
        generatedFile: null,
        dependencies: ['outline'],
        blockingIssues: [],
        nextStep: { applyTarget: 'manuscript' },
      },
    ],
  };
}

/** Create mock status JSON for a parallel DAG: root → [branchA, branchB] → merge. */
function mockParallelStatus(): unknown {
  return {
    changeId: 'ch-002',
    schemaType: 'complex-workflow',
    artifacts: [
      {
        id: 'research',
        status: 'done',
        generatedFile: 'adab/changes/ch-002/research.md',
        dependencies: [],
      },
      {
        id: 'outline-a',
        status: 'done',
        generatedFile: 'adab/changes/ch-002/outline-a.md',
        dependencies: ['research'],
      },
      {
        id: 'outline-b',
        status: 'ready',
        generatedFile: null,
        dependencies: ['research'],
      },
      {
        id: 'merge',
        status: 'blocked',
        generatedFile: null,
        dependencies: ['outline-a', 'outline-b'],
        blockingIssues: ['Waiting for outline-b to complete'],
      },
    ],
  };
}

/** Create mock status JSON with optional artifacts. */
function mockOptionalStatus(): unknown {
  return {
    changeId: 'ch-003',
    artifacts: [
      {
        id: 'required-step',
        status: 'done',
        generatedFile: 'adab/changes/ch-003/required.md',
        dependencies: [],
      },
      {
        id: 'optional-diagram',
        status: 'optional',
        generatedFile: null,
        dependencies: ['required-step'],
      },
      {
        id: 'final',
        status: 'done',
        generatedFile: 'adab/changes/ch-003/final.md',
        dependencies: ['required-step'],
      },
    ],
  };
}

// ── parseStatusJson tests ──────────────────────────────────

describe('parseStatusJson', () => {
  it('parses a linear DAG status correctly', () => {
    const result = parseStatusJson(mockLinearStatus());
    expect(result).not.toBeNull();
    expect(result!.changeId).toBe('ch-001');
    expect(result!.schemaType).toBe('chapter-draft');
    expect(result!.artifacts).toHaveLength(3);

    const brief = result!.artifacts.find((a) => a.id === 'brief')!;
    expect(brief.status).toBe('done');
    expect(brief.generatedFile).toBe('adab/changes/ch-001/brief.md');
    expect(brief.dependencies).toEqual([]);

    const draft = result!.artifacts.find((a) => a.id === 'draft')!;
    expect(draft.status).toBe('ready');
    expect(draft.dependencies).toEqual(['outline']);
    expect(draft.nextStep?.applyTarget).toBe('manuscript');
    expect(draft.generatedFile).toBeNull();
  });

  it('parses a parallel DAG with two branches', () => {
    const result = parseStatusJson(mockParallelStatus());
    expect(result).not.toBeNull();
    expect(result!.artifacts).toHaveLength(4);

    const merge = result!.artifacts.find((a) => a.id === 'merge')!;
    expect(merge.status).toBe('blocked');
    expect(merge.dependencies).toEqual(['outline-a', 'outline-b']);
    expect(merge.blockingIssues).toHaveLength(1);
    expect(merge.blockingIssues![0]).toContain('outline-b');
  });

  it('parses optional artifacts correctly', () => {
    const result = parseStatusJson(mockOptionalStatus());
    expect(result).not.toBeNull();
    expect(result!.artifacts).toHaveLength(3);

    const optional = result!.artifacts.find((a) => a.id === 'optional-diagram')!;
    expect(optional.status).toBe('optional');
    expect(optional.dependencies).toEqual(['required-step']);
  });

  it('returns null for missing artifacts array', () => {
    expect(parseStatusJson({ changeId: 'ch-001' })).toBeNull();
    expect(parseStatusJson(null)).toBeNull();
    expect(parseStatusJson(undefined)).toBeNull();
    expect(parseStatusJson('not-an-object')).toBeNull();
    expect(parseStatusJson(42)).toBeNull();
  });

  it('handles artifacts array that is not an array', () => {
    expect(parseStatusJson({ artifacts: 'not-an-array' })).toBeNull();
  });

  it('handles empty artifacts array', () => {
    const result = parseStatusJson({ changeId: 'ch-empty', artifacts: [] });
    expect(result).not.toBeNull();
    expect(result!.artifacts).toHaveLength(0);
  });

  it('defaults missing fields to safe values', () => {
    const result = parseStatusJson({
      artifacts: [{ id: 'minimal' }],
    });
    expect(result).not.toBeNull();
    const art = result!.artifacts[0];
    expect(art.id).toBe('minimal');
    expect(art.status).toBe('blocked'); // default
    expect(art.generatedFile).toBeUndefined();
    expect(art.dependencies).toBeUndefined();
  });

  it('handles different schema structures', () => {
    // Simulates a completely different schema with novel artifact names
    const result = parseStatusJson({
      changeId: 'pr-001',
      schemaType: 'code-review',
      artifacts: [
        { id: 'spec', status: 'ready', dependencies: [] },
        { id: 'impl', status: 'blocked', dependencies: ['spec', 'tests'] },
        { id: 'tests', status: 'done', dependencies: ['spec'] },
        { id: 'docs', status: 'optional', dependencies: ['impl'] },
      ],
    });
    expect(result).not.toBeNull();
    expect(result!.schemaType).toBe('code-review');
    expect(result!.artifacts).toHaveLength(4);

    // Verify dependencies are parsed without schema-specific knowledge
    const impl = result!.artifacts.find((a) => a.id === 'impl')!;
    expect(impl.dependencies).toEqual(['spec', 'tests']);
    expect(impl.status).toBe('blocked');

    const docs = result!.artifacts.find((a) => a.id === 'docs')!;
    expect(docs.status).toBe('optional');
  });

  it('normalizes the current CLI status JSON shape', () => {
    const result = parseStatusJson({
      changeName: 'ch-010',
      schemaName: 'chapter-draft',
      artifacts: [
        {
          id: 'brief',
          status: 'done',
          generates: 'brief.md',
          requires: [],
        },
        {
          id: 'draft',
          status: 'ready',
          generates: 'draft.md',
          requires: ['brief'],
        },
      ],
      nextStep: [{ action: 'apply', target: 'manuscript/ch-010.md' }],
      blockingIssues: [
        {
          artifactId: 'draft',
          reason: 'Waiting for review',
          missingDeps: ['wiki-diff'],
        },
      ],
      validationIssues: [
        {
          artifactId: 'draft',
          reason: 'Validation failed for draft',
          missingDeps: [],
        },
      ],
    });

    expect(result).not.toBeNull();
    expect(result!.changeId).toBe('ch-010');
    expect(result!.schemaType).toBe('chapter-draft');

    const draft = result!.artifacts.find((a) => a.id === 'draft')!;
    expect(draft.generatedFile).toBe('adab/changes/ch-010/draft.md');
    expect(draft.dependencies).toEqual(['brief']);
    expect(draft.blockingIssues).toEqual([
      'Waiting for review',
      'Missing dependencies: wiki-diff',
    ]);
    expect(draft.validations?.errors?.[0]?.message).toBe(
      'Validation failed for draft',
    );
    expect(draft.nextStep?.applyTarget).toBe('manuscript/ch-010.md');
  });
});

// ── computeLayout tests ────────────────────────────────────

describe('computeLayout', () => {
  it('returns empty positions for empty artifacts', () => {
    const { positions, svgWidth, svgHeight } = computeLayout([]);
    expect(positions).toHaveLength(0);
    expect(svgWidth).toBeGreaterThan(0);
    expect(svgHeight).toBeGreaterThan(0);
  });

  it('computes layers for a linear DAG', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'brief', status: 'done', dependencies: [] }),
      makeArtifact({ id: 'outline', status: 'done', dependencies: ['brief'] }),
      makeArtifact({ id: 'draft', status: 'ready', dependencies: ['outline'] }),
    ];

    const { positions } = computeLayout(artifacts);
    expect(positions).toHaveLength(3);

    // Find layers: brief should be above outline, outline above draft
    const brief = positions.find((p) => p.artifact.id === 'brief')!;
    const outline = positions.find((p) => p.artifact.id === 'outline')!;
    const draft = positions.find((p) => p.artifact.id === 'draft')!;

    expect(brief.y).toBeLessThan(outline.y);
    expect(outline.y).toBeLessThan(draft.y);
  });

  it('places parallel branches on the same layer', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'root', status: 'done', dependencies: [] }),
      makeArtifact({ id: 'branch-a', status: 'done', dependencies: ['root'] }),
      makeArtifact({ id: 'branch-b', status: 'ready', dependencies: ['root'] }),
    ];

    const { positions } = computeLayout(artifacts);

    const branchA = positions.find((p) => p.artifact.id === 'branch-a')!;
    const branchB = positions.find((p) => p.artifact.id === 'branch-b')!;
    const root = positions.find((p) => p.artifact.id === 'root')!;

    // Branch A and B should be on the same layer (same y)
    expect(branchA.y).toBe(branchB.y);
    // Root should be above both branches
    expect(root.y).toBeLessThan(branchA.y);
    // Branch A and B should be at different x positions
    expect(branchA.x).not.toBe(branchB.x);
  });

  it('handles multi-level parallel DAGs', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'r', status: 'done', dependencies: [] }),
      makeArtifact({ id: 'a1', status: 'done', dependencies: ['r'] }),
      makeArtifact({ id: 'a2', status: 'done', dependencies: ['r'] }),
      makeArtifact({ id: 'b1', status: 'blocked', dependencies: ['a1', 'a2'] }),
      makeArtifact({ id: 'b2', status: 'blocked', dependencies: ['a1'] }),
    ];

    const { positions } = computeLayout(artifacts);
    expect(positions).toHaveLength(5);

    const r = positions.find((p) => p.artifact.id === 'r')!;
    const a1 = positions.find((p) => p.artifact.id === 'a1')!;
    const a2 = positions.find((p) => p.artifact.id === 'a2')!;
    const b1 = positions.find((p) => p.artifact.id === 'b1')!;
    const b2 = positions.find((p) => p.artifact.id === 'b2')!;

    expect(a1.y).toBe(a2.y);
    expect(b1.y).toBe(b2.y);
    expect(r.y).toBeLessThan(a1.y);
    expect(a1.y).toBeLessThan(b1.y);
  });
});

// ── allArtifactsDone tests ─────────────────────────────────

describe('allArtifactsDone', () => {
  it('returns true when all non-optional artifacts are done', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
      makeArtifact({ id: 'b', status: 'done' }),
    ];
    expect(allArtifactsDone(artifacts)).toBe(true);
  });

  it('returns true when done + optional', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
      makeArtifact({ id: 'b', status: 'optional' }),
    ];
    expect(allArtifactsDone(artifacts)).toBe(true);
  });

  it('returns false if any artifact is ready or blocked', () => {
    expect(
      allArtifactsDone([
        makeArtifact({ id: 'a', status: 'done' }),
        makeArtifact({ id: 'b', status: 'ready' }),
      ]),
    ).toBe(false);

    expect(
      allArtifactsDone([
        makeArtifact({ id: 'a', status: 'done' }),
        makeArtifact({ id: 'b', status: 'blocked' }),
      ]),
    ).toBe(false);
  });

  it('returns false for empty array', () => {
    expect(allArtifactsDone([])).toBe(false);
  });
});

// ── hasValidationErrors tests ──────────────────────────────

describe('hasValidationErrors', () => {
  it('returns true if any artifact has validation errors', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
      makeArtifact({
        id: 'b',
        status: 'ready',
        validations: { errors: [{ message: 'Missing field' }] },
      }),
    ];
    expect(hasValidationErrors(artifacts)).toBe(true);
  });

  it('returns false if only warnings exist', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({
        id: 'a',
        status: 'done',
        validations: { warnings: [{ message: 'Consider adding tags' }] },
      }),
    ];
    expect(hasValidationErrors(artifacts)).toBe(false);
  });

  it('returns false for no validations', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
    ];
    expect(hasValidationErrors(artifacts)).toBe(false);
  });

  it('returns false for empty errors array', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({
        id: 'a',
        status: 'done',
        validations: { errors: [] },
      }),
    ];
    expect(hasValidationErrors(artifacts)).toBe(false);
  });
});

// ── isApplyReady tests ─────────────────────────────────────

describe('isApplyReady', () => {
  it('returns true when any artifact has an apply target', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
      makeArtifact({
        id: 'b',
        status: 'ready',
        nextStep: { applyTarget: 'manuscript' },
      }),
    ];
    expect(isApplyReady(artifacts)).toBe(true);
  });

  it('returns false when no artifact has an apply target', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({ id: 'a', status: 'done' }),
      makeArtifact({ id: 'b', status: 'blocked' }),
    ];
    expect(isApplyReady(artifacts)).toBe(false);
  });

  it('returns false when nextStep exists but has no applyTarget', () => {
    const artifacts: ArtifactStatus[] = [
      makeArtifact({
        id: 'a',
        status: 'ready',
        nextStep: { instruction: 'Write the draft' },
      }),
    ];
    expect(isApplyReady(artifacts)).toBe(false);
  });
});

// ── Failed status command simulation ───────────────────────

describe('failed status command handling', () => {
  it('parseStatusJson handles non-zero exit scenario gracefully', () => {
    // If the CLI exits non-zero but still produces partial JSON on stdout,
    // the parsed JSON might have empty artifacts or be malformed.
    // The parseStatusJson function should handle all edge cases.
    const result = parseStatusJson({
      artifacts: [{ id: 'partial', status: 'blocked' }],
    });
    expect(result).not.toBeNull();
    expect(result!.artifacts[0].status).toBe('blocked');
  });

  it('parseStatusJson handles status string that is not in the union', () => {
    // The CLI might produce unexpected status strings
    const result = parseStatusJson({
      artifacts: [{ id: 'unknown-state', status: 'in-progress' }],
    });
    expect(result).not.toBeNull();
    // Should be cast to the union type (will be 'in-progress' at runtime)
    // but parseStatusJson preserves whatever the CLI returns
    expect(result!.artifacts[0].status).toBe('in-progress');
  });
});
