/**
 * NewChangeDialog — modal dialog for creating a new change.
 *
 * Provides a type dropdown/input and an ID text field.
 * On submit, calls `openadab new <type> <id> --json` and returns the result.
 *
 * Handles loading, error, and success states.
 */

import React, { useState, useCallback } from 'react';
import type { ProjectInfo } from '../../../shared/ipc-types.js';

interface NewChangeDialogProps {
  /** Current project info (needed for projectRoot). */
  projectInfo: ProjectInfo;
  /** Called when the user cancels or closes the dialog. */
  onClose: () => void;
  /** Called when a new change is successfully created. */
  onCreated: (changeId: string, changeType: string) => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

const NewChangeDialog: React.FC<NewChangeDialogProps> = ({
  projectInfo,
  onClose,
  onCreated,
}) => {
  const [changeType, setChangeType] = useState('chapter');
  const [changeId, setChangeId] = useState('');
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** Submit: run `openadab new <type> <id> --json`. */
  const handleCreate = useCallback(async () => {
    const trimmedType = changeType.trim();
    const trimmedId = changeId.trim();

    if (trimmedType.length === 0 || trimmedId.length === 0) {
      setError('Both type and ID are required.');
      return;
    }

    setRunning(true);
    setError(null);

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['new', trimmedType, trimmedId, '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Command was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setError(errMsg);
        return;
      }

      onCreated(trimmedId, trimmedType);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setRunning(false);
    }
  }, [changeType, changeId, projectInfo.projectRoot, onCreated]);

  /** Handle Escape key to close. */
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape' && !running) {
        onClose();
      }
      if (e.key === 'Enter' && !running) {
        handleCreate();
      }
    },
    [onClose, handleCreate, running],
  );

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: '24px 28px',
          minWidth: 380,
          maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h3
          style={{
            margin: '0 0 16px 0',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#1f2937',
          }}
        >
          Create New Change
        </h3>

        {/* Type field */}
        <div style={{ marginBottom: 12 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 4,
            }}
          >
            Type
          </label>
          <input
            type="text"
            value={changeType}
            onChange={(e) => setChangeType(e.target.value)}
            placeholder="e.g. chapter"
            disabled={running}
            style={{
              width: '100%',
              padding: '7px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: '0.82rem',
              fontFamily: 'monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* ID field */}
        <div style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 4,
            }}
          >
            ID
          </label>
          <input
            type="text"
            value={changeId}
            onChange={(e) => setChangeId(e.target.value)}
            placeholder="e.g. ch-001"
            disabled={running}
            style={{
              width: '100%',
              padding: '7px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: '0.82rem',
              fontFamily: 'monospace',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>

        {/* Error display */}
        {error && (
          <div
            style={{
              padding: '8px 10px',
              marginBottom: 12,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: '0.72rem',
              fontFamily: 'monospace',
              color: '#dc2626',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {error}
          </div>
        )}

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={running}
            style={{
              padding: '7px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: running ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={
              running ||
              changeType.trim().length === 0 ||
              changeId.trim().length === 0
            }
            style={{
              padding: '7px 16px',
              border: 'none',
              borderRadius: 4,
              backgroundColor:
                running ||
                changeType.trim().length === 0 ||
                changeId.trim().length === 0
                  ? '#9ca3af'
                  : '#16a34a',
              color: '#fff',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor:
                running ||
                changeType.trim().length === 0 ||
                changeId.trim().length === 0
                  ? 'not-allowed'
                  : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {running && (
              <span
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: '50%',
                  border: '2px solid rgba(255,255,255,0.4)',
                  borderTopColor: '#fff',
                  animation: 'spin 0.8s linear infinite',
                  display: 'inline-block',
                }}
              />
            )}
            {running ? 'Creating…' : 'Create Change'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default NewChangeDialog;
