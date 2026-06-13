/**
 * ArtifactInstructions — displays instructions for the current artifact.
 *
 * Fetches instructions from `openadab instructions <artifact> --change <id>
 * --json --inline-deps` and renders them in a scrollable panel.
 *
 * Handles loading, empty, error, and no-project states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';

interface ArtifactInstructionsProps {
  /** The project root directory. */
  projectRoot: string | null;
  /** The change ID. */
  changeId: string | null;
  /** The artifact ID. */
  artifactId: string | null;
  /** If true, the instructions are collapsed by default. */
  collapsed?: boolean;
  /** Called after instructions are loaded with raw JSON. */
  onInstructionsLoaded?: (instructions: unknown) => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/**
 * Fetch and display artifact instructions.
 *
 * Uses `window.openadab.runCli()` to run the instructions command.
 * Shows a collapsible panel with the raw instruction text or parsed JSON.
 */
const ArtifactInstructions: React.FC<ArtifactInstructionsProps> = ({
  projectRoot,
  changeId,
  artifactId,
  collapsed: initialCollapsed = true,
  onInstructionsLoaded,
}) => {
  const [instructions, setInstructions] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isCollapsed, setIsCollapsed] = useState(initialCollapsed);

  const fetchInstructions = useCallback(async () => {
    if (!projectRoot || !changeId || !artifactId) return;

    setLoading(true);
    setError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: [
          'instructions',
          artifactId,
          '--change',
          changeId,
          '--json',
          '--inline-deps',
        ],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Instructions fetch was cancelled.');
        setInstructions(null);
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setError(errMsg);
        setInstructions(null);
        return;
      }

      const parsed = event.parsedJson;
      setInstructions(parsed);
      setError(null);
      onInstructionsLoaded?.(parsed);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unknown error fetching instructions.',
      );
      setInstructions(null);
    } finally {
      setLoading(false);
    }
  }, [projectRoot, changeId, artifactId, onInstructionsLoaded]);

  // Auto-fetch when artifact changes
  useEffect(() => {
    if (projectRoot && changeId && artifactId) {
      fetchInstructions();
    } else {
      setInstructions(null);
      setError(null);
    }
  }, [projectRoot, changeId, artifactId, fetchInstructions]);

  if (!projectRoot || !changeId || !artifactId) {
    return null;
  }

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        backgroundColor: '#fafafa',
        marginTop: 10,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsCollapsed((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setIsCollapsed((p) => !p);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isCollapsed ? '#fafafa' : '#eff6ff',
          borderRadius: isCollapsed ? 6 : '6px 6px 0 0',
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>
          {isCollapsed ? '📋' : '📖'}
        </span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#1d4ed8',
          }}
        >
          Artifact Instructions
        </span>
        {loading && (
          <span
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '2px solid #d1d5db',
              borderTopColor: '#3b82f6',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
        )}
        {error && (
          <span style={{ fontSize: '0.65rem', color: '#dc2626' }}>
            Error
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.7rem',
            color: '#9ca3af',
          }}
        >
          {isCollapsed ? '▶' : '▼'}
        </span>
      </div>

      {/* Content */}
      {!isCollapsed && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            maxHeight: 350,
            overflow: 'auto',
          }}
        >
          {loading && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '0.78rem',
              }}
            >
              Loading instructions…
            </div>
          )}

          {error && (
            <div
              style={{
                padding: 12,
                backgroundColor: '#fef2f2',
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

          {!loading && !error && instructions != null && (
            <pre
              style={{
                margin: 0,
                padding: 12,
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: '#374151',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                lineHeight: 1.5,
              }}
            >
              {typeof instructions === 'string'
                ? instructions
                : JSON.stringify(instructions, null, 2)}
            </pre>
          )}

          {!loading && !error && instructions == null && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.78rem',
              }}
            >
              No instructions available for this artifact.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ArtifactInstructions;
