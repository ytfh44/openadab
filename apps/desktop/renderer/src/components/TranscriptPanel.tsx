/**
 * CLI Transcript bottom panel component.
 *
 * Displays a scrollable list of executed CLI commands.
 * Each row shows the command string, initiator, exit code, and duration.
 * Clicking a row expands it to reveal stdout, stderr, parsed JSON view,
 * and any parse errors.
 *
 * Subscribes to `event:command-output` and `event:command-complete` IPC
 * events for live updates, and loads initial history via
 * `window.openadab.getTranscriptEvents()`.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';

/** Color mapping per initiator type. */
const INITIATOR_COLORS: Record<CommandEvent['initiator'], string> = {
  user: '#4a90d9',
  agent: '#7b4fbf',
  'auto-refresh': '#6b7280',
};

/** Background tint per initiator (hover states). */
const INITIATOR_BG: Record<CommandEvent['initiator'], string> = {
  user: '#e8f0fe',
  agent: '#f3e8ff',
  'auto-refresh': '#f3f4f6',
};

/** Format a duration in ms to a human-readable string. */
function formatDuration(start: string, end?: string): string {
  if (!end) return 'running…';
  const ms =
    new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return '0ms';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Human-readable initiator label. */
function initiatorLabel(i: CommandEvent['initiator']): string {
  switch (i) {
    case 'user':
      return 'You';
    case 'agent':
      return 'Agent';
    case 'auto-refresh':
      return 'Auto';
    default: {
      const _exhaust: never = i;
      return _exhaust;
    }
  }
}

/** Stringify JSON for display with basic formatting. */
function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

interface TranscriptRowProps {
  event: CommandEvent;
  isExpanded: boolean;
  onToggle: () => void;
}

/** Single transcript row — summary line + expandable detail. */
const TranscriptRow: React.FC<TranscriptRowProps> = ({
  event,
  isExpanded,
  onToggle,
}) => {
  const color = INITIATOR_COLORS[event.initiator];
  const bg = INITIATOR_BG[event.initiator];
  const duration = formatDuration(event.startedAt, event.endedAt);
  const exitLabel =
    event.cancelled
      ? 'CANCELLED'
      : event.exitCode === undefined
        ? '…'
        : String(event.exitCode);
  const exitStyle: React.CSSProperties = {
    padding: '1px 6px',
    borderRadius: 3,
    fontSize: '0.75rem',
    fontWeight: 600,
    color: '#fff',
    backgroundColor:
      event.cancelled
        ? '#d97706'
        : event.exitCode === 0
          ? '#16a34a'
          : event.exitCode === undefined
            ? '#6b7280'
            : '#dc2626',
  };

  return (
    <div
      style={{
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: isExpanded ? bg : undefined,
      }}
    >
      {/* Summary row */}
      <div
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') onToggle();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          cursor: 'pointer',
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          userSelect: 'none',
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: color,
            flexShrink: 0,
          }}
        />
        <span
          style={{
            fontSize: '0.7rem',
            fontWeight: 600,
            color,
            minWidth: 32,
          }}
        >
          {initiatorLabel(event.initiator)}
        </span>
        <span style={{ flex: 1, color: '#374151' }}>
          openadab {event.args.join(' ')}
        </span>
        <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>
          {duration}
        </span>
        <span style={exitStyle}>{exitLabel}</span>
        <span style={{ color: '#9ca3af', fontSize: '0.7rem' }}>
          {isExpanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div style={{ padding: '8px 12px 12px 44px', fontSize: '0.78rem' }}>
          {/* Metadata */}
          <div
            style={{
              display: 'flex',
              gap: 16,
              marginBottom: 8,
              color: '#6b7280',
              fontSize: '0.7rem',
            }}
          >
            <span>ID: {event.id}</span>
            <span>cwd: {event.cwd || '—'}</span>
            <span>
              Started: {new Date(event.startedAt).toLocaleTimeString()}
            </span>
            {event.endedAt && (
              <span>
                Ended: {new Date(event.endedAt).toLocaleTimeString()}
              </span>
            )}
            {event.cancelled && (
              <span style={{ color: '#d97706', fontWeight: 600 }}>
                ⚠ Cancelled
              </span>
            )}
          </div>

          {/* Parsed JSON */}
          {event.parsedJson !== undefined && (
            <details open style={{ marginBottom: 8 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#16a34a',
                }}
              >
                JSON Output ✓
              </summary>
              <pre
                style={{
                  margin: '4px 0 0 0',
                  padding: 8,
                  backgroundColor: '#f0fdf4',
                  border: '1px solid #bbf7d0',
                  borderRadius: 4,
                  maxHeight: 300,
                  overflow: 'auto',
                  fontSize: '0.72rem',
                }}
              >
                {prettyJson(event.parsedJson)}
              </pre>
            </details>
          )}

          {/* Parse error */}
          {event.parseError && (
            <details open style={{ marginBottom: 8 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#dc2626',
                }}
              >
                JSON Parse Error ✗
              </summary>
              <pre
                style={{
                  margin: '4px 0 0 0',
                  padding: 8,
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 4,
                  fontSize: '0.72rem',
                  color: '#dc2626',
                }}
              >
                {event.parseError}
              </pre>
            </details>
          )}

          {/* Stdout */}
          {event.stdout.trim().length > 0 && (
            <details style={{ marginBottom: 8 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#374151',
                }}
              >
                stdout ({event.stdout.split('\n').length} lines)
              </summary>
              <pre
                style={{
                  margin: '4px 0 0 0',
                  padding: 8,
                  backgroundColor: '#f9fafb',
                  border: '1px solid #d1d5db',
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: 'auto',
                  fontSize: '0.72rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                }}
              >
                {event.stdout}
              </pre>
            </details>
          )}

          {/* Stderr */}
          {event.stderr.trim().length > 0 && (
            <details open style={{ marginBottom: 8 }}>
              <summary
                style={{
                  cursor: 'pointer',
                  fontWeight: 600,
                  color: '#dc2626',
                }}
              >
                stderr
              </summary>
              <pre
                style={{
                  margin: '4px 0 0 0',
                  padding: 8,
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 4,
                  maxHeight: 200,
                  overflow: 'auto',
                  fontSize: '0.72rem',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  color: '#991b1b',
                }}
              >
                {event.stderr}
              </pre>
            </details>
          )}
        </div>
      )}
    </div>
  );
};

/** Props for the TranscriptPanel container. */
interface TranscriptPanelProps {
  /** Maximum height of the transcript panel (CSS value). */
  maxHeight?: string;
  /** If provided, only show events from this initiator. */
  filterInitiator?: CommandEvent['initiator'];
  /** Maximum number of events to display. */
  limit?: number;
}

/**
 * Bottom panel that renders the CLI transcript.
 *
 * Loads initial history from the main process via `getTranscriptEvents()`,
 * then subscribes to real-time `event:command-output` and
 * `event:command-complete` IPC events for live streaming and completion.
 */
const TranscriptPanel: React.FC<TranscriptPanelProps> = ({
  maxHeight = '300px',
  filterInitiator,
  limit,
}) => {
  const [events, setEvents] = useState<CommandEvent[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [streamingOutput, setStreamingOutput] = useState<
    Map<string, { stdout: string; stderr: string }>
  >(new Map());
  const panelRef = useRef<HTMLDivElement>(null);

  // Load initial events
  useEffect(() => {
    let mounted = true;
    window.openadab
      .getTranscriptEvents({ limit, initiator: filterInitiator })
      .then((initial) => {
        if (mounted) setEvents(initial);
      })
      .catch(() => {
        // Preload API may not be ready yet
      });
    return () => {
      mounted = false;
    };
  }, [filterInitiator, limit]);

  // Subscribe to streaming output
  useEffect(() => {
    const unsubOutput = window.openadab.onCommandOutput((output) => {
      setStreamingOutput((prev) => {
        const next = new Map(prev);
        const current = next.get(output.commandId) ?? {
          stdout: '',
          stderr: '',
        };
        next.set(output.commandId, {
          stdout:
            output.stream === 'stdout'
              ? current.stdout + output.chunk
              : current.stdout,
          stderr:
            output.stream === 'stderr'
              ? current.stderr + output.chunk
              : current.stderr,
        });
        return next;
      });
    });

    const unsubComplete = window.openadab.onCommandComplete((event) => {
      setEvents((prev) => {
        const idx = prev.findIndex((e) => e.id === event.id);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = event;
          return updated;
        }
        return [...prev, event];
      });
      // Clear streaming buffer for this command
      setStreamingOutput((prev) => {
        const next = new Map(prev);
        next.delete(event.id);
        return next;
      });
    });

    return () => {
      unsubOutput();
      unsubComplete();
    };
  }, []);

  // Auto-scroll to bottom when new events arrive
  useEffect(() => {
    if (panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight;
    }
  }, [events.length]);

  const toggle = useCallback((id: string) => {
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // Filter in-memory (backup in case server-side filter returned everything)
  const filtered = filterInitiator
    ? events.filter((e) => e.initiator === filterInitiator)
    : events;

  return (
    <div
      ref={panelRef}
      style={{
        maxHeight,
        overflow: 'auto',
        borderTop: '2px solid #d1d5db',
        backgroundColor: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 12px',
          backgroundColor: '#e5e7eb',
          position: 'sticky',
          top: 0,
          zIndex: 1,
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#374151',
          }}
        >
          CLI Transcript ({filtered.length})
        </span>
        <div style={{ display: 'flex', gap: 8, fontSize: '0.65rem' }}>
          <span style={{ color: INITIATOR_COLORS.user }}>● You</span>
          <span style={{ color: INITIATOR_COLORS.agent }}>● Agent</span>
          <span style={{ color: INITIATOR_COLORS['auto-refresh'] }}>
            ● Auto
          </span>
        </div>
      </div>

      {filtered.length === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.8rem',
          }}
        >
          No commands run yet. Open a project to get started.
        </div>
      )}

      {/* Running commands (streaming) */}
      {Array.from(streamingOutput.entries()).map(([cmdId, output]) => {
        // Find the event for this running command
        const running = events.find((e) => e.id === cmdId);
        if (!running) return null;
        return (
          <div
            key={cmdId}
            style={{
              borderBottom: '1px solid #fde68a',
              backgroundColor: '#fffbeb',
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                fontSize: '0.8rem',
                fontFamily: 'monospace',
              }}
            >
              <span
                style={{
                  animation: 'spin 1s linear infinite',
                  fontSize: '0.7rem',
                }}
              >
                ⏳
              </span>
              <span style={{ flex: 1, color: '#92400e' }}>
                openadab {running.args.join(' ')}
              </span>
            </div>
            {(output.stdout || output.stderr) && (
              <div style={{ padding: '0 12px 8px 44px' }}>
                {output.stdout && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 4,
                      backgroundColor: '#f9fafb',
                      fontSize: '0.7rem',
                      maxHeight: 100,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {output.stdout}
                  </pre>
                )}
                {output.stderr && (
                  <pre
                    style={{
                      margin: 0,
                      padding: 4,
                      backgroundColor: '#fef2f2',
                      fontSize: '0.7rem',
                      maxHeight: 60,
                      overflow: 'auto',
                      whiteSpace: 'pre-wrap',
                      color: '#991b1b',
                    }}
                  >
                    {output.stderr}
                  </pre>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Completed events */}
      {filtered.map((event) => (
        <TranscriptRow
          key={event.id}
          event={event}
          isExpanded={expandedId === event.id}
          onToggle={() => toggle(event.id)}
        />
      ))}
    </div>
  );
};

export default TranscriptPanel;
