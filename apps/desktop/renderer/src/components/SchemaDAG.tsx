/**
 * SchemaDAG — renders an artifact directed acyclic graph for a schema definition.
 *
 * Takes a SchemaDefinition's artifacts array and visualizes the dependency
 * graph as SVG nodes with directed arrows. Each node shows the artifact ID
 * and the file it generates.
 *
 * Reuses the layered graph-layout algorithm from ArtifactDAG, adapted to
 * work with SchemaArtifactDef ({id, requires, generates}).
 *
 * Handles empty, error, and loading states.
 */

import React, { useMemo } from 'react';
import type { SchemaArtifactDef } from '../types/schema.js';

interface SchemaDAGProps {
  /** The schema name for display. */
  schemaName: string;
  /** Artifact definitions from the schema. */
  artifacts: SchemaArtifactDef[];
  /** Whether the schema data is still loading. */
  loading: boolean;
  /** Error message if loading failed, or null. */
  error: string | null;
}

// ── Layout constants ──
const NODE_WIDTH = 200;
const NODE_HEIGHT = 80;
const H_GAP = 28;
const V_GAP = 44;
const PADDING = 20;
const ARROW_COLOR = '#94a3b8';
const ARROW_WIDTH = 1.5;

interface NodePos {
  artifact: SchemaArtifactDef;
  x: number;
  y: number;
}

/**
 * Minimal interface matching both ArtifactStatus and SchemaArtifactDef
 * for the layout algorithm.
 */
interface LayoutItem {
  id: string;
  dependencies: string[];
}

/**
 * Compute a layered top-to-bottom layout.
 *
 * Artifacts with no requirements go to layer 0; each dependent artifact
 * is placed one layer below the maximum layer of its requirements.
 */
function computeLayout(items: LayoutItem[]): {
  positions: NodePos[];
  svgWidth: number;
  svgHeight: number;
} {
  if (items.length === 0) {
    return { positions: [], svgWidth: PADDING * 2, svgHeight: PADDING * 2 };
  }

  const byId = new Map<string, LayoutItem>();
  for (const item of items) {
    byId.set(item.id, item);
  }

  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0;
    visited.add(id);

    const item = byId.get(id);
    const deps = item?.dependencies ?? [];
    if (deps.length === 0) {
      layers.set(id, 0);
      return 0;
    }

    let maxDepLayer = 0;
    for (const dep of deps) {
      const depLayer = assignLayer(dep);
      if (depLayer >= maxDepLayer) maxDepLayer = depLayer;
    }
    const layer = maxDepLayer + 1;
    layers.set(id, layer);
    return layer;
  }

  for (const item of items) {
    assignLayer(item.id);
  }

  const layerGroups = new Map<number, LayoutItem[]>();
  for (const item of items) {
    const l = layers.get(item.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(item);
  }

  const maxLayer = Math.max(...layers.values(), 0);

  let maxNodesInLayer = 0;
  for (const [, group] of layerGroups) {
    if (group.length > maxNodesInLayer) maxNodesInLayer = group.length;
  }

  const svgWidth =
    PADDING * 2 + maxNodesInLayer * NODE_WIDTH + (maxNodesInLayer - 1) * H_GAP;
  const svgHeight =
    PADDING * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * V_GAP;

  const positions: NodePos[] = [];
  for (const item of items) {
    const layer = layers.get(item.id) ?? 0;
    const group = layerGroups.get(layer) ?? [];
    const indexInLayer = group.indexOf(item);
    const rowWidth =
      group.length * NODE_WIDTH + (group.length - 1) * H_GAP;
    const rowStart =
      PADDING + (svgWidth - PADDING * 2 - rowWidth) / 2;

    positions.push({
      artifact: item as unknown as SchemaArtifactDef,
      x: rowStart + indexInLayer * (NODE_WIDTH + H_GAP),
      y: PADDING + layer * (NODE_HEIGHT + V_GAP),
    });
  }

  return { positions, svgWidth, svgHeight };
}

const SchemaDAG: React.FC<SchemaDAGProps> = ({
  schemaName,
  artifacts,
  loading,
  error,
}) => {
  const layoutItems: LayoutItem[] = useMemo(
    () =>
      artifacts.map((a) => ({
        id: a.id,
        dependencies: a.requires ?? [],
      })),
    [artifacts],
  );

  const { positions, svgWidth, svgHeight } = useMemo(
    () => computeLayout(layoutItems),
    [layoutItems],
  );

  const posById = useMemo(() => {
    const m = new Map<string, NodePos>();
    for (const p of positions) {
      m.set(p.artifact.id, p);
    }
    return m;
  }, [positions]);

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
          Rendering artifact graph…
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
  if (artifacts.length === 0) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 24px',
          color: '#9ca3af',
          fontSize: '0.82rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        No artifacts defined in {schemaName}.
      </div>
    );
  }

  // ── DAG ──
  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        backgroundColor: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #e5e7eb',
          fontSize: '0.7rem',
          color: '#6b7280',
          fontFamily: 'monospace',
        }}
      >
        Artifact graph for {schemaName} ({artifacts.length} artifacts)
      </div>

      <div style={{ overflow: 'auto' }}>
        <svg
          width={Math.max(svgWidth, 400)}
          height={Math.max(svgHeight, 200)}
          style={{ display: 'block' }}
        >
          <defs>
            <marker
              id="schema-arrowhead"
              markerWidth="8"
              markerHeight="6"
              refX="8"
              refY="3"
              orient="auto"
            >
              <polygon points="0 0, 8 3, 0 6" fill={ARROW_COLOR} />
            </marker>
          </defs>

          {/* Edges */}
          {artifacts.map((artifact) => {
            const deps = artifact.requires ?? [];
            return deps.map((depId) => {
              const source = posById.get(depId);
              const target = posById.get(artifact.id);
              if (!source || !target) return null;

              const x1 = source.x + NODE_WIDTH / 2;
              const y1 = source.y + NODE_HEIGHT;
              const x2 = target.x + NODE_WIDTH / 2;
              const y2 = target.y;

              const midY = (y1 + y2) / 2;
              const path =
                y2 - y1 > V_GAP
                  ? `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`
                  : `M ${x1} ${y1} L ${x2} ${y2}`;

              return (
                <path
                  key={`${depId}->${artifact.id}`}
                  d={path}
                  stroke={ARROW_COLOR}
                  strokeWidth={ARROW_WIDTH}
                  fill="none"
                  markerEnd="url(#schema-arrowhead)"
                  opacity={0.6}
                />
              );
            });
          })}

          {/* Nodes */}
          {positions.map(({ artifact, x, y }) => (
            <foreignObject
              key={artifact.id}
              x={x}
              y={y}
              width={NODE_WIDTH}
              height={NODE_HEIGHT}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                  padding: '8px 12px',
                  border: '2px solid #e2e8f0',
                  borderRadius: 8,
                  backgroundColor: '#fff',
                  minWidth: 160,
                  maxWidth: 200,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
                }}
              >
                {/* Artifact ID */}
                <span
                  style={{
                    fontSize: '0.78rem',
                    fontWeight: 700,
                    color: '#1e293b',
                    fontFamily: 'monospace',
                  }}
                >
                  {artifact.id}
                </span>

                {/* Generates file */}
                <span
                  style={{
                    fontSize: '0.62rem',
                    color: '#64748b',
                    fontFamily: 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={artifact.generates}
                >
                  → {artifact.generates}
                </span>

                {/* Required flag */}
                {artifact.required === false && (
                  <span
                    style={{
                      fontSize: '0.58rem',
                      fontWeight: 600,
                      color: '#94a3b8',
                      backgroundColor: '#f1f5f9',
                      padding: '0 4px',
                      borderRadius: 2,
                      alignSelf: 'flex-start',
                    }}
                  >
                    optional
                  </span>
                )}
              </div>
            </foreignObject>
          ))}
        </svg>
      </div>
    </div>
  );
};

export default SchemaDAG;
