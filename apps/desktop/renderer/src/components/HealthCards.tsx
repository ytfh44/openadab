/**
 * Wiki health cards for the Project Dashboard.
 *
 * Displays health summaries from two CLI commands:
 * - `openadab wiki lint --json` — validates wiki page structure
 * - `openadab wiki index --json` — wiki index status
 *
 * Each card shows a pass / fail / warning badge with counts of pages,
 * issues, warnings, and errors. Both cards auto-fetch on mount and
 * expose a manual refresh control.
 *
 * Handles loading, empty, error, and command-failure states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';

interface HealthCardsProps {
  /** Project root for CLI invocation, or null if no project. */
  projectRoot: string | null;
}

/** Parsed result from wiki lint / index commands. */
interface WikiCheckResult {
  status: 'pass' | 'fail' | 'warning' | 'unknown';
  totalPages?: number;
  errors?: number;
  warnings?: number;
  issues?: unknown[];
  message?: string;
  raw?: unknown;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** Determine overall status from raw JSON output. */
function classifyStatus(
  event: CommandEvent,
): WikiCheckResult['status'] {
  if (event.exitCode !== 0) return 'fail';
  const data = event.parsedJson;
  if (data == null) return 'unknown';
  if (typeof data === 'object') {
    const obj = data as Record<string, unknown>;
    if ('errors' in obj && typeof obj.errors === 'number' && obj.errors > 0) return 'fail';
    if ('warnings' in obj && typeof obj.warnings === 'number' && obj.warnings > 0) return 'warning';
    if ('status' in obj && typeof obj.status === 'string') {
      const s = obj.status.toLowerCase();
      if (s === 'ok' || s === 'pass' || s === 'success') return 'pass';
      if (s === 'fail' || s === 'error') return 'fail';
      if (s === 'warn' || s === 'warning') return 'warning';
    }
  }
  return 'pass';
}

/** Extract numeric values from parsed CLI JSON. */
function extractCounts(
  event: CommandEvent,
): Pick<WikiCheckResult, 'totalPages' | 'errors' | 'warnings' | 'message'> {
  const data = event.parsedJson;
  if (data == null || typeof data !== 'object') return {};
  const obj = data as Record<string, unknown>;
  const result: Pick<WikiCheckResult, 'totalPages' | 'errors' | 'warnings' | 'message'> = {};
  if (typeof obj.totalPages === 'number') result.totalPages = obj.totalPages;
  else if (typeof obj.total === 'number') result.totalPages = obj.total;
  else if (typeof obj.pages === 'number') result.totalPages = obj.pages;
  else if (Array.isArray(obj.pages)) result.totalPages = obj.pages.length;
  if (typeof obj.errors === 'number') result.errors = obj.errors;
  if (typeof obj.warnings === 'number') result.warnings = obj.warnings;
  if (typeof obj.message === 'string') result.message = obj.message;
  return result;
}

const STATUS_STYLES: Record<
  WikiCheckResult['status'],
  { bg: string; border: string; color: string; label: string }
> = {
  pass: {
    bg: '#f0fdf4',
    border: '#bbf7d0',
    color: '#166534',
    label: 'PASS',
  },
  fail: {
    bg: '#fef2f2',
    border: '#fecaca',
    color: '#dc2626',
    label: 'FAIL',
  },
  warning: {
    bg: '#fffbeb',
    border: '#fde68a',
    color: '#92400e',
    label: 'WARN',
  },
  unknown: {
    bg: '#f9fafb',
    border: '#e5e7eb',
    color: '#6b7280',
    label: '—',
  },
};

const HealthCards: React.FC<HealthCardsProps> = ({ projectRoot }) => {
  const [lintResult, setLintResult] = useState<WikiCheckResult | null>(null);
  const [indexResult, setIndexResult] = useState<WikiCheckResult | null>(null);
  const [loadingLint, setLoadingLint] = useState(false);
  const [loadingIndex, setLoadingIndex] = useState(false);
  const [lintError, setLintError] = useState<string | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);

  /** Run a single wiki check and update the corresponding state. */
  const runCheck = useCallback(
    async (
      args: string[],
      setLoading: (v: boolean) => void,
      setError: (v: string | null) => void,
      setResult: (v: WikiCheckResult | null) => void,
    ) => {
      if (!projectRoot) return;

      setLoading(true);
      setError(null);

      try {
        const event: CommandEvent = await window.openadab.runCli({
          commandId: genCommandId(),
          args,
          cwd: projectRoot,
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
          setResult({ status: 'fail', message: errMsg });
          return;
        }

        const status = classifyStatus(event);
        const counts = extractCounts(event);
        setResult({
          status,
          ...counts,
          raw: event.parsedJson,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error.';
        setError(msg);
        setResult({ status: 'fail', message: msg });
      } finally {
        setLoading(false);
      }
    },
    [projectRoot],
  );

  const refreshAll = useCallback(() => {
    runCheck(
      ['wiki', 'lint', '--json'],
      setLoadingLint,
      setLintError,
      setLintResult,
    );
    runCheck(
      ['wiki', 'index', '--json'],
      setLoadingIndex,
      setIndexError,
      setIndexResult,
    );
  }, [runCheck]);

  // Auto-fetch on mount or when projectRoot changes
  useEffect(() => {
    if (projectRoot) {
      refreshAll();
    } else {
      setLintResult(null);
      setIndexResult(null);
      setLintError(null);
      setIndexError(null);
    }
  }, [projectRoot, refreshAll]);

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
          Wiki Health
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
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 12,
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
          Wiki Health
        </h3>
        <button
          type="button"
          onClick={refreshAll}
          disabled={loadingLint || loadingIndex}
          style={{
            padding: '3px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor:
              loadingLint || loadingIndex ? '#f3f4f6' : '#fff',
            color: '#374151',
            fontSize: '0.72rem',
            fontWeight: 500,
            cursor:
              loadingLint || loadingIndex ? 'not-allowed' : 'pointer',
          }}
        >
          {loadingLint || loadingIndex ? '…' : 'Refresh'}
        </button>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 12,
        }}
      >
        <HealthCard
          title="Wiki Lint"
          result={lintResult}
          loading={loadingLint}
          error={lintError}
        />
        <HealthCard
          title="Wiki Index"
          result={indexResult}
          loading={loadingIndex}
          error={indexError}
        />
      </div>
    </div>
  );
};

/** A single health check card. */
const HealthCard: React.FC<{
  title: string;
  result: WikiCheckResult | null;
  loading: boolean;
  error: string | null;
}> = ({ title, result, loading, error }) => {
  if (loading) {
    return (
      <div
        style={{
          padding: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          fontSize: '0.75rem',
          color: '#9ca3af',
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
        Checking {title.toLowerCase()}…
      </div>
    );
  }

  if (error && !result) {
    return (
      <div
        style={{
          padding: 12,
          border: '1px solid #fecaca',
          borderRadius: 4,
          backgroundColor: '#fef2f2',
        }}
      >
        <div
          style={{
            fontSize: '0.75rem',
            fontWeight: 600,
            color: '#dc2626',
            marginBottom: 4,
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontSize: '0.7rem',
            color: '#dc2626',
            fontFamily: 'monospace',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {error}
        </div>
      </div>
    );
  }

  if (!result) {
    return (
      <div
        style={{
          padding: 16,
          border: '1px solid #e5e7eb',
          borderRadius: 4,
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '0.75rem',
          fontStyle: 'italic',
        }}
      >
        No data
      </div>
    );
  }

  const style = STATUS_STYLES[result.status];

  return (
    <div
      style={{
        padding: 12,
        border: `1px solid ${style.border}`,
        borderRadius: 4,
        backgroundColor: style.bg,
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 700,
            color: '#111827',
          }}
        >
          {title}
        </span>
        <span
          style={{
            padding: '2px 8px',
            borderRadius: 3,
            backgroundColor: style.color,
            color: '#fff',
            fontSize: '0.65rem',
            fontWeight: 700,
            textTransform: 'uppercase',
          }}
        >
          {style.label}
        </span>
      </div>

      {/* Counts */}
      <div
        style={{
          display: 'flex',
          gap: 12,
          fontSize: '0.72rem',
          color: '#374151',
          marginBottom: 4,
        }}
      >
        {result.totalPages !== undefined && (
          <span>
            Pages: <strong>{result.totalPages}</strong>
          </span>
        )}
        {result.errors !== undefined && (
          <span style={{ color: '#dc2626' }}>
            Errors: <strong>{result.errors}</strong>
          </span>
        )}
        {result.warnings !== undefined && (
          <span style={{ color: '#d97706' }}>
            Warnings: <strong>{result.warnings}</strong>
          </span>
        )}
      </div>

      {/* Message */}
      {result.message && (
        <div
          style={{
            fontSize: '0.7rem',
            color: '#6b7280',
            fontStyle: 'italic',
          }}
        >
          {result.message}
        </div>
      )}

      {/* Raw JSON on demand */}
      {result.raw != null && (
        <details style={{ marginTop: 6 }}>
          <summary
            style={{
              cursor: 'pointer',
              fontSize: '0.65rem',
              color: '#6b7280',
            }}
          >
            Raw output
          </summary>
          <pre
            style={{
              margin: '4px 0 0 0',
              padding: 6,
              backgroundColor: '#f9fafb',
              border: '1px solid #e5e7eb',
              borderRadius: 3,
              fontSize: '0.65rem',
              maxHeight: 120,
              overflow: 'auto',
            }}
          >
            {JSON.stringify(result.raw, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
};

export default HealthCards;
