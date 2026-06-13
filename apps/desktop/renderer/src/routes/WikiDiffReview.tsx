/**
 * WikiDiffReview — modal overlay for reviewing and applying wiki diffs.
 *
 * Opens from the WikiImpactCard "Review" button. Provides a multi-phase
 * workflow:
 *
 * Phase 1 – Review: Shows the parsed wiki-diff operations in a table.
 *   Each operation can be toggled on/off for selective apply.
 *
 * Phase 2 – Dry-run: Runs `openadab wiki apply-diff --change <id> --dry-run --json`
 *   and displays the results before enabling the apply button.
 *
 * Phase 3 – Apply: Requires explicit confirmation checkbox ("I understand
 *   this will permanently modify wiki pages") + "Apply" button. Runs
 *   `openadab wiki apply-diff --change <id> --apply --json`.
 *
 * All CLI calls go through `window.openadab.runCli()`. Commands are
 * automatically recorded in the CLI transcript via the IPC handler.
 *
 * States: loading, empty, error, dry-run-results, apply-success.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';
import type {
  WikiDiffOperation as WikiDiffOp,
  WikiDiffResponse,
} from '../types/inspector.js';
import { wikiDiffOperationKey, filterWikiDiffOperations, buildFilteredWikiDiffDocument } from '../utils/wiki-diff-selection.js';
import WikiDiffTable from '../components/WikiDiffTable.js';

interface WikiDiffReviewProps {
  /** The project root directory. */
  projectRoot: string;
  /** The change ID to review wiki diffs for. */
  changeId: string;
  /** Called when the modal is dismissed. */
  onClose: () => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** Response shape from `wiki apply-diff --dry-run --json` or `--apply --json`. */
interface ApplyDiffResponse {
  success: boolean;
  operations?: WikiDiffOp[];
  errors?: string[];
  summary: string;
}

type ReviewPhase = 'review' | 'dry-run' | 'apply' | 'done' | 'error';

const WikiDiffReview: React.FC<WikiDiffReviewProps> = ({
  projectRoot,
  changeId,
  onClose,
}) => {
  // ── Diff loading state ──
  const [diffData, setDiffData] = useState<WikiDiffResponse | null>(null);
  const [diffLoading, setDiffLoading] = useState(true);
  const [diffError, setDiffError] = useState<string | null>(null);

  // ── Phase state ──
  const [phase, setPhase] = useState<ReviewPhase>('review');

  // ── Dry-run state ──
  const [dryRunResult, setDryRunResult] = useState<ApplyDiffResponse | null>(null);
  const [dryRunLoading, setDryRunLoading] = useState(false);
  const [dryRunError, setDryRunError] = useState<string | null>(null);

  // ── Apply state ──
  const [applyLoading, setApplyLoading] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applyResult, setApplyResult] = useState<ApplyDiffResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  // ── Operation selection ──
  const [checkedOperationKeys, setCheckedOperationKeys] = useState<string[]>([]);
  const [selectiveDryRunResult, setSelectiveDryRunResult] = useState<ApplyDiffResponse | null>(null);
  const [selectiveDryRunLoading, setSelectiveDryRunLoading] = useState(false);
  const [selectiveDryRunError, setSelectiveDryRunError] = useState<string | null>(null);

  const abortRef = useRef(false);

  // ── Fetch wiki diff ──
  const fetchWikiDiff = useCallback(async () => {
    setDiffLoading(true);
    setDiffError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['wiki', 'diff', '--change', changeId, '--json'],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (abortRef.current) return;

      if (event.cancelled) {
        setDiffError('Wiki diff fetch was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        setDiffError(
          event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`,
        );
        return;
      }

      const parsed = event.parsedJson as WikiDiffResponse | null;
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.operations)) {
        setDiffData(parsed);
        setCheckedOperationKeys(parsed.operations.map((op) => wikiDiffOperationKey(op)));
      } else {
        // No wiki-diff output — not an error
        setDiffData(null);
      }
    } catch (e) {
      setDiffError(e instanceof Error ? e.message : 'Unknown error fetching wiki diff.');
    } finally {
      setDiffLoading(false);
    }
  }, [projectRoot, changeId]);

  useEffect(() => {
    fetchWikiDiff();
    return () => {
      abortRef.current = true;
    };
  }, [fetchWikiDiff]);

  // ── Run dry-run (full or selective) ──
  const runDryRun = useCallback(
    async (operationKeys?: string[]) => {
      const isSelective = operationKeys !== undefined;
      if (isSelective) {
        setSelectiveDryRunLoading(true);
        setSelectiveDryRunError(null);
        setSelectiveDryRunResult(null);
      } else {
        setDryRunLoading(true);
        setDryRunError(null);
        setDryRunResult(null);
      }

      try {
        let event: CommandEvent;

        if (isSelective) {
          // Build a temp filtered wiki-diff JSON and run dry-run on it
          if (!diffData) return;
          const filteredOps = diffData.operations.filter((op) =>
            operationKeys!.includes(wikiDiffOperationKey(op)),
          );
          const tempContent = JSON.stringify({ operations: filteredOps }, null, 2);
          const tempPath = `${projectRoot}/adab/.temp/wiki-diff-filtered-${changeId}.json`;

          // Write filtered file via IPC
          await window.openadab.writeFile({
            filePath: tempPath,
            content: tempContent,
            encoding: 'utf-8',
          });

          // Dry-run the filtered file
          event = await window.openadab.runCli({
            commandId: genCommandId(),
            args: ['wiki', 'apply-diff', tempPath, '--dry-run', '--json'],
            cwd: projectRoot,
            initiator: 'user',
          });
        } else {
          event = await window.openadab.runCli({
            commandId: genCommandId(),
            args: ['wiki', 'apply-diff', '--change', changeId, '--dry-run', '--json'],
            cwd: projectRoot,
            initiator: 'user',
          });
        }

        if (abortRef.current) return;

        if (event.cancelled) {
          const msg = 'Dry-run was cancelled.';
          if (isSelective) setSelectiveDryRunError(msg);
          else setDryRunError(msg);
          return;
        }

        if (event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Dry-run exited with code ${event.exitCode ?? 'unknown'}`;
          if (isSelective) setSelectiveDryRunError(errMsg);
          else setDryRunError(errMsg);
          return;
        }

        const parsed = event.parsedJson as ApplyDiffResponse | null;
        if (parsed && typeof parsed === 'object' && 'success' in parsed) {
          if (isSelective) {
            setSelectiveDryRunResult(parsed);
          } else {
            setDryRunResult(parsed);
            setPhase('dry-run');
          }
        } else {
          const msg = 'Failed to parse dry-run result.';
          if (isSelective) setSelectiveDryRunError(msg);
          else setDryRunError(msg);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Unknown error during dry-run.';
        if (isSelective) setSelectiveDryRunError(msg);
        else setDryRunError(msg);
      } finally {
        if (isSelective) setSelectiveDryRunLoading(false);
        else setDryRunLoading(false);
      }
    },
    [projectRoot, changeId, diffData],
  );

  // ── Run apply ──
  const runApply = useCallback(async () => {
    if (!confirmed) return;

    setApplyLoading(true);
    setApplyError(null);

    try {
      // If selective, build filtered temp file and apply it
      let event: CommandEvent;

      if (checkedOperationKeys.length < (diffData?.operations.length ?? 0)) {
        // Selective apply
        const filteredOps = (diffData?.operations ?? []).filter((op) =>
          checkedOperationKeys.includes(wikiDiffOperationKey(op)),
        );
        const tempContent = JSON.stringify({ operations: filteredOps }, null, 2);
        const tempPath = `${projectRoot}/adab/.temp/wiki-diff-apply-${changeId}.json`;

        await window.openadab.writeFile({
          filePath: tempPath,
          content: tempContent,
          encoding: 'utf-8',
        });

        event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['wiki', 'apply-diff', tempPath, '--apply', '--json'],
          cwd: projectRoot,
          initiator: 'user',
        });
      } else {
        event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['wiki', 'apply-diff', '--change', changeId, '--apply', '--json'],
          cwd: projectRoot,
          initiator: 'user',
        });
      }

      if (event.cancelled) {
        setApplyError('Apply was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        setApplyError(
          event.parseError ??
            event.stderr.trim() ??
            `Apply failed with code ${event.exitCode ?? 'unknown'}`,
        );
        return;
      }

      const parsed = event.parsedJson as ApplyDiffResponse | null;
      if (parsed && typeof parsed === 'object') {
        setApplyResult(parsed);
        setPhase('done');
      } else {
        setApplyError('Failed to parse apply result.');
      }
    } catch (e) {
      setApplyError(e instanceof Error ? e.message : 'Apply failed.');
    } finally {
      setApplyLoading(false);
    }
  }, [confirmed, checkedOperationKeys, diffData, projectRoot, changeId]);

  // ── Handle Escape key ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !applyLoading && !dryRunLoading) {
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose, applyLoading, dryRunLoading]);

  // ── Render helpers ──

  const opCount = diffData?.operations.length ?? 0;

  /** Render the modal content based on current phase. */
  const renderContent = () => {
    // Loading
    if (diffLoading) {
      return (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            padding: '40px 20px',
            gap: 12,
          }}
        >
          <span
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: '3px solid #d1d5db',
              borderTopColor: '#3b82f6',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>
            Loading wiki diff…
          </span>
        </div>
      );
    }

    // Error
    if (diffError) {
      return (
        <div
          style={{
            padding: 20,
            textAlign: 'center',
          }}
        >
          <div
            style={{
              padding: 10,
              marginBottom: 12,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
            }}
          >
            <div
              style={{
                fontSize: '0.72rem',
                fontFamily: 'monospace',
                color: '#dc2626',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {diffError}
            </div>
          </div>
          <button
            type="button"
            onClick={fetchWikiDiff}
            style={{
              padding: '6px 14px',
              border: '1px solid #fecaca',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#dc2626',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    // Empty: no wiki diff
    if (!diffData || opCount === 0) {
      return (
        <div
          style={{
            padding: 40,
            textAlign: 'center',
            color: '#9ca3af',
            fontSize: '0.82rem',
          }}
        >
          <div style={{ fontSize: '1.5rem', marginBottom: 8 }}>📚</div>
          No wiki changes detected for this change.
        </div>
      );
    }

    // Apply success
    if (phase === 'done' && applyResult) {
      return (
        <div style={{ padding: 20 }}>
          <div
            style={{
              padding: 16,
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 6,
              textAlign: 'center',
              marginBottom: 16,
            }}
          >
            <div style={{ fontSize: '1.2rem', marginBottom: 4 }}>✅</div>
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#166534',
                marginBottom: 8,
              }}
            >
              Wiki Diff Applied Successfully
            </div>
            <div
              style={{
                fontSize: '0.72rem',
                color: '#15803d',
                fontFamily: 'monospace',
                whiteSpace: 'pre-wrap',
              }}
            >
              {applyResult.summary}
            </div>
            {applyResult.errors && applyResult.errors.length > 0 && (
              <div
                style={{
                  marginTop: 8,
                  padding: 8,
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 4,
                  fontSize: '0.68rem',
                  color: '#dc2626',
                  textAlign: 'left',
                }}
              >
                {applyResult.errors.map((e, i) => (
                  <div key={i}>• {e}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Operation table with controls
    return (
      <div>
        {/* Operation selection table */}
        <WikiDiffTable
          operations={diffData.operations}
          onCheckedChange={setCheckedOperationKeys}
        />

        {/* Selective dry-run result */}
        {selectiveDryRunLoading && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 4,
              textAlign: 'center',
              fontSize: '0.72rem',
              color: '#1d4ed8',
            }}
          >
            Running selective dry-run…
          </div>
        )}

        {selectiveDryRunError && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: '0.68rem',
              fontFamily: 'monospace',
              color: '#dc2626',
            }}
          >
            Selective dry-run error: {selectiveDryRunError}
          </div>
        )}

        {selectiveDryRunResult && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              backgroundColor: selectiveDryRunResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${selectiveDryRunResult.success ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: 4,
              fontSize: '0.7rem',
            }}
          >
            <div
              style={{
                fontWeight: 600,
                color: selectiveDryRunResult.success ? '#166534' : '#dc2626',
                marginBottom: 4,
              }}
            >
              {selectiveDryRunResult.success ? '✓ Selective dry-run passed' : '✗ Selective dry-run failed'}
            </div>
            <div style={{ color: '#374151', fontFamily: 'monospace', fontSize: '0.65rem' }}>
              {selectiveDryRunResult.summary}
            </div>
            {selectiveDryRunResult.errors && selectiveDryRunResult.errors.length > 0 && (
              <div style={{ marginTop: 4 }}>
                {selectiveDryRunResult.errors.map((e, i) => (
                  <div key={i} style={{ color: '#dc2626', fontSize: '0.62rem' }}>• {e}</div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Dry-run result (full) */}
        {phase === 'dry-run' && dryRunResult && (
          <div
            style={{
              marginTop: 12,
              padding: 12,
              backgroundColor: dryRunResult.success ? '#f0fdf4' : '#fef2f2',
              border: `1px solid ${dryRunResult.success ? '#bbf7d0' : '#fecaca'}`,
              borderRadius: 6,
            }}
          >
            <div
              style={{
                fontSize: '0.75rem',
                fontWeight: 700,
                color: dryRunResult.success ? '#166534' : '#dc2626',
                marginBottom: 6,
              }}
            >
              {dryRunResult.success ? '✓ Dry-run passed' : '✗ Dry-run failed'}
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                color: '#374151',
                fontFamily: 'monospace',
                marginBottom: 6,
                whiteSpace: 'pre-wrap',
              }}
            >
              {dryRunResult.summary}
            </div>
            {dryRunResult.errors && dryRunResult.errors.length > 0 && (
              <div style={{ marginBottom: 8 }}>
                {dryRunResult.errors.map((e, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: '0.66rem',
                      color: '#991b1b',
                      paddingLeft: 8,
                    }}
                  >
                    • {e}
                  </div>
                ))}
              </div>
            )}

            {/* Confirmation checkbox */}
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                backgroundColor: '#fffbeb',
                border: '1px solid #fde68a',
                borderRadius: 4,
              }}
            >
              <label
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  cursor: 'pointer',
                  fontSize: '0.72rem',
                  color: '#92400e',
                }}
              >
                <input
                  type="checkbox"
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                  style={{ cursor: 'pointer', marginTop: 1 }}
                />
                <span>
                  <strong>I understand</strong> this will permanently modify wiki
                  pages. This action cannot be undone.
                </span>
              </label>
            </div>
          </div>
        )}

        {/* Dry-run / Apply error (full) */}
        {dryRunError && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: '0.68rem',
              fontFamily: 'monospace',
              color: '#dc2626',
            }}
          >
            Dry-run error: {dryRunError}
          </div>
        )}

        {applyError && (
          <div
            style={{
              marginTop: 10,
              padding: 10,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: '0.68rem',
              fontFamily: 'monospace',
              color: '#dc2626',
            }}
          >
            Apply error: {applyError}
          </div>
        )}
      </div>
    );
  };

  /** Render action buttons based on phase. */
  const renderActions = () => {
    if (diffLoading || diffError || !diffData || opCount === 0 || phase === 'done') {
      return (
        <button
          type="button"
          onClick={onClose}
          style={{
            padding: '7px 16px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.78rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {phase === 'done' ? 'Close' : 'Cancel'}
        </button>
      );
    }

    return (
      <div style={{ display: 'flex', gap: 8 }}>
        {/* Selective dry-run button */}
        <button
          type="button"
          onClick={() => runDryRun(checkedOperationKeys)}
          disabled={selectiveDryRunLoading || checkedOperationKeys.length === 0}
          style={{
            padding: '7px 14px',
            border: '1px solid #bfdbfe',
            borderRadius: 4,
            backgroundColor: '#eff6ff',
            color: selectiveDryRunLoading || checkedOperationKeys.length === 0 ? '#9ca3af' : '#1d4ed8',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: selectiveDryRunLoading || checkedOperationKeys.length === 0 ? 'not-allowed' : 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 4,
          }}
        >
          {selectiveDryRunLoading && (
            <span
              style={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                border: '2px solid #bfdbfe',
                borderTopColor: '#3b82f6',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
          )}
          Dry-run Selected ({checkedOperationKeys.length})
        </button>

        {/* Full dry-run button (only in review phase) */}
        {phase === 'review' && (
          <button
            type="button"
            onClick={() => runDryRun()}
            disabled={dryRunLoading}
            style={{
              padding: '7px 14px',
              border: '1px solid #2563eb',
              borderRadius: 4,
              backgroundColor: dryRunLoading ? '#93c5fd' : '#3b82f6',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: dryRunLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {dryRunLoading && (
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
            Dry-run All
          </button>
        )}

        {/* Apply button (only in dry-run phase with confirmation) */}
        {phase === 'dry-run' && (
          <button
            type="button"
            onClick={runApply}
            disabled={!confirmed || applyLoading}
            style={{
              padding: '7px 14px',
              border: 'none',
              borderRadius: 4,
              backgroundColor:
                !confirmed || applyLoading ? '#9ca3af' : '#dc2626',
              color: '#fff',
              fontSize: '0.75rem',
              fontWeight: 600,
              cursor: !confirmed || applyLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            {applyLoading && (
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
            Apply
          </button>
        )}

        {/* Cancel / Close */}
        <button
          type="button"
          onClick={onClose}
          disabled={applyLoading || dryRunLoading}
          style={{
            padding: '7px 16px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.78rem',
            fontWeight: 500,
            cursor: applyLoading || dryRunLoading ? 'not-allowed' : 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    );
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 200,
        fontFamily: 'system-ui, sans-serif',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget && !applyLoading && !dryRunLoading) {
          onClose();
        }
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: 10,
          width: '90vw',
          maxWidth: 720,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 80px rgba(0,0,0,0.3)',
          overflow: 'hidden',
        }}
      >
        {/* Title bar */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '14px 20px',
            borderBottom: '2px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: '1.1rem' }}>📚</span>
            <div>
              <h2
                style={{
                  margin: 0,
                  fontSize: '0.95rem',
                  fontWeight: 700,
                  color: '#1f2937',
                }}
              >
                Wiki Diff Review
              </h2>
              <span
                style={{
                  fontSize: '0.65rem',
                  fontFamily: 'monospace',
                  color: '#6b7280',
                }}
              >
                {changeId}
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={applyLoading}
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              border: 'none',
              backgroundColor: 'transparent',
              color: '#6b7280',
              fontSize: '1.1rem',
              cursor: applyLoading ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            ✕
          </button>
        </div>

        {/* Scrollable content */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            padding: 16,
          }}
        >
          {renderContent()}
        </div>

        {/* Action bar */}
        <div
          style={{
            padding: '12px 20px',
            borderTop: '2px solid #e5e7eb',
            backgroundColor: '#fafafa',
            display: 'flex',
            justifyContent: 'flex-end',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {renderActions()}
        </div>
      </div>
    </div>
  );
};

export default WikiDiffReview;
