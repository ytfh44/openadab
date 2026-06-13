/**
 * ValidationCard — displays mechanical and semantic validation results.
 *
 * Mechanical validation is fetched from
 * `openadab validate --change <id> --mechanical --json` and shows
 * pass/fail with an error list.
 *
 * Semantic validation is fetched from
 * `openadab validate --change <id> --semantic --json` and is explicitly
 * labeled as "Review Prompt / Manual Semantic Review" unless an agent
 * actually executes it (Section 11).
 *
 * Handles empty, loading, error, and no-selection states.
 * Supports compact/expanded toggle.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { CommandEvent } from '../../../shared/ipc-types.js';
import type {
  MechanicalValidationResponse,
  ValidationError,
} from '../types/inspector.js';

interface ValidationCardProps {
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

function normalizeValidationError(
  raw: unknown,
  fallbackFile: string,
): ValidationError {
  if (isRecord(raw)) {
    return {
      file: String(raw['file'] ?? raw['artifactId'] ?? fallbackFile),
      line: typeof raw['line'] === 'number' ? raw['line'] : undefined,
      message: String(raw['message'] ?? raw['reason'] ?? raw['error'] ?? raw),
    };
  }

  return {
    file: fallbackFile,
    message: String(raw),
  };
}

export function parseMechanicalValidationResponse(
  parsed: unknown,
): MechanicalValidationResponse | null {
  if (isRecord(parsed) && typeof parsed['passed'] === 'boolean') {
    return {
      passed: parsed['passed'],
      errors: Array.isArray(parsed['errors'])
        ? parsed['errors'].map((err) => normalizeValidationError(err, 'validation'))
        : [],
    };
  }

  if (!Array.isArray(parsed)) return null;

  const errors: ValidationError[] = [];
  let passed = true;

  for (const item of parsed) {
    if (!isRecord(item)) continue;
    const artifactId = String(item['artifactId'] ?? 'validation');
    const itemPassed = item['passed'] === true;
    if (!itemPassed) {
      passed = false;
      if (Array.isArray(item['errors']) && item['errors'].length > 0) {
        errors.push(
          ...item['errors'].map((err) => normalizeValidationError(err, artifactId)),
        );
      } else {
        errors.push({
          file: artifactId,
          message: 'Validation failed.',
        });
      }
    }
  }

  return { passed, errors };
}

/** Single validation error row. */
const ErrorRow: React.FC<{
  err: ValidationError;
}> = ({ err }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'flex-start',
      gap: 6,
      padding: '4px 8px',
      borderBottom: '1px solid #f3f4f6',
      fontSize: '0.68rem',
      fontFamily: 'monospace',
    }}
  >
    <span style={{ color: '#dc2626', flexShrink: 0 }}>✗</span>
    <span style={{ color: '#1f2937', wordBreak: 'break-all', flex: 1 }}>
      {err.file}
      {err.line != null && (
        <span style={{ color: '#6b7280' }}>:{err.line}</span>
      )}
    </span>
    <span
      style={{
        color: '#991b1b',
        fontSize: '0.62rem',
        maxWidth: 160,
        flexShrink: 0,
        textAlign: 'right',
        lineHeight: 1.4,
      }}
    >
      {err.message}
    </span>
  </div>
);

const ValidationCard: React.FC<ValidationCardProps> = ({
  projectRoot,
  changeId,
  artifactId,
}) => {
  const [mechData, setMechData] =
    useState<MechanicalValidationResponse | null>(null);
  const [semData, setSemData] = useState<unknown>(null);
  const [mechLoading, setMechLoading] = useState(false);
  const [semLoading, setSemLoading] = useState(false);
  const [mechError, setMechError] = useState<string | null>(null);
  const [semError, setSemError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [showSemantic, setShowSemantic] = useState(false);

  // ── Mechanical validation ──
  const fetchMechanical = useCallback(async () => {
    if (!projectRoot || !changeId) return;

    setMechLoading(true);
    setMechError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['validate', '--change', changeId, '--mechanical', '--json'],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setMechError('Mechanical validation was cancelled.');
        setMechData(null);
        return;
      }

      const parsed = parseMechanicalValidationResponse(event.parsedJson);

      if (event.exitCode !== 0 && !parsed) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setMechError(errMsg);
        setMechData(null);
        return;
      }

      if (parsed) {
        setMechData(parsed);
        setMechError(null);
      } else {
        setMechError('Unexpected response shape from mechanical validation.');
        setMechData(null);
      }
    } catch (e) {
      setMechError(
        e instanceof Error
          ? e.message
          : 'Unknown error running mechanical validation.',
      );
      setMechData(null);
    } finally {
      setMechLoading(false);
    }
  }, [projectRoot, changeId]);

  // ── Semantic validation ──
  const fetchSemantic = useCallback(async () => {
    if (!projectRoot || !changeId) return;

    setSemLoading(true);
    setSemError(null);

    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['validate', '--change', changeId, '--semantic', '--json'],
        cwd: projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setSemError('Semantic validation was cancelled.');
        setSemData(null);
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setSemError(errMsg);
        setSemData(null);
        return;
      }

      setSemData(event.parsedJson);
      setSemError(null);
    } catch (e) {
      setSemError(
        e instanceof Error
          ? e.message
          : 'Unknown error running semantic validation.',
      );
      setSemData(null);
    } finally {
      setSemLoading(false);
    }
  }, [projectRoot, changeId]);

  useEffect(() => {
    if (projectRoot && changeId) {
      fetchMechanical();
      fetchSemantic();
    } else {
      setMechData(null);
      setMechError(null);
      setSemData(null);
      setSemError(null);
    }
  }, [projectRoot, changeId, fetchMechanical, fetchSemantic]);

  // Auto-refresh after CLI commands complete
  useEffect(() => {
    const unsub = window.openadab.onCommandComplete((_event: CommandEvent) => {
      if (projectRoot && changeId) {
        fetchMechanical();
        fetchSemantic();
      }
    });
    return unsub;
  }, [projectRoot, changeId, fetchMechanical, fetchSemantic]);

  const anyLoading = mechLoading || semLoading;
  const anyError = mechError || semError;

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
            ? mechData && !mechData.passed
              ? '#fef2f2'
              : '#eff6ff'
            : '#fafafa',
          borderRadius: isExpanded ? '6px 6px 0 0' : 6,
        }}
      >
        <span style={{ fontSize: '0.85rem' }}>🔍</span>
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#1d4ed8',
          }}
        >
          Validation Center
        </span>
        {mechData && (
          <span
            style={{
              padding: '1px 6px',
              borderRadius: 3,
              fontSize: '0.6rem',
              fontWeight: 600,
              backgroundColor: mechData.passed ? '#f0fdf4' : '#fef2f2',
              color: mechData.passed ? '#166534' : '#dc2626',
              border: `1px solid ${mechData.passed ? '#bbf7d0' : '#fecaca'}`,
            }}
          >
            {mechData.passed ? 'PASS' : 'FAIL'}
          </span>
        )}
        {anyLoading && (
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
        {anyError && !anyLoading && (
          <span style={{ fontSize: '0.65rem', color: '#dc2626' }}>Error</span>
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

      {/* Compact mode */}
      {!isExpanded && mechData && (
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '6px 12px',
            fontSize: '0.68rem',
            color: '#374151',
          }}
        >
          Mechanical: {mechData.passed ? 'Passed' : `${mechData.errors.length} errors`}
          {semData != null && (
            <span style={{ color: '#6b7280' }}>
              {' '}
              · Semantic: review prompt available
            </span>
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
          {anyLoading && !mechData && !semData && (
            <div
              style={{
                padding: 16,
                textAlign: 'center',
                color: '#6b7280',
                fontSize: '0.72rem',
              }}
            >
              Running validations…
            </div>
          )}

          {/* Mechanical validation section */}
          {mechError && !mechLoading && (
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
                Mechanical: {mechError}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchMechanical();
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

          {mechData && (
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '6px 12px',
                  backgroundColor: mechData.passed ? '#f0fdf4' : '#fef2f2',
                  borderBottom: '1px solid #e5e7eb',
                  gap: 6,
                }}
              >
                <span
                  style={{
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: mechData.passed ? '#166534' : '#dc2626',
                  }}
                >
                  {mechData.passed ? '✓ Mechanical' : '✗ Mechanical'}
                </span>
                <span
                  style={{
                    fontSize: '0.62rem',
                    color: '#6b7280',
                  }}
                >
                  {mechData.passed
                    ? 'All checks passed'
                    : `${mechData.errors.length} error${mechData.errors.length !== 1 ? 's' : ''}`}
                </span>
              </div>
              {mechData.errors.length > 0 && (
                <div>
                  {mechData.errors.map((err, i) => (
                    <ErrorRow key={i} err={err} />
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Semantic validation section */}
          {semError && !semLoading && (
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
                Semantic: {semError}
              </div>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  fetchSemantic();
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

          {semData != null && (
            <div>
              <div
                onClick={() => setShowSemantic((p) => !p)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ')
                    setShowSemantic((p) => !p);
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  padding: '5px 12px',
                  backgroundColor: '#fffbeb',
                  borderBottom: '1px solid #fde68a',
                  cursor: 'pointer',
                  userSelect: 'none',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: '0.62rem', color: '#92400e' }}>
                  {showSemantic ? '▼' : '▶'}
                </span>
                <span
                  style={{
                    fontSize: '0.68rem',
                    fontWeight: 600,
                    color: '#92400e',
                  }}
                >
                  Review Prompt / Manual Semantic Review
                </span>
              </div>
              {showSemantic && (
                <pre
                  style={{
                    margin: 0,
                    padding: 10,
                    fontSize: '0.65rem',
                    fontFamily: 'monospace',
                    color: '#374151',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    lineHeight: 1.5,
                    maxHeight: 200,
                    overflow: 'auto',
                    backgroundColor: '#fffbeb',
                  }}
                >
                  {typeof semData === 'string'
                    ? semData
                    : JSON.stringify(semData, null, 2)}
                </pre>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ValidationCard;
