/**
 * Project initialization dialog.
 *
 * Modal dialog for creating a new OpenAdab project.
 * Collects schema name (required), host name (optional), and project root
 * directory, then invokes `openadab init --schema <name> --host <name> --json`
 * via the CLI runner.
 *
 * Handles loading, error, and success states. On success, the caller
 * can open the newly created project.
 */

import React, { useState, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';

interface ProjectInitDialogProps {
  /** Called when the dialog is dismissed. */
  onClose: () => void;
  /** Called with the project root path after successful initialization. */
  onProjectInit: (projectRoot: string) => void;
}

/** Generate a unique command ID for each CLI invocation. */
function genCommandId(): string {
  return crypto.randomUUID();
}

const ProjectInitDialog: React.FC<ProjectInitDialogProps> = ({
  onClose,
  onProjectInit,
}) => {
  const [schemaName, setSchemaName] = useState('chapter-draft');
  const [hostName, setHostName] = useState('');
  const [projectRoot, setProjectRoot] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resultEvent, setResultEvent] = useState<CommandEvent | null>(null);

  const handleInit = useCallback(async () => {
    const trimmedRoot = projectRoot.trim();
    const trimmedSchema = schemaName.trim();
    const trimmedHost = hostName.trim();

    if (!trimmedRoot) {
      setError('Project root directory is required.');
      return;
    }
    if (!trimmedSchema) {
      setError('Schema name is required.');
      return;
    }

    setRunning(true);
    setError(null);
    setResultEvent(null);

    const args = ['init', '--schema', trimmedSchema, '--json'];
    if (trimmedHost) {
      args.push('--host', trimmedHost);
    }

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args,
        cwd: trimmedRoot,
        initiator: 'user',
      });

      setResultEvent(event);

      if (event.exitCode === 0 && !event.cancelled) {
        // Success — notify parent
        onProjectInit(trimmedRoot);
      } else if (event.cancelled) {
        setError('Initialization was cancelled.');
      } else {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setError(errMsg);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unknown error during initialization.',
      );
    } finally {
      setRunning(false);
    }
  }, [projectRoot, schemaName, hostName, onProjectInit]);

  const overlayStyle: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.4)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1000,
  };

  const dialogStyle: React.CSSProperties = {
    backgroundColor: '#fff',
    borderRadius: 8,
    boxShadow: '0 4px 24px rgba(0, 0, 0, 0.18)',
    padding: '24px 28px',
    minWidth: 420,
    maxWidth: 520,
    fontFamily: 'system-ui, sans-serif',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    padding: '8px 10px',
    border: '1px solid #d1d5db',
    borderRadius: 4,
    fontSize: '0.85rem',
    fontFamily: 'monospace',
    boxSizing: 'border-box',
    outline: 'none',
  };

  const labelStyle: React.CSSProperties = {
    display: 'block',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#374151',
    marginBottom: 4,
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={dialogStyle} onClick={(e) => e.stopPropagation()}>
        <h2
          style={{
            margin: '0 0 4px 0',
            fontSize: '1.1rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          Initialize New Project
        </h2>
        <p
          style={{
            margin: '0 0 20px 0',
            fontSize: '0.8rem',
            color: '#6b7280',
          }}
        >
          Create a new OpenAdab project with a schema-driven workflow.
        </p>

        {/* Project Root */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="init-project-root">
            Project Root Directory *
          </label>
          <input
            id="init-project-root"
            type="text"
            value={projectRoot}
            onChange={(e) => setProjectRoot(e.target.value)}
            placeholder="/path/to/my-novel"
            disabled={running}
            style={inputStyle}
          />
        </div>

        {/* Schema Name */}
        <div style={{ marginBottom: 14 }}>
          <label style={labelStyle} htmlFor="init-schema-name">
            Schema Name *
          </label>
          <input
            id="init-schema-name"
            type="text"
            value={schemaName}
            onChange={(e) => setSchemaName(e.target.value)}
            placeholder="chapter-draft"
            disabled={running}
            style={inputStyle}
          />
        </div>

        {/* Host Name */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle} htmlFor="init-host-name">
            Host Name (optional)
          </label>
          <input
            id="init-host-name"
            type="text"
            value={hostName}
            onChange={(e) => setHostName(e.target.value)}
            placeholder="opencode"
            disabled={running}
            style={inputStyle}
          />
        </div>

        {/* Error */}
        {error && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              marginBottom: 14,
              fontSize: '0.78rem',
              color: '#dc2626',
              fontFamily: 'monospace',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {error}
          </div>
        )}

        {/* Result JSON for successful init */}
        {resultEvent && resultEvent.exitCode === 0 && resultEvent.parsedJson != null && (
          <div
            style={{
              padding: '8px 12px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 4,
              marginBottom: 14,
              fontSize: '0.72rem',
              fontFamily: 'monospace',
              color: '#166534',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            <pre style={{ margin: 0 }}>
              {JSON.stringify(resultEvent.parsedJson, null, 2)}
            </pre>
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            style={{
              padding: '8px 18px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '0.82rem',
              fontWeight: 500,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleInit}
            disabled={running}
            style={{
              padding: '8px 18px',
              border: 'none',
              borderRadius: 4,
              backgroundColor: running ? '#86efac' : '#16a34a',
              color: '#fff',
              fontSize: '0.82rem',
              fontWeight: 600,
              cursor: running ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {running && (
              <span
                style={{
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  border: '2px solid #fff',
                  borderTopColor: 'transparent',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {running ? 'Initializing…' : 'Initialize'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectInitDialog;
