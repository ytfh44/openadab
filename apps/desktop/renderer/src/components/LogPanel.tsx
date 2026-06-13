/**
 * Recent log panel for the Project Dashboard.
 *
 * Fetches and displays recent log entries from `openadab log --limit <N> --json`.
 * Shows timestamps, severity levels, and messages. Includes a refresh button
 * and configurable limit.
 *
 * Handles loading, empty, error, and command-failure states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';

/** Expected shape of a single log entry from `openadab log --json`. */
interface LogEntry {
  timestamp?: string;
  level?: string;
  message?: string;
  changeId?: string;
  [key: string]: unknown;
}

interface LogPanelProps {
  /** Project root for CLI invocation, or null if no project. */
  projectRoot: string | null;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** Map log level to a display color. */
function levelColor(level: string | undefined): string {
  switch ((level ?? '').toLowerCase()) {
    case 'error':
      return '#dc2626';
    case 'warn':
    case 'warning':
      return '#d97706';
    case 'info':
      return '#2563eb';
    case 'debug':
      return '#6b7280';
    default:
      return '#9ca3af';
  }
}

/** Map log level to a background tint. */
function levelBg(level: string | undefined): string {
  switch ((level ?? '').toLowerCase()) {
    case 'error':
      return '#fef2f2';
    case 'warn':
    case 'warning':
      return '#fffbeb';
    case 'info':
      return '#eff6ff';
    case 'debug':
      return '#f9fafb';
    default:
      return '#fafafa';
  }
}

const LogPanel: React.FC<LogPanelProps> = ({ projectRoot }) => {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(20);

  const fetchLogs = useCallback(async () => {
    if (!projectRoot) return;

    setLoading(true);
    setError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['log', '--limit', String(limit), '--json'],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Log fetch was cancelled.');
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

      // Parse the JSON result
      const parsed: unknown = event.parsedJson;
      if (Array.isArray(parsed)) {
        setEntries(parsed as LogEntry[]);
      } else if (
        parsed != null &&
        typeof parsed === 'object' &&
        'entries' in parsed &&
        Array.isArray((parsed as Record<string, unknown>).entries)
      ) {
        setEntries((parsed as { entries: LogEntry[] }).entries);
      } else {
        setEntries([]);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unknown error fetching logs.',
      );
    } finally {
      setLoading(false);
    }
  }, [projectRoot, limit]);

  // Auto-fetch on mount and when projectRoot changes
  useEffect(() => {
    if (projectRoot) {
      fetchLogs();
    } else {
      setEntries([]);
      setError(null);
    }
  }, [projectRoot, fetchLogs]);

  // ── Empty state (no project) ──
  if (!projectRoot) {
    return (
      <div
        style={{
          backgroundColor: '#fff',
          border: '1px solid #e5e7eb',
          borderRadius: 6,
          padding: 16,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h3
          style={{
            margin: '0 0 12px 0',
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          Recent Log
        </h3>
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.8rem',
            fontStyle: 'italic',
          }}
        >
          No project open — select or create one
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        backgroundColor: '#fff',
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 10,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '0.85rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          Recent Log
        </h3>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label
            style={{
              fontSize: '0.7rem',
              color: '#6b7280',
            }}
          >
            Limit
            <input
              type="number"
              value={limit}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v > 0) setLimit(v);
              }}
              min={1}
              max={200}
              style={{
                width: 48,
                marginLeft: 4,
                padding: '2px 4px',
                border: '1px solid #d1d5db',
                borderRadius: 3,
                fontSize: '0.75rem',
                fontFamily: 'monospace',
              }}
            />
          </label>
          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            style={{
              padding: '3px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: loading ? '#f3f4f6' : '#fff',
              color: '#374151',
              fontSize: '0.72rem',
              fontWeight: 500,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? '…' : 'Refresh'}
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
            color: '#6b7280',
            fontSize: '0.78rem',
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
          Fetching logs…
        </div>
      )}

      {/* Error */}
      {error && !loading && (
        <div
          style={{
            padding: '8px 10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: '0.75rem',
            fontFamily: 'monospace',
            color: '#dc2626',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            marginBottom: 8,
          }}
        >
          {error}
        </div>
      )}

      {/* Empty */}
      {!loading && !error && entries.length === 0 && (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.78rem',
            fontStyle: 'italic',
          }}
        >
          No log entries yet.
        </div>
      )}

      {/* Entries */}
      {!loading && entries.length > 0 && (
        <div
          style={{
            maxHeight: 280,
            overflow: 'auto',
            border: '1px solid #e5e7eb',
            borderRadius: 4,
          }}
        >
          {entries.map((entry, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                gap: 8,
                padding: '6px 10px',
                borderBottom:
                  idx < entries.length - 1 ? '1px solid #f3f4f6' : 'none',
                backgroundColor: levelBg(entry.level),
                alignItems: 'flex-start',
                fontSize: '0.75rem',
              }}
            >
              {/* Timestamp */}
              <span
                style={{
                  color: '#9ca3af',
                  fontFamily: 'monospace',
                  fontSize: '0.7rem',
                  flexShrink: 0,
                  minWidth: 130,
                }}
              >
                {entry.timestamp
                  ? new Date(entry.timestamp).toLocaleString()
                  : '—'}
              </span>

              {/* Level badge */}
              {entry.level && (
                <span
                  style={{
                    display: 'inline-block',
                    padding: '1px 6px',
                    borderRadius: 3,
                    backgroundColor: levelColor(entry.level),
                    color: '#fff',
                    fontSize: '0.65rem',
                    fontWeight: 700,
                    textTransform: 'uppercase',
                    flexShrink: 0,
                    minWidth: 36,
                    textAlign: 'center',
                  }}
                >
                  {entry.level}
                </span>
              )}

              {/* Message */}
              <span
                style={{
                  color: '#374151',
                  flex: 1,
                  wordBreak: 'break-word',
                }}
              >
                {entry.message ?? JSON.stringify(entry)}
              </span>

              {/* Change ID */}
              {entry.changeId && (
                <span
                  style={{
                    color: '#7b4fbf',
                    fontFamily: 'monospace',
                    fontSize: '0.68rem',
                    flexShrink: 0,
                  }}
                >
                  {entry.changeId}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default LogPanel;
