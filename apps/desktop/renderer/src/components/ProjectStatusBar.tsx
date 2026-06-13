/**
 * Top status bar for the Project Dashboard.
 *
 * Displays key project identifiers: title, language, active schema, host,
 * and project root path. Always visible when a project is open.
 *
 * Handles three states: project loaded, no project, and loading.
 */

import type React from 'react';
import type { ProjectInfo } from '../../../shared/ipc-types.js';

interface ProjectStatusBarProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether the project info is still loading. */
  loading: boolean;
}

/** A single metadata pill in the status bar. */
const MetaPill: React.FC<{
  label: string;
  value: string;
  color?: string;
}> = ({ label, value, color = '#374151' }) => (
  <span
    style={{
      display: 'inline-flex',
      alignItems: 'center',
      gap: 4,
      fontSize: '0.75rem',
    }}
  >
    <span style={{ color: '#9ca3af', fontWeight: 500 }}>{label}:</span>
    <span style={{ color, fontWeight: 600 }}>{value}</span>
  </span>
);

/** Divider between status bar sections. */
const Divider: React.FC = () => (
  <span
    style={{
      width: 1,
      height: 16,
      backgroundColor: '#d1d5db',
      margin: '0 8px',
    }}
  />
);

const ProjectStatusBar: React.FC<ProjectStatusBarProps> = ({
  projectInfo,
  loading,
}) => {
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 16px',
          backgroundColor: '#f3f4f6',
          borderBottom: '1px solid #e5e7eb',
          fontFamily: 'system-ui, sans-serif',
          gap: 8,
        }}
      >
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: '50%',
            border: '2px solid #9ca3af',
            borderTopColor: 'transparent',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '0.75rem', color: '#9ca3af' }}>
          Loading project info…
        </span>
      </div>
    );
  }

  if (!projectInfo) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          padding: '6px 16px',
          backgroundColor: '#fef3c7',
          borderBottom: '1px solid #fcd34d',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ fontSize: '0.75rem', color: '#92400e' }}>
          No project open — select or create one
        </span>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        padding: '6px 16px',
        backgroundColor: '#f0fdf4',
        borderBottom: '1px solid #bbf7d0',
        fontFamily: 'system-ui, sans-serif',
        gap: 4,
        minHeight: 32,
      }}
    >
      <span
        style={{
          fontSize: '0.8rem',
          fontWeight: 700,
          color: '#166534',
          marginRight: 8,
        }}
      >
        {projectInfo.title ?? 'Untitled Project'}
      </span>

      <Divider />

      {projectInfo.language && (
        <>
          <MetaPill
            label="Language"
            value={projectInfo.language}
            color="#4a90d9"
          />
          <Divider />
        </>
      )}

      {projectInfo.activeSchema && (
        <>
          <MetaPill
            label="Schema"
            value={projectInfo.activeSchema}
            color="#7b4fbf"
          />
          <Divider />
        </>
      )}

      {projectInfo.host && (
        <>
          <MetaPill label="Host" value={projectInfo.host} color="#d97706" />
          <Divider />
        </>
      )}

      <MetaPill
        label="Root"
        value={projectInfo.projectRoot}
        color="#6b7280"
      />
    </div>
  );
};

export default ProjectStatusBar;
