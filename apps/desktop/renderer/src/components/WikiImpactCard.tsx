/**
 * WikiImpactCard — displays the wiki diff impact for the selected change.
 *
 * Fetches from `openadab wiki diff --change <id> --json` and renders
 * an operations summary: pages affected, operation types, source, and
 * warnings. Each operation shows target, type, source, and any warnings.
 *
 * Handles empty, loading, error, no-wiki-diff, and no-selection states.
 * Supports compact/expanded toggle.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';
import type { WikiDiffResponse, WikiDiffOperation } from '../types/inspector.js';

interface WikiImpactCardProps {
  /** The project root directory, or null if no project. */
  projectRoot: string | null;
  /** The change ID, or null if no artifact selected. */
  changeId: string | null;
  /** Called when the user clicks "Review" to open the WikiDiffReview modal. */
  onReview?: () => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** Color and label for diff operation types. */
const OP_TYPE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  create: { bg: '#f0fdf4', text: '#166534', label: 'Create' },
  update: { bg: '#eff6ff', text: '#1d4ed8', label: 'Update' },
  delete: { bg: '#fef2f2', text: '#dc2626', label: 'Delete' },
  move: { bg: '#fffbeb', text: '#92400e', label: 'Move' },
};

function opStyle(type: string): { bg: string; text: string; label: string } {
  return (
    OP_TYPE_STYLES[type] ?? {
      bg: '#f9fafb',
      text: '#6b7280',
      label: type,
    }
  );
}

/** Single wiki-diff operation row. */
const OperationRow: React.FC<{
  op: WikiDiffOperation;
}> = ({ op }) => {
  const style = opStyle(op.type);
  return (
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
          padding: '1px 5px',
          borderRadius: 3,
          fontSize: '0.58rem',
          fontWeight: 600,
          backgroundColor: style.bg,
          color: style.text,
          flexShrink: 0,
          minWidth: 42,
          textAlign: 'center',
        }}
      >
        {style.label}
      </span>
      <span
        style={{
          fontFamily: 'monospace',
          color: '#1f2937',
          flex: 1,
          wordBreak: 'break-all',
          lineHeight: 1.4,
        }}
      >
        {op.target}
      </span>
      <span
        style={{
          color: '#6b7280',
          fontSize: '0.6rem',
          maxWidth: 100,
          flexShrink: 0,
          textAlign: 'right',
          lineHeight: 1.4,
        }}
      >
        {op.source}
        {op.warnings && op.warnings.length > 0 && (
          <span
            style={{
              display: 'block',
              color: '#d97706',
              fontWeight: 600,
              fontSize: '0.56rem',
            }}
          >
            ⚠ {op.warnings.length} warning{op.warnings.length !== 1 ? 's' : ''}
          </span>
        )}
      </span>
    </div>
  );
};

const WikiImpactCard: React.FC<WikiImpactCardProps> = ({
  projectRoot,
  changeId,
  onReview,
}) => {
  const [data, setData] = useState<WikiDiffResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showWarnings, setShowWarnings] = useState(false);

  const fetchWikiDiff = useCallback(async () => {
    if (!projectRoot || !changeId) return;

    setLoading(true);
    setError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['wiki', 'diff', '--change', changeId, '--json'],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Wiki diff fetch was cancelled.');
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

      const parsed = event.parsedJson as WikiDiffResponse | null;
      if (
        parsed &&
        typeof parsed === 'object' &&
        'operations' in parsed
      ) {
        setData(parsed);
        setError(null);
      } else {
        // No wiki-diff output — not an error, just empty
        setData(null);
        setError(null);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Unknown error fetching wiki diff.',
      );
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [projectRoot, changeId]);

  useEffect(() => {
    if (projectRoot && changeId) {
      fetchWikiDiff();
    } else {
      setData(null);
      setError(null);
    }
  }, [projectRoot, changeId, fetchWikiDiff]);

  // Auto-refresh after CLI commands complete
  useEffect(() => {
    const unsub = window.openadab.onCommandComplete((_event: CommandEvent) => {
      if (projectRoot && changeId) {
        fetchWikiDiff();
      }
    });
    return unsub;
  }, [projectRoot, changeId, fetchWikiDiff]);

  const opCount = data?.operations.length ?? 0;
  const warningOps =
    data?.operations.filter((op) => op.warnings && op.warnings.length > 0) ?? [];
  const typeCounts: Record<string, number> = {};
  data?.operations.forEach((op) => {
    typeCounts[op.type] = (typeCounts[op.type] ?? 0) + 1;
  });

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
          backgroundColor: isExpanded
            ? warningOps.length > 0
              ? '#fffbeb'
              : '#f3e8ff'
            : '#fafafa',
          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>📚</span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#7c3aed',
          }}
        >
          Wiki Impact
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
        {!loading && !error && data && (
          <span style={{ fontSize: '0.65rem', color: '#6b7280' }}>
            {opCount} operation{opCount !== 1 ? 's' : ''}
            {warningOps.length > 0 && (
              <span style={{ color: '#d97706' }}>
                {' '}
                · {warningOps.length} with warnings
              </span>
            )}
          </span>
        )}
        {!loading && !error && data && onReview && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onReview();
            }}
            style={{
              padding: '3px 10px',
              border: '1px solid #7c3aed',
              borderRadius: 4,
              backgroundColor: '#f3e8ff',
              color: '#7c3aed',
              fontSize: '0.65rem',
              fontWeight: 600,
              cursor: 'pointer',
              marginLeft: 'auto',
              marginRight: 8,
            }}
          >
            Review
          </button>
        )}
        <span
          style={{
            fontSize: '0.7rem',
            color: '#9ca3af',
            ...(onReview ? { marginLeft: 0 } : { marginLeft: 'auto' }),
          }}
        >
          {isExpanded ? '▼' : '▶'}
        </span>
      </div>

      {/* Compact mode */}
      {!isExpanded && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '6px 12px',
            fontSize: '0.68rem',
            color: '#374151',
          }}
        >
          {data
            ? `${opCount} wiki operation${opCount !== 1 ? 's' : ''}`
            : !loading && !error
              ? 'No wiki changes'
              : ''}
          {data?.dryRun && (
            <span style={{ color: '#6b7280' }}> · dry-run</span>
          )}
        </div>
      )}

      {/* Expanded content */}
      {isExpanded && (
        <div style={{ borderTop: '1px solid #e5e7eb' }}>
          {/* Empty: no change selected */}
          {!changeId && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.72rem',
              }}
            >
              No change selected.
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
              Loading wiki diff…
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
                  fetchWikiDiff();
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

          {/* Loaded: no wiki diff */}
          {!loading && !error && !data && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#9ca3af',
                fontSize: '0.72rem',
              }}
            >
              No wiki changes for this change.
            </div>
          )}

          {/* Loaded data */}
          {!loading && !error && data && (
            <div>
              {/* Dry-run indicator */}
              {data.dryRun && (
                <div
                  style={{
                    padding: '6px 12px',
                    backgroundColor: '#eff6ff',
                    borderBottom: '1px solid #dbeafe',
                    fontSize: '0.65rem',
                    color: '#1d4ed8',
                  }}
                >
                  ℹ Dry-run — no changes have been applied.
                </div>
              )}

              {/* Type summary */}
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  padding: '6px 12px',
                  borderBottom: '1px solid #e5e7eb',
                  flexWrap: 'wrap',
                }}
              >
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    color: '#374151',
                  }}
                >
                  {opCount} operation{opCount !== 1 ? 's' : ''}:
                </span>
                {Object.entries(typeCounts).map(([type, count]) => {
                  const style = opStyle(type);
                  return (
                    <span
                      key={type}
                      style={{
                        padding: '1px 5px',
                        borderRadius: 3,
                        fontSize: '0.6rem',
                        fontWeight: 600,
                        backgroundColor: style.bg,
                        color: style.text,
                      }}
                    >
                      {count} {style.label}
                    </span>
                  );
                })}
              </div>

              {/* Warnings toggle */}
              {warningOps.length > 0 && (
                <div
                  onClick={() => setShowWarnings((p) => !p)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ')
                      setShowWarnings((p) => !p);
                  }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    padding: '4px 12px',
                    backgroundColor: '#fffbeb',
                    borderBottom: '1px solid #fde68a',
                    cursor: 'pointer',
                    userSelect: 'none',
                    gap: 4,
                  }}
                >
                  <span style={{ fontSize: '0.62rem', color: '#92400e' }}>
                    {showWarnings ? '▼' : '▶'}
                  </span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      color: '#92400e',
                    }}
                  >
                    ⚠ {warningOps.length} operation{warningOps.length !== 1 ? 's' : ''} with warnings
                  </span>
                </div>
              )}
              {showWarnings &&
                warningOps.map((op, i) => (
                  <div
                    key={i}
                    style={{
                      padding: '4px 12px 4px 24px',
                      borderBottom: '1px solid #fef3c7',
                      fontSize: '0.62rem',
                      color: '#92400e',
                    }}
                  >
                    <span style={{ fontFamily: 'monospace' }}>
                      {op.target}
                    </span>
                    : {op.warnings?.join('; ')}
                  </div>
                ))}

              {/* Operations list */}
              <div style={{ maxHeight: 240, overflow: 'auto' }}>
                {data.operations.map((op, i) => (
                  <OperationRow key={i} op={op} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default WikiImpactCard;
