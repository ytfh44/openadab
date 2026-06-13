/**
 * SchemaDiffView — side-by-side comparison of two schema artifact sets.
 *
 * Compares a forked schema's artifact definitions against the base schema's
 * artifacts. Highlights:
 *   - Added artifacts (present in fork, absent in base)
 *   - Removed artifacts (present in base, absent in fork)
 *   - Changed artifacts (same ID, different `generates` or `requires`)
 *   - Unchanged artifacts
 *
 * Handles loading, empty, and error states.
 */

import React, { useMemo } from 'react';
import type { SchemaArtifactDef } from '../types/schema.js';

interface SchemaDiffViewProps {
  /** Name of the base schema. */
  baseName: string;
  /** Name of the forked schema. */
  forkName: string;
  /** Artifacts from the base schema. */
  baseArtifacts: SchemaArtifactDef[];
  /** Artifacts from the forked schema. */
  forkArtifacts: SchemaArtifactDef[];
  /** Whether the fork data is still loading. */
  loading: boolean;
  /** Error message if loading failed, or null. */
  error: string | null;
}

/** Result of comparing two artifact definitions. */
type DiffEntryType = 'added' | 'removed' | 'changed' | 'same';

interface DiffEntry {
  type: DiffEntryType;
  id: string;
  generatesBase?: string;
  generatesFork?: string;
  requiresBase?: string[];
  requiresFork?: string[];
}

const TYPE_COLORS: Record<DiffEntryType, { bg: string; border: string; text: string; label: string }> = {
  added: { bg: '#f0fdf4', border: '#bbf7d0', text: '#166534', label: 'added' },
  removed: { bg: '#fef2f2', border: '#fecaca', text: '#991b1b', label: 'removed' },
  changed: { bg: '#fffbeb', border: '#fde68a', text: '#92400e', label: 'changed' },
  same: { bg: '#f9fafb', border: '#e5e7eb', text: '#6b7280', label: 'same' },
};

/**
 * Compute a diff between two sets of artifact definitions.
 */
function computeSchemaDiff(
  base: SchemaArtifactDef[],
  fork: SchemaArtifactDef[],
): DiffEntry[] {
  const baseById = new Map<string, SchemaArtifactDef>();
  for (const a of base) baseById.set(a.id, a);

  const forkById = new Map<string, SchemaArtifactDef>();
  for (const a of fork) forkById.set(a.id, a);

  const allIds = new Set([...baseById.keys(), ...forkById.keys()]);
  const entries: DiffEntry[] = [];

  for (const id of allIds) {
    const b = baseById.get(id);
    const f = forkById.get(id);

    if (!b && f) {
      entries.push({ type: 'added', id, generatesFork: f.generates, requiresFork: f.requires });
    } else if (b && !f) {
      entries.push({ type: 'removed', id, generatesBase: b.generates, requiresBase: b.requires });
    } else if (b && f) {
      const generatesChanged = b.generates !== f.generates;
      const requiresChanged =
        JSON.stringify([...(b.requires ?? [])].sort()) !==
        JSON.stringify([...(f.requires ?? [])].sort());

      if (generatesChanged || requiresChanged) {
        entries.push({
          type: 'changed',
          id,
          generatesBase: b.generates,
          generatesFork: f.generates,
          requiresBase: b.requires,
          requiresFork: f.requires,
        });
      } else {
        entries.push({ type: 'same', id, generatesBase: b.generates, requiresBase: b.requires });
      }
    }
  }

  return entries;
}

const SchemaDiffView: React.FC<SchemaDiffViewProps> = ({
  baseName,
  forkName,
  baseArtifacts,
  forkArtifacts,
  loading,
  error,
}) => {
  const diffEntries = useMemo(
    () => computeSchemaDiff(baseArtifacts, forkArtifacts),
    [baseArtifacts, forkArtifacts],
  );

  const addedCount = diffEntries.filter((e) => e.type === 'added').length;
  const removedCount = diffEntries.filter((e) => e.type === 'removed').length;
  const changedCount = diffEntries.filter((e) => e.type === 'changed').length;

  // ── Loading state ──
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          gap: 8,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: '2px solid #d1d5db',
            borderTopColor: '#3b82f6',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '0.82rem', color: '#6b7280' }}>
          Computing diff…
        </span>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div
        style={{
          padding: '12px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
          fontSize: '0.72rem',
          fontFamily: 'monospace',
          color: '#dc2626',
          whiteSpace: 'pre-wrap',
        }}
      >
        {error}
      </div>
    );
  }

  // ── Empty state ──
  if (baseArtifacts.length === 0 && forkArtifacts.length === 0) {
    return (
      <div
        style={{
          padding: '24px',
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '0.82rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        No artifacts to compare. Both schemas are empty.
      </div>
    );
  }

  // ── Summary bar ──
  const summary = [
    diffEntries.length > 0 && `${diffEntries.length} artifacts compared`,
    addedCount > 0 && `${addedCount} added`,
    removedCount > 0 && `${removedCount} removed`,
    changedCount > 0 && `${changedCount} changed`,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Summary */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '6px 12px',
          fontSize: '0.7rem',
          color: '#6b7280',
          backgroundColor: '#f9fafb',
          borderBottom: '1px solid #e5e7eb',
        }}
      >
        <span>
          {baseName} → {forkName}
        </span>
        <span style={{ marginLeft: 'auto' }}>{summary}</span>
      </div>

      {/* Diff entries */}
      <div style={{ maxHeight: 400, overflow: 'auto' }}>
        {diffEntries.map((entry) => {
          const colors = TYPE_COLORS[entry.type];

          return (
            <div
              key={entry.id}
              style={{
                padding: '8px 12px',
                borderBottom: '1px solid #f3f4f6',
                backgroundColor: colors.bg,
                borderLeft: `4px solid ${colors.border}`,
              }}
            >
              {/* Header row */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    fontFamily: 'monospace',
                    color: '#1f2937',
                  }}
                >
                  {entry.id}
                </span>
                <span
                  style={{
                    fontSize: '0.6rem',
                    fontWeight: 700,
                    color: colors.text,
                    backgroundColor: colors.border,
                    padding: '0 5px',
                    borderRadius: 3,
                    textTransform: 'uppercase',
                    letterSpacing: '0.04em',
                  }}
                >
                  {colors.label}
                </span>
              </div>

              {/* Details */}
              {entry.type === 'added' && (
                <div style={{ fontSize: '0.68rem', color: '#374151' }}>
                  Generates: <span style={{ fontFamily: 'monospace', color: '#166534' }}>{entry.generatesFork}</span>
                </div>
              )}

              {entry.type === 'removed' && (
                <div style={{ fontSize: '0.68rem', color: '#374151' }}>
                  Was generating: <span style={{ fontFamily: 'monospace', color: '#991b1b', textDecoration: 'line-through' }}>{entry.generatesBase}</span>
                </div>
              )}

              {entry.type === 'changed' && (
                <div style={{ display: 'flex', gap: 16 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        color: '#6b7280',
                        marginBottom: 2,
                      }}
                    >
                      Base ({baseName})
                    </div>
                    <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#991b1b' }}>
                      generates: {entry.generatesBase}
                    </div>
                    {(entry.requiresBase?.length ?? 0) > 0 && (
                      <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#991b1b' }}>
                        requires: [{entry.requiresBase!.join(', ')}]
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        color: '#6b7280',
                        marginBottom: 2,
                      }}
                    >
                      Fork ({forkName})
                    </div>
                    <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#166534' }}>
                      generates: {entry.generatesFork}
                    </div>
                    {(entry.requiresFork?.length ?? 0) > 0 && (
                      <div style={{ fontSize: '0.65rem', fontFamily: 'monospace', color: '#166534' }}>
                        requires: [{entry.requiresFork!.join(', ')}]
                      </div>
                    )}
                  </div>
                </div>
              )}

              {entry.type === 'same' && (
                <div style={{ fontSize: '0.68rem', color: '#6b7280' }}>
                  generates: <span style={{ fontFamily: 'monospace' }}>{entry.generatesBase}</span>
                  {(entry.requiresBase?.length ?? 0) > 0 && (
                    <span>
                      {' · '}requires: <span style={{ fontFamily: 'monospace' }}>[{entry.requiresBase!.join(', ')}]</span>
                    </span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default SchemaDiffView;
