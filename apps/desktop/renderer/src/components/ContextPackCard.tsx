/**
 * ContextPackCard — displays the context pack for the selected artifact.
 *
 * Fetches from `openadab context pack --change <id> --artifact <id> --json`
 * and renders three collapsible sections: Must-Read (always visible),
 * Optional (collapsible), and Excluded (collapsible).
 *
 * Each item shows file name, reason, estimated token size, and stale-index
 * warnings. Includes a "Copy to Prompt" button that formats all must-read
 * file paths as a prompt-ready block and copies it to the clipboard.
 *
 * Handles empty, loading, error, and no-selection states.
 * Supports compact/expanded toggle.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';
import type {
  ContextPackResponse,
  ContextPackItem,
} from '../types/inspector.js';

interface ContextPackCardProps {
  /** The project root directory, or null if no project. */
  projectRoot: string | null;
  /** The change ID, or null if no artifact selected. */
  changeId: string | null;
  /** The artifact ID, or null if no artifact selected. */
  artifactId: string | null;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function reasonFor(
  reasons: Record<string, unknown>,
  file: string,
  fallback: string,
): string {
  const reason = reasons[file];
  return reason !== undefined ? String(reason) : fallback;
}

function normalizeContextItems(
  raw: unknown,
  reasons: Record<string, unknown>,
  fallbackReason: string,
): ContextPackItem[] | null {
  if (!Array.isArray(raw)) return null;

  return raw
    .map((item): ContextPackItem => {
      if (isRecord(item)) {
        const file = String(item['file'] ?? item['path'] ?? '');
        return {
          file,
          reason:
            item['reason'] !== undefined
              ? String(item['reason'])
              : reasonFor(reasons, file, fallbackReason),
          tokens: typeof item['tokens'] === 'number' ? item['tokens'] : undefined,
          stale: item['stale'] === true,
        };
      }

      const file = String(item);
      return {
        file,
        reason: reasonFor(reasons, file, fallbackReason),
      };
    })
    .filter((item) => item.file.length > 0);
}

export function parseContextPackResponse(
  parsed: unknown,
): ContextPackResponse | null {
  if (!isRecord(parsed)) return null;

  const reasons = isRecord(parsed['reasons']) ? parsed['reasons'] : {};
  const mustRead = normalizeContextItems(
    parsed['mustRead'],
    reasons,
    'must-read',
  );
  if (mustRead === null) return null;

  const optional =
    normalizeContextItems(parsed['optional'], reasons, 'optional') ??
    normalizeContextItems(parsed['optionalRead'], reasons, 'optional') ??
    [];
  const excluded =
    normalizeContextItems(parsed['excluded'], reasons, 'excluded') ?? [];
  const staleReason = reasons['__stale_index_warning'];

  return {
    mustRead,
    optional,
    excluded,
    estimatedSize:
      typeof parsed['estimatedSize'] === 'number'
        ? parsed['estimatedSize']
        : undefined,
    staleIndexWarning:
      parsed['staleIndexWarning'] === true ||
      (typeof staleReason === 'string' && staleReason.length > 0),
  };
}

/** Format a token count for display. */
function formatTokens(n: unknown): string {
  if (typeof n === 'number') {
    if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
    return String(n);
  }
  return '—';
}

/** Build prompt-ready text from must-read file list. */
function buildPromptText(
  artifactId: string,
  items: ContextPackItem[],
): string {
  const lines: string[] = [
    `## Context for \`${artifactId}\``,
    '### Must-Read Files',
  ];
  for (const item of items) {
    lines.push(`- ${item.file} (${item.reason})`);
  }
  return lines.join('\n');
}

/** Single context item row. */
const ContextItemRow: React.FC<{
  item: ContextPackItem;
}> = ({ item }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 6,
      padding: '4px 8px',
      borderBottom: '1px solid #f3f4f6',
      fontSize: '0.68rem',
    }}
  >
    <span
      style={{
        fontFamily: 'monospace',
        color: '#1f2937',
        flex: 1,
        wordBreak: 'break-all',
        lineHeight: 1.4,
      }}
    >
      {item.file}
    </span>
    <span
      style={{
        color: '#6b7280',
        fontSize: '0.62rem',
        fontStyle: 'italic',
        maxWidth: 120,
        flexShrink: 0,
        textAlign: 'right',
        lineHeight: 1.4,
      }}
    >
      {item.reason}
      {item.stale && (
        <span
          style={{
            display: 'block',
            color: '#d97706',
            fontWeight: 600,
            fontSize: '0.58rem',
          }}
        >
          ⚠ stale index
        </span>
      )}
      {item.tokens != null && (
        <span style={{ display: 'block', color: '#9ca3af' }}>
          ~{formatTokens(item.tokens)} tokens
        </span>
      )}
    </span>
  </div>
);

const ContextPackCard: React.FC<ContextPackCardProps> = ({
  projectRoot,
  changeId,
  artifactId,
}) => {
  const [data, setData] = useState<ContextPackResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showOptional, setShowOptional] = useState(false);
  const [showExcluded, setShowExcluded] = useState(false);
  const [copied, setCopied] = useState(false);

  const fetchContext = useCallback(async () => {
    if (!projectRoot || !changeId || !artifactId) return;

    setLoading(true);
    setError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: [
          'context',
          'pack',
          '--change',
          changeId,
          '--artifact',
          artifactId,
          '--json',
        ],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Context pack fetch was cancelled.');
        setData(null);
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setError(errMsg);
        setData(null);
        return;
      }

      const parsed = parseContextPackResponse(event.parsedJson);
      if (parsed) {
        setData(parsed);
        setError(null);
      } else {
        setError('Unexpected response shape from context pack command.');
        setData(null);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unknown error fetching context pack.',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectRoot, changeId, artifactId]);

  useEffect(() => {
    if (projectRoot && changeId && artifactId) {
      fetchContext();
    } else {
      setData(null);
      setError(null);
    }
  }, [projectRoot, changeId, artifactId, fetchContext]);

  // Auto-refresh after CLI commands complete
  useEffect(() => {
    const unsub = window.openadab.onCommandComplete((_event: CommandEvent) => {
      if (projectRoot && changeId && artifactId) {
        fetchContext();
      }
    });
    return unsub;
  }, [projectRoot, changeId, artifactId, fetchContext]);

  const handleCopy = useCallback(async () => {
    if (!data || !artifactId) return;
    await navigator.clipboard.writeText(
      buildPromptText(artifactId, data.mustRead),
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data, artifactId]);

  const mustCount = data?.mustRead.length ?? 0;
  const optCount = data?.optional.length ?? 0;
  const excCount = data?.excluded.length ?? 0;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        backgroundColor: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
        marginBottom: 8,
      }}
    >
      {/* Header bar */}
      <div
        onClick={() => setIsExpanded((p) => !p)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') setIsExpanded((p) => !p);
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          cursor: 'pointer',
          userSelect: 'none',
          backgroundColor: isExpanded ? '#f0fdf4' : '#fafafa',
          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>📦</span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#166534',
          }}
        >
          Context Pack
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
          <span style={{ fontSize: '0.65rem', color: '#dc2626' }}>Error</span>
        )}
        {!loading && !error && data && isExpanded && (
          <span style={{ fontSize: '0.65rem', color: '#6b7280', marginLeft: 4 }}>
            {mustCount} must-read, {optCount} opt, {excCount} excl
          </span>
        )}
        <span
          style={{
            marginLeft: 'auto',
            fontSize: '0.7rem',
            color: '#9ca3af',
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Compact mode: summary line only */}
      {!isExpanded && data && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '6px 12px',
            fontSize: '0.68rem',
            color: '#374151',
          }}
        >
          {mustCount} must-read, {optCount} optional, {excCount} excluded
          {data.estimatedSize != null && (
            <span style={{ color: '#9ca3af' }}>
              {' '}
              · ~{formatTokens(data.estimatedSize)} tokens
            </span>
          )}
          {data.staleIndexWarning && (
            <span style={{ color: '#d97706', fontWeight: 600 }}>
              {' '}
              · ⚠ stale index
            </span>
          )}
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #e5e7eb' }}>
          {/* Empty: no artifact selected */}
          {!changeId && !artifactId && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.72rem',
              }}
            >
              No artifact selected.
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '0.72rem',
              }}
            >
              Loading context pack…
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div
              style={{
                padding: 10,
                margin: 6,
                backgroundColor: '#fef2f2',
                border: '1px solid #fecaca',
                borderRadius: 4,
              }}
            >
              <div
                style={{
                  fontSize: '0.68rem',
                  fontFamily: 'monospace',
                  color: '#dc2626',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-all',
                  marginBottom: 6,
                }}
              >
                {error}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchContext();
                }}
                style={{
                  padding: '3px 10px',
                  border: '1px solid #fecaca',
                  borderRadius: 3,
                  backgroundColor: '#fff',
                  color: '#dc2626',
                  fontSize: '0.65rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          )}

          {/* Loaded data */}
          {!loading && !error && data && (
            <div>
              {/* Stale index warning */}
              {data.staleIndexWarning && (
                <div
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#fffbeb',
                    borderBottom: '1px solid #fde68a',
                    fontSize: '0.65rem',
                    color: '#92400e',
                  }}
                >
                  ⚠ The context index is stale. Run{' '}
                  <code style={{ fontFamily: 'monospace' }}>
                    openadab wiki index
                  </code>{' '}
                  to refresh.
                </div>
              )}

              {/* Must-Read section (always visible) */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '6px 12px',
                    backgroundColor: '#f0fdf4',
                    borderBottom: '1px solid #bbf7d0',
                    gap: 8,
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.7rem',
                      fontWeight: 700,
                      color: '#166534',
                    }}
                  >
                    Must-Read ({data.mustRead.length})
                  </span>
                  {data.estimatedSize != null && (
                    <span
                      style={{
                        fontSize: '0.62rem',
                        color: '#6b7280',
                      }}
                    >
                      ~{formatTokens(data.estimatedSize)} tokens
                    </span>
                  )}
                </div>
                {data.mustRead.length === 0 && (
                  <div
                    style={{
                      padding: '6px 12px',
                      fontSize: '0.65rem',
                      color: '#9ca3af',
                    }}
                  >
                    No must-read files.
                  </div>
                )}
                {data.mustRead.map((item, i) => (
                  <ContextItemRow key={i} item={item} />
                ))}
              </div>

              {/* Optional section (collapsible) */}
              {data.optional.length > 0 && (
                <div>
                  <div
                    onClick={() => setShowOptional((p) => !p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ')
                        setShowOptional((p) => !p);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '5px 12px',
                      backgroundColor: '#f9fafb',
                      borderBottom: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      userSelect: 'none',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: '0.62rem', color: '#9ca3af' }}>
                      {showOptional ? '▼' : '▶'}
                    </span>
                    <span
                      style={{ fontSize: '0.68rem', color: '#6b7280' }}
                    >
                      Optional ({data.optional.length})
                    </span>
                  </div>
                  {showOptional &&
                    data.optional.map((item, i) => (
                      <ContextItemRow key={i} item={item} />
                    ))}
                </div>
              )}

              {/* Excluded section (collapsible) */}
              {data.excluded.length > 0 && (
                <div>
                  <div
                    onClick={() => setShowExcluded((p) => !p)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ')
                        setShowExcluded((p) => !p);
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      padding: '5px 12px',
                      backgroundColor: '#f9fafb',
                      borderBottom: '1px solid #e5e7eb',
                      cursor: 'pointer',
                      userSelect: 'none',
                      gap: 4,
                    }}
                  >
                    <span style={{ fontSize: '0.62rem', color: '#9ca3af' }}>
                      {showExcluded ? '▼' : '▶'}
                    </span>
                    <span
                      style={{ fontSize: '0.68rem', color: '#9ca3af' }}
                    >
                      Excluded ({data.excluded.length})
                    </span>
                  </div>
                  {showExcluded &&
                    data.excluded.map((item, i) => (
                      <ContextItemRow key={i} item={item} />
                    ))}
                </div>
              )}

              {/* Copy to Prompt button */}
              {data.mustRead.length > 0 && (
                <div style={{ padding: '6px 12px', borderTop: '1px solid #e5e7eb' }}>
                  <button
                    type="button"
                    onClick={handleCopy}
                    style={{
                      padding: '4px 12px',
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      backgroundColor: copied ? '#f0fdf4' : '#fff',
                      color: copied ? '#166534' : '#374151',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {copied ? '✓ Copied' : '📋 Copy to Prompt'}
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ContextPackCard;
