/**
 * ArtifactDAG — visual directed acyclic graph (DAG) of artifact nodes.
 *
 * Renders artifact status nodes in a top-to-bottom layered layout based on
 * dependency ordering. Draws directed edges (SVG arrows) from each artifact
 * to its dependents.
 *
 * Schema-generic: artifact names, statuses, dependencies, and layout are all
 * derived from the ArtifactStatus array without hardcoding any artifact IDs.
 */

import React, { useMemo } from 'react';
import type { ArtifactStatus } from '../types/changes.js';
import ArtifactNode from './ArtifactNode.js';

interface ArtifactDAGProps {
  /** All artifacts in the change, with their status and dependencies. */
  artifacts: ArtifactStatus[];
  /** Currently selected artifact ID, or null. */
  selectedArtifactId: string | null;
  /** Called when the user selects an artifact node. */
  onSelectArtifact: (artifactId: string) => void;
}

/**
 * Layout constants.
 */
const NODE_WIDTH = 220;
const NODE_HEIGHT = 110;
const H_GAP = 32;
const V_GAP = 48;
const PADDING = 24;
const ARROW_COLOR = '#94a3b8';
const ARROW_WIDTH = 1.5;

/** Position for a laid-out node. */
interface NodePos {
  artifact: ArtifactStatus;
  x: number;
  y: number;
}

/**
 * Compute a layered top-to-bottom layout.
 *
 * Artifacts are assigned to layers via topological sort: artifacts with no
 * dependencies go to layer 0, and each dependent artifact is placed one layer
 * below the maximum layer of its dependencies.
 */
export function computeLayout(artifacts: ArtifactStatus[]): {
  positions: NodePos[];
  svgWidth: number;
  svgHeight: number;
} {
  if (artifacts.length === 0) {
    return { positions: [], svgWidth: PADDING * 2, svgHeight: PADDING * 2 };
  }

  // Build lookup and adjacency
  const byId = new Map<string, ArtifactStatus>();
  for (const a of artifacts) {
    byId.set(a.id, a);
  }

  // Compute layers via iterative longest-path from roots
  const layers = new Map<string, number>();
  const visited = new Set<string>();

  function assignLayer(id: string): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);

    const artifact = byId.get(id);
    const deps = artifact?.dependencies ?? [];
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

  for (const a of artifacts) {
    assignLayer(a.id);
  }

  // Group by layer
  const layerGroups = new Map<number, ArtifactStatus[]>();
  for (const a of artifacts) {
    const l = layers.get(a.id) ?? 0;
    if (!layerGroups.has(l)) layerGroups.set(l, []);
    layerGroups.get(l)!.push(a);
  }

  const maxLayer = Math.max(...layers.values(), 0);

  // Calculate width: max nodes in any layer
  let maxNodesInLayer = 0;
  for (const [, group] of layerGroups) {
    if (group.length > maxNodesInLayer) maxNodesInLayer = group.length;
  }

  const svgWidth = PADDING * 2 + maxNodesInLayer * NODE_WIDTH + (maxNodesInLayer - 1) * H_GAP;
  const svgHeight = PADDING * 2 + (maxLayer + 1) * NODE_HEIGHT + maxLayer * V_GAP;

  // Position nodes
  const positions: NodePos[] = [];
  for (const a of artifacts) {
    const layer = layers.get(a.id) ?? 0;
    const group = layerGroups.get(layer) ?? [];
    const indexInLayer = group.indexOf(a);

    // Center the layer row
    const rowWidth = group.length * NODE_WIDTH + (group.length - 1) * H_GAP;
    const rowStart = PADDING + (svgWidth - PADDING * 2 - rowWidth) / 2;

    positions.push({
      artifact: a,
      x: rowStart + indexInLayer * (NODE_WIDTH + H_GAP),
      y: PADDING + layer * (NODE_HEIGHT + V_GAP),
    });
  }

  return { positions, svgWidth, svgHeight };
}

const ArtifactDAG: React.FC<ArtifactDAGProps> = ({
  artifacts,
  selectedArtifactId,
  onSelectArtifact,
}) => {
  const { positions, svgWidth, svgHeight } = useMemo(
    () => computeLayout(artifacts),
    [artifacts],
  );

  // Build quick lookup for positions
  const posById = useMemo(() => {
    const m = new Map<string, NodePos>();
    for (const p of positions) {
      m.set(p.artifact.id, p);
    }
    return m;
  }, [positions]);

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
        No artifacts to display.
      </div>
    );
  }

  return (
    <div
      style={{
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        backgroundColor: '#fafafa',
      }}
    >
      <svg
        width={Math.max(svgWidth, 400)}
        height={Math.max(svgHeight, 200)}
        style={{ display: 'block' }}
      >
        {/* Gradient definitions for arrows */}
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill={ARROW_COLOR} />
          </marker>
        </defs>

        {/* Edges: for each artifact, draw an arrow to each dependent */}
        {artifacts.map((artifact) => {
          const deps = artifact.dependencies ?? [];
          return deps.map((depId) => {
            const source = posById.get(depId);
            const target = posById.get(artifact.id);
            if (!source || !target) return null;

            // From bottom-center of source to top-center of target
            const x1 = source.x + NODE_WIDTH / 2;
            const y1 = source.y + NODE_HEIGHT;
            const x2 = target.x + NODE_WIDTH / 2;
            const y2 = target.y;

            // Use a curved path for visual clarity
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
                markerEnd="url(#arrowhead)"
                opacity={0.6}
              />
            );
          });
        })}

        {/* Nodes: placed as foreignObject to embed HTML */}
        {positions.map(({ artifact, x, y }) => (
          <foreignObject
            key={artifact.id}
            x={x}
            y={y}
            width={NODE_WIDTH}
            height={NODE_HEIGHT}
          >
            <ArtifactNode
              artifact={artifact}
              isSelected={selectedArtifactId === artifact.id}
              onSelect={onSelectArtifact}
            />
          </foreignObject>
        ))}
      </svg>
    </div>
  );
};

export default ArtifactDAG;
