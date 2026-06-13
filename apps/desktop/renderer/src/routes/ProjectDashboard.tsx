/**
 * Project Dashboard — main route for the project workbench.
 *
 * Composes the top status bar, config editor, recent log panel,
 * and wiki health cards into a unified project overview.
 *
 * Provides project initialization (via dialog) and update flows
 * using the `openadab` CLI.
 *
 * Handles empty, loading, missing-project, invalid config,
 * and command-failure states for all sub-panels.
 */

import React, { useState, useCallback } from 'react';
import type { ProjectInfo } from '../../../shared/ipc-types.js';
import ProjectStatusBar from '../components/ProjectStatusBar.js';
import ProjectInitDialog from '../components/ProjectInitDialog.js';
import ConfigEditor from '../components/ConfigEditor.js';
import LogPanel from '../components/LogPanel.js';
import HealthCards from '../components/HealthCards.js';

interface ProjectDashboardProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether the project info is still loading. */
  loading: boolean;
  /** Called when project info should be re-fetched. */
  onRefresh: () => void;
  /** Called when a new project is initialized and should be opened. */
  onProjectInit: (projectRoot: string) => void;
  /** Called when the user wants to open an existing project. */
  onOpenExisting: () => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

const ProjectDashboard: React.FC<ProjectDashboardProps> = ({
  projectInfo,
  loading,
  onRefresh,
  onProjectInit,
  onOpenExisting,
}) => {
  const [showInitDialog, setShowInitDialog] = useState(false);
  const [updateRunning, setUpdateRunning] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<string | null>(null);

  /** Run `openadab update --schemas --json`. */
  const handleUpdate = useCallback(async () => {
    if (!projectInfo) return;

    setUpdateRunning(true);
    setUpdateError(null);
    setUpdateResult(null);

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['update', '--schemas', '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setUpdateError('Update was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setUpdateError(errMsg);
        return;
      }

      if (event.parsedJson !== undefined) {
        setUpdateResult(JSON.stringify(event.parsedJson, null, 2));
      } else {
        setUpdateResult(event.stdout.trim() || 'Update completed.');
      }

      onRefresh();
    } catch (e) {
      setUpdateError(
        e instanceof Error ? e.message : 'Unknown error during update.',
      );
    } finally {
      setUpdateRunning(false);
    }
  }, [projectInfo, onRefresh]);

  /** Called when init dialog completes successfully. */
  const handleInitComplete = useCallback(
    (projectRoot: string) => {
      setShowInitDialog(false);
      onProjectInit(projectRoot);
    },
    [onProjectInit],
  );

  // ── Loading state (initial app load) ──
  if (loading) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <ProjectStatusBar projectInfo={null} loading={true} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 16,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '3px solid #d1d5db',
              borderTopColor: '#3b82f6',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Loading project workspace…
          </span>
        </div>
      </div>
    );
  }

  // ── No project open ──
  if (!projectInfo) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <ProjectStatusBar projectInfo={null} loading={false} />
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 20,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              color: '#9ca3af',
            }}
          >
            📂
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: '#374151',
            }}
          >
            No Project Open
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#6b7280',
              textAlign: 'center',
              maxWidth: 360,
            }}
          >
            Select an existing OpenAdab project or create a new one to get
            started.
          </p>
          <div style={{ display: 'flex', gap: 12 }}>
            <button
              type="button"
              onClick={onOpenExisting}
              style={{
                padding: '10px 22px',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                backgroundColor: '#fff',
                color: '#374151',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Open Existing
            </button>
            <button
              type="button"
              onClick={() => setShowInitDialog(true)}
              style={{
                padding: '10px 22px',
                border: 'none',
                borderRadius: 6,
                backgroundColor: '#16a34a',
                color: '#fff',
                fontSize: '0.85rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Create New Project
            </button>
          </div>

          {showInitDialog && (
            <ProjectInitDialog
              onClose={() => setShowInitDialog(false)}
              onProjectInit={handleInitComplete}
            />
          )}
        </div>
      </div>
    );
  }

  // ── Project loaded ──
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      <ProjectStatusBar projectInfo={projectInfo} loading={false} />

      {/* Actions bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fafafa',
        }}
      >
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#374151',
            marginRight: 'auto',
          }}
        >
          Project Workbench
        </span>

        {/* Update button */}
        <button
          type="button"
          onClick={handleUpdate}
          disabled={updateRunning}
          style={{
            padding: '6px 14px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: updateRunning ? '#f3f4f6' : '#fff',
            color: '#374151',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: updateRunning ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
          }}
        >
          {updateRunning && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '2px solid #9ca3af',
                borderTopColor: 'transparent',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
          )}
          {updateRunning ? 'Updating…' : 'Update Schemas'}
        </button>

        {/* Refresh button */}
        <button
          type="button"
          onClick={onRefresh}
          style={{
            padding: '6px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.75rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          ↻ Refresh
        </button>

        {/* Init new */}
        <button
          type="button"
          onClick={() => setShowInitDialog(true)}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 4,
            backgroundColor: '#16a34a',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + New Project
        </button>
      </div>

      {/* Update error */}
      {updateError && (
        <div
          style={{
            margin: '8px 16px',
            padding: '8px 12px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: '#dc2626',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          Update failed: {updateError}
        </div>
      )}

      {/* Update result */}
      {updateResult && !updateError && (
        <div
          style={{
            margin: '8px 16px',
            padding: '8px 12px',
            backgroundColor: '#f0fdf4',
            border: '1px solid #bbf7d0',
            borderRadius: 4,
            fontSize: '0.72rem',
            fontFamily: 'monospace',
            color: '#166534',
            maxHeight: 140,
            overflow: 'auto',
          }}
        >
          <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>
            {updateResult}
          </pre>
        </div>
      )}

      {/* Dashboard grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          padding: 16,
        }}
      >
        <ConfigEditor
          projectInfo={projectInfo}
          onConfigChanged={onRefresh}
        />
        <LogPanel projectRoot={projectInfo.projectRoot} />
      </div>

      <div style={{ padding: '0 16px 16px 16px' }}>
        <HealthCards projectRoot={projectInfo.projectRoot} />
      </div>

      {/* Init dialog */}
      {showInitDialog && (
        <ProjectInitDialog
          onClose={() => setShowInitDialog(false)}
          onProjectInit={handleInitComplete}
        />
      )}
    </div>
  );
};

export default ProjectDashboard;
