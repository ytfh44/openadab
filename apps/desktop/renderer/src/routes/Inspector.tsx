/**
 * Inspector — right-side panel for inspecting the selected artifact.
 *
 * Renders a vertical stack of collapsible cards that load independently
 * via CLI commands when an artifact is selected:
 *
 * 1. ContextPackCard — context pack display (must-read, optional, excluded)
 * 2. ValidationCard — mechanical + semantic validation results
 * 3. WikiImpactCard — wiki diff impact summary
 * 4. Agent Dock — placeholder for Section 11
 *
 * Each card handles its own loading, error, empty, and no-selection states.
 * The Inspector itself only renders when projectInfo is available.
 */

import React from 'react';
import type { ProjectInfo } from '../../../shared/ipc-types.js';
import ContextPackCard from '../components/ContextPackCard.js';
import ValidationCard from '../components/ValidationCard.js';
import WikiImpactCard from '../components/WikiImpactCard.js';
import AgentStatusCard from '../components/AgentStatusCard.js';

interface InspectorProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** The change ID, or null if no artifact selected. */
  changeId: string | null;
  /** The artifact ID, or null if no artifact selected. */
  artifactId: string | null;
  /** Called when user clicks "Review" on WikiImpactCard to open WikiDiffReview. */
  onReviewWikiDiff?: () => void;
}

/**
 * Right-side inspector panel.
 *
 * Displays when projectInfo is available, alongside the ArtifactEditor.
 * Each card independently fetches its data via CLI when changeId/artifactId
 * change. The Agent Dock slot is a placeholder for Section 11.
 */
const Inspector: React.FC<InspectorProps> = ({
  projectInfo,
  changeId,
  artifactId,
  onReviewWikiDiff,
}) => {
  if (!projectInfo) {
    return null;
  }

  const projectRoot = projectInfo.projectRoot;

  return (
    <div
      style={{
        width: 320,
        minWidth: 280,
        display: 'flex',
        flexDirection: 'column',
        borderLeft: '2px solid #d1d5db',
        backgroundColor: '#f9fafb',
        overflow: 'auto',
        fontFamily: 'system-ui, sans-serif',
        flexShrink: 0,
      }}
    >
      {/* Inspector header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 12px',
          backgroundColor: '#e5e7eb',
          position: 'sticky',
          top: 0,
          zIndex: 1,
          gap: 8,
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#374151',
          }}
        >
          Inspector
        </span>
        {changeId && artifactId && (
          <span
            style={{
              fontSize: '0.62rem',
              fontFamily: 'monospace',
              color: '#6b7280',
              backgroundColor: '#f3f4f6',
              padding: '1px 6px',
              borderRadius: 3,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              maxWidth: 160,
            }}
          >
            {artifactId}
          </span>
        )}
      </div>

      {/* Scrollable card area */}
      <div
        style={{
          flex: 1,
          overflow: 'auto',
          padding: 8,
        }}
      >
        {/* 1. Context Pack */}
        <ContextPackCard
          projectRoot={projectRoot}
          changeId={changeId}
          artifactId={artifactId}
        />

        {/* 2. Validation Center */}
        <ValidationCard
          projectRoot={projectRoot}
          changeId={changeId}
          artifactId={artifactId}
        />

        {/* 3. Wiki Impact */}
        <WikiImpactCard
          projectRoot={projectRoot}
          changeId={changeId}
          onReview={onReviewWikiDiff}
        />

        {/* 4. Agent Dock — real status indicator */}
        <AgentStatusCard />
      </div>
    </div>
  );
};

export default Inspector;
