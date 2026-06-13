/**
 * ChangesWorkbench — main route for the Changes workbench.
 *
 * Orchestrates the change selection, artifact DAG rendering, lifecycle
 * actions (sync, archive), new change creation, and apply-ready indication.
 *
 * All artifact data is parsed generically from CLI status JSON without
 * hardcoding any artifact names, statuses, or dependency structures.
 *
 * Handles loading, empty, error, missing-change, command-failure,
 * and stale-data states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type {
  ProjectInfo,
  CommandEvent,
} from '../../../shared/ipc-types.js';
import type {
  ArtifactStatus,
  ChangeStatus,
} from '../types/changes.js';
import ChangeSelector from '../components/ChangeSelector.js';
import ArtifactDAG from '../components/ArtifactDAG.js';
import NewChangeDialog from '../components/NewChangeDialog.js';

interface ChangesWorkbenchProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is still loading. */
  loading: boolean;
  /** Called when the user selects an artifact from the DAG. */
  onSelectArtifact?: (changeId: string, artifactId: string, artifact: ArtifactStatus) => void;
  /** Currently selected artifact (for wiring back). */
  selectedArtifactId?: string | null;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.map(String) : undefined;
}

function normalizeGeneratedFile(
  item: Record<string, unknown>,
  changeId: string,
): string | null | undefined {
  if ('generatedFile' in item) {
    const value = item['generatedFile'];
    if (value === null) return null;
    if (value === undefined) return undefined;
    return String(value);
  }

  if (item['generates'] === undefined) return undefined;

  const generated = String(item['generates']).replace(/^[/\\]+/, '');
  return changeId ? `adab/changes/${changeId}/${generated}` : generated;
}

function normalizeNextStep(value: unknown): ArtifactStatus['nextStep'] {
  if (!isRecord(value)) return undefined;

  const action = value['action'] !== undefined ? String(value['action']) : '';
  const target =
    value['applyTarget'] !== undefined
      ? String(value['applyTarget'])
      : value['target'] !== undefined
        ? String(value['target'])
        : undefined;

  return {
    applyTarget: action === 'apply' ? target : value['applyTarget'] !== undefined ? target : undefined,
    instruction:
      value['instruction'] !== undefined
        ? String(value['instruction'])
        : action
          ? action
          : undefined,
  };
}

function collectIssuesByArtifact(value: unknown): Map<string, string[]> {
  const byArtifact = new Map<string, string[]>();
  if (!Array.isArray(value)) return byArtifact;

  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const artifactId = raw['artifactId'] ?? raw['id'];
    if (artifactId === undefined) continue;

    const reasons = byArtifact.get(String(artifactId)) ?? [];
    if (raw['reason'] !== undefined) {
      reasons.push(String(raw['reason']));
    }
    if (Array.isArray(raw['missingDeps']) && raw['missingDeps'].length > 0) {
      reasons.push(`Missing dependencies: ${raw['missingDeps'].map(String).join(', ')}`);
    }
    byArtifact.set(String(artifactId), reasons);
  }

  return byArtifact;
}

/**
 * Parse the CLI status JSON output into a ChangeStatus structure.
 *
 * Supports both the desktop-friendly shape used by older tests and the
 * current CLI shape:
 *   { changeName, schemaName, artifacts: [{ generates, requires }], nextStep: [...] }
 *
 * Returns null if the parsed output does not contain an artifacts array.
 */
export function parseStatusJson(parsed: unknown): ChangeStatus | null {
  if (!isRecord(parsed)) return null;

  const obj = parsed;
  const artifactsRaw = obj['artifacts'];
  if (!Array.isArray(artifactsRaw)) return null;

  const changeId = String(obj['changeId'] ?? obj['changeName'] ?? '');
  const nextSteps = Array.isArray(obj['nextStep'])
    ? obj['nextStep'].filter(isRecord)
    : [];
  const nextStepByArtifact = new Map<string, ArtifactStatus['nextStep']>();
  let applyStep: ArtifactStatus['nextStep'] | undefined;

  for (const step of nextSteps) {
    const normalized = normalizeNextStep(step);
    const id = step['id'] !== undefined ? String(step['id']) : '';
    if (id) {
      nextStepByArtifact.set(id, normalized);
    }
    if (String(step['action'] ?? '') === 'apply') {
      applyStep = normalized;
    }
  }

  const blockingIssues = collectIssuesByArtifact(obj['blockingIssues']);
  const validationIssues = collectIssuesByArtifact(obj['validationIssues']);

  const artifacts: ArtifactStatus[] = artifactsRaw.map((a: unknown, index): ArtifactStatus => {
    const item = isRecord(a) ? a : {};
    const id = String(item['id'] ?? '');
    const issueReasons = blockingIssues.get(id);
    const validationReasons = validationIssues.get(id) ?? [];
    const itemValidations = isRecord(item['validations'])
      ? item['validations'] as NonNullable<ArtifactStatus['validations']>
      : undefined;
    const validationErrors = validationReasons.map((message) => ({ message }));
    const validations =
      validationErrors.length > 0
        ? {
          ...itemValidations,
          errors: [
            ...(itemValidations?.errors ?? []),
            ...validationErrors,
          ],
        }
        : itemValidations;

    return {
      id,
      status: (item['status'] as ArtifactStatus['status']) ?? 'blocked',
      generatedFile: normalizeGeneratedFile(item, changeId),
      dependencies: toStringArray(item['dependencies']) ?? toStringArray(item['requires']),
      validations,
      blockingIssues:
        toStringArray(item['blockingIssues']) ??
        (issueReasons && issueReasons.length > 0 ? issueReasons : undefined),
      nextStep:
        normalizeNextStep(item['nextStep']) ??
        nextStepByArtifact.get(id) ??
        (index === artifactsRaw.length - 1 ? applyStep : undefined),
    };
  });

  return {
    changeId,
    artifacts,
    schemaType:
      obj['schemaType'] !== undefined
        ? String(obj['schemaType'])
        : obj['schemaName'] !== undefined
          ? String(obj['schemaName'])
        : undefined,
  };
}

/**
 * Check whether all artifacts in the change are in 'done' status.
 * Optional artifacts are not required to be done.
 */
export function allArtifactsDone(artifacts: ArtifactStatus[]): boolean {
  if (artifacts.length === 0) return false;
  return artifacts.every(
    (a) => a.status === 'done' || a.status === 'optional',
  );
}

/**
 * Check whether any artifact has validation errors.
 */
export function hasValidationErrors(artifacts: ArtifactStatus[]): boolean {
  return artifacts.some(
    (a) => (a.validations?.errors?.length ?? 0) > 0,
  );
}

/**
 * Check whether any artifact reports an apply target via nextStep.
 */
export function isApplyReady(artifacts: ArtifactStatus[]): boolean {
  return artifacts.some(
    (a) => a.nextStep?.applyTarget !== undefined,
  );
}

/** Confirmation dialog component reused for sync and archive. */
const ConfirmDialog: React.FC<{
  title: string;
  message: string;
  confirmLabel: string;
  confirmColor: string;
  running: boolean;
  error: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  title,
  message,
  confirmLabel,
  confirmColor,
  running,
  error,
  onConfirm,
  onCancel,
}) => (
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
    onClick={onCancel}
    onKeyDown={(e) => {
      if (e.key === 'Escape' && !running) onCancel();
    }}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        backgroundColor: '#fff',
        borderRadius: 8,
        padding: '24px 28px',
        minWidth: 360,
        maxWidth: 460,
        boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <h3
        style={{
          margin: '0 0 8px 0',
          fontSize: '1rem',
          fontWeight: 700,
          color: '#1f2937',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          margin: '0 0 16px 0',
          fontSize: '0.82rem',
          color: '#6b7280',
          lineHeight: 1.5,
        }}
      >
        {message}
      </p>

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

      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        <button
          type="button"
          onClick={onCancel}
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
          onClick={onConfirm}
          disabled={running}
          style={{
            padding: '7px 16px',
            border: 'none',
            borderRadius: 4,
            backgroundColor: running ? '#9ca3af' : confirmColor,
            color: '#fff',
            fontSize: '0.78rem',
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
          {running ? 'Running…' : confirmLabel}
        </button>
      </div>
    </div>
  </div>
  );

const ChangesWorkbench: React.FC<ChangesWorkbenchProps> = ({
  projectInfo,
  loading,
  onSelectArtifact,
  selectedArtifactId: externalSelectedArtifactId,
}) => {
  // ── State ──
  const [selectedChangeId, setSelectedChangeId] = useState<string | null>(null);
  const [statusData, setStatusData] = useState<ChangeStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [knownChangeIds, setKnownChangeIds] = useState<string[]>([]);
  const [internalSelectedArtifactId, setInternalSelectedArtifactId] =
    useState<string | null>(null);
  const [showNewDialog, setShowNewDialog] = useState(false);

  // Use external artifact ID if provided, otherwise internal
  const selectedArtifactId =
    externalSelectedArtifactId !== undefined
      ? externalSelectedArtifactId
      : internalSelectedArtifactId;

  const setSelectedArtifactId = useCallback(
    (id: string | null) => {
      setInternalSelectedArtifactId(id);
      // Notify parent when artifact is selected or deselected
      if (id && selectedChangeId && statusData && onSelectArtifact) {
        const artifact = statusData.artifacts.find((a) => a.id === id);
        if (artifact) {
          onSelectArtifact(selectedChangeId, id, artifact);
        }
      } else if (id === null && onSelectArtifact) {
        // Pass null artifact to indicate deselection
        onSelectArtifact('', '', { id: '', status: 'blocked' });
      }
    },
    [selectedChangeId, statusData, onSelectArtifact],
  );

  // Sync/archive action state
  const [syncRunning, setSyncRunning] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showSyncConfirm, setShowSyncConfirm] = useState(false);
  const [archiveRunning, setArchiveRunning] = useState(false);
  const [archiveError, setArchiveError] = useState<string | null>(null);
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false);

  // ── Fetch change status ──
  const fetchStatus = useCallback(
    async (changeId: string) => {
      if (!projectInfo) return;

      setStatusLoading(true);
      setStatusError(null);

      try {
        const event = await window.openadab.runCli({
          commandId: genCommandId(),
          args: ['status', '--change', changeId, '--json'],
          cwd: projectInfo.projectRoot,
          initiator: 'user',
        });

        if (event.cancelled) {
          setStatusError('Status command was cancelled.');
          setStatusData(null);
          return;
        }

        if (event.exitCode !== 0) {
          const errMsg =
            event.parseError ??
            event.stderr.trim() ??
            `Command exited with code ${event.exitCode ?? 'unknown'}`;
          setStatusError(errMsg);
          setStatusData(null);
          return;
        }

        const parsed = parseStatusJson(event.parsedJson);
        if (!parsed) {
          setStatusError('Failed to parse status JSON output.');
          setStatusData(null);
          return;
        }

        setStatusData(parsed);
        setStatusError(null);

        // Add to known change IDs if not already present
        setKnownChangeIds((prev) => {
          if (prev.includes(changeId)) return prev;
          return [...prev, changeId];
        });
      } catch (e) {
        setStatusError(
          e instanceof Error ? e.message : 'Unknown error fetching status.',
        );
        setStatusData(null);
      } finally {
        setStatusLoading(false);
      }
    },
    [projectInfo],
  );

  /** Handle change selection from ChangeSelector. */
  const handleSelectChange = useCallback(
    (changeId: string) => {
      setSelectedChangeId(changeId);
      setSelectedArtifactId(null);
      setStatusData(null);
      setStatusError(null);
      fetchStatus(changeId);
    },
    [fetchStatus],
  );

  // ── Auto-refresh on command completion ──
  useEffect(() => {
    const unsub = window.openadab.onCommandComplete((event: CommandEvent) => {
      // Refresh if a relevant command completed for the current change
      if (!selectedChangeId || !projectInfo) return;

      const args = event.args;
      const argStr = args.join(' ');
      const isRelevant =
        argStr.includes(`--change ${selectedChangeId}`) ||
        argStr.includes(selectedChangeId) ||
        args.includes(selectedChangeId);

      if (isRelevant && event.initiator !== 'auto-refresh') {
        fetchStatus(selectedChangeId);
      }
    });
    return unsub;
  }, [selectedChangeId, projectInfo, fetchStatus]);

  // ── Sync action ──
  const handleSync = useCallback(async () => {
    if (!projectInfo || !selectedChangeId) return;

    setSyncRunning(true);
    setSyncError(null);

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['sync', '--change', selectedChangeId, '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      setShowSyncConfirm(false);

      if (event.cancelled) {
        setSyncError('Sync was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setSyncError(errMsg);
        return;
      }

      // Refresh status after sync
      fetchStatus(selectedChangeId);
    } catch (e) {
      setSyncError(e instanceof Error ? e.message : 'Sync failed.');
    } finally {
      setSyncRunning(false);
    }
  }, [projectInfo, selectedChangeId, fetchStatus]);

  // ── Archive action ──
  const handleArchive = useCallback(async () => {
    if (!projectInfo || !selectedChangeId) return;

    setArchiveRunning(true);
    setArchiveError(null);

    try {
      const event = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['archive', selectedChangeId, '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      setShowArchiveConfirm(false);

      if (event.cancelled) {
        setArchiveError('Archive was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Command exited with code ${event.exitCode ?? 'unknown'}`;
        setArchiveError(errMsg);
        return;
      }

      // Refresh status after archive
      fetchStatus(selectedChangeId);
    } catch (e) {
      setArchiveError(e instanceof Error ? e.message : 'Archive failed.');
    } finally {
      setArchiveRunning(false);
    }
  }, [projectInfo, selectedChangeId, fetchStatus]);

  // ── New change created ──
  const handleNewChangeCreated = useCallback(
    (changeId: string, _changeType: string) => {
      setShowNewDialog(false);
      handleSelectChange(changeId);
    },
    [handleSelectChange],
  );

  // ── Derived state ──
  const artifacts = statusData?.artifacts ?? [];
  const applyReady = isApplyReady(artifacts);
  const validationBlocked = hasValidationErrors(artifacts);
  const allDone = allArtifactsDone(artifacts);
  const syncGated = statusData !== null && !validationBlocked && !statusLoading;
  const archiveGated =
    statusData !== null && allDone && !statusLoading;

  // ── Loading state (initial app load) ──
  if (loading) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 16,
          }}
        >
          <span
            style={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              border: '3px solid #d1d5db',
              borderTopColor: '#3b82f6',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Loading project workspace…
          </span>
        </div>
      </div>
    );
  }

  // ── No project open ──
  if (!projectInfo) {
    return (
      <div style={{ fontFamily: 'system-ui, sans-serif' }}>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            gap: 16,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#f3f4f6',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '1.5rem',
              color: '#9ca3af',
            }}
          >
            📂
          </div>
          <h2
            style={{
              margin: 0,
              fontSize: '1.1rem',
              fontWeight: 600,
              color: '#374151',
            }}
          >
            No Project Open
          </h2>
          <p
            style={{
              margin: 0,
              fontSize: '0.85rem',
              color: '#6b7280',
              textAlign: 'center',
            }}
          >
            Open a project to view and manage changes.
          </p>
        </div>
      </div>
    );
  }

  // ── Main layout ──
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {/* Header bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 16px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fafafa',
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#374151',
            marginRight: 'auto',
          }}
        >
          Changes Workbench
        </span>

        {/* Sync button */}
        <button
          type="button"
          disabled={!syncGated || syncRunning}
          title={
            !syncGated
              ? validationBlocked
                ? 'Validation must pass before syncing'
                : 'Load a change to enable sync'
              : ''
          }
          onClick={() => setShowSyncConfirm(true)}
          style={{
            padding: '6px 14px',
            border: `1px solid ${syncGated ? '#2563eb' : '#d1d5db'}`,
            borderRadius: 4,
            backgroundColor: syncGated ? '#eff6ff' : '#f9fafb',
            color: syncGated ? '#1d4ed8' : '#9ca3af',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: syncGated ? 'pointer' : 'not-allowed',
          }}
        >
          {syncRunning ? 'Syncing…' : 'Sync'}
        </button>

        {/* Archive button */}
        <button
          type="button"
          disabled={!archiveGated || archiveRunning}
          title={
            !archiveGated
              ? allDone
                ? 'Load a change to enable archive'
                : 'All artifacts must be done before archiving'
              : ''
          }
          onClick={() => setShowArchiveConfirm(true)}
          style={{
            padding: '6px 14px',
            border: `1px solid ${archiveGated ? '#059669' : '#d1d5db'}`,
            borderRadius: 4,
            backgroundColor: archiveGated ? '#ecfdf5' : '#f9fafb',
            color: archiveGated ? '#047857' : '#9ca3af',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: archiveGated ? 'pointer' : 'not-allowed',
          }}
        >
          {archiveRunning ? 'Archiving…' : 'Archive'}
        </button>
      </div>

      {/* Change selector area */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fff',
        }}
      >
        <ChangeSelector
          selectedChangeId={selectedChangeId}
          changeIds={knownChangeIds}
          loading={false}
          error={null}
          onSelect={handleSelectChange}
          onNewChange={() => setShowNewDialog(true)}
        />
      </div>

      {/* Selected artifact header */}
      {statusData && selectedArtifactId && (
        <div
          style={{
            padding: '8px 16px',
            backgroundColor: '#eff6ff',
            borderBottom: '1px solid #bfdbfe',
            fontSize: '0.75rem',
            color: '#1d4ed8',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <span style={{ fontWeight: 600 }}>Selected:</span>
          <span style={{ fontFamily: 'monospace' }}>
            {selectedArtifactId}
          </span>
          {(() => {
            const art = artifacts.find((a) => a.id === selectedArtifactId);
            if (art?.generatedFile) {
              return (
                <span style={{ color: '#6b7280' }}>
                  → {art.generatedFile}
                </span>
              );
            }
            return null;
          })()}
        </div>
      )}

      {/* DAG or status area */}
      <div style={{ padding: 16 }}>
        {/* Status loading */}
        {statusLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 24px',
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
              Loading change status…
            </span>
          </div>
        )}

        {/* Status error */}
        {!statusLoading && statusError && (
          <div
            style={{
              padding: 12,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              marginBottom: 12,
            }}
          >
            <div
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#dc2626',
                marginBottom: 6,
              }}
            >
              Failed to load change status
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: '0.72rem',
                fontFamily: 'monospace',
                color: '#991b1b',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {statusError}
            </pre>
          </div>
        )}

        {/* No change selected */}
        {!statusLoading && !statusError && !statusData && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 24px',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 48,
                height: 48,
                borderRadius: '50%',
                backgroundColor: '#f3f4f6',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.2rem',
                color: '#9ca3af',
              }}
            >
              📋
            </div>
            <p
              style={{
                margin: 0,
                fontSize: '0.85rem',
                color: '#6b7280',
              }}
            >
              Select or create a change to view its artifact workflow.
            </p>
          </div>
        )}

        {/* Schema type indicator */}
        {statusData?.schemaType && (
          <div
            style={{
              marginBottom: 10,
              fontSize: '0.7rem',
              color: '#6b7280',
              fontFamily: 'monospace',
            }}
          >
            Schema: {statusData.schemaType}
          </div>
        )}

        {/* Apply-ready banner */}
        {applyReady && statusData && (
          <div
            style={{
              marginBottom: 12,
              padding: '8px 14px',
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 6,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontSize: '0.9rem' }}>✅</span>
            <span
              style={{
                fontSize: '0.78rem',
                fontWeight: 600,
                color: '#166534',
              }}
            >
              Apply Ready
            </span>
            <span style={{ fontSize: '0.72rem', color: '#15803d' }}>
              This change is ready to be applied.
            </span>
          </div>
        )}

        {/* Artifact DAG */}
        {statusData && !statusLoading && (
          <ArtifactDAG
            artifacts={artifacts}
            selectedArtifactId={selectedArtifactId}
            onSelectArtifact={setSelectedArtifactId}
          />
        )}

        {/* Sync error display */}
        {syncError && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
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
            Sync failed: {syncError}
          </div>
        )}

        {/* Archive error display */}
        {archiveError && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 12px',
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
            Archive failed: {archiveError}
          </div>
        )}
      </div>

      {/* Sync confirmation dialog */}
      {showSyncConfirm && (
        <ConfirmDialog
          title="Sync Change"
          message={`Are you sure you want to sync change "${selectedChangeId}"? This will orchestrate the full sync workflow.`}
          confirmLabel="Sync"
          confirmColor="#2563eb"
          running={syncRunning}
          error={syncError}
          onConfirm={handleSync}
          onCancel={() => {
            setShowSyncConfirm(false);
            setSyncError(null);
          }}
        />
      )}

      {/* Archive confirmation dialog */}
      {showArchiveConfirm && (
        <ConfirmDialog
          title="Archive Change"
          message={`Are you sure you want to archive change "${selectedChangeId}"? This will move the change to the archive.`}
          confirmLabel="Archive"
          confirmColor="#059669"
          running={archiveRunning}
          error={archiveError}
          onConfirm={handleArchive}
          onCancel={() => {
            setShowArchiveConfirm(false);
            setArchiveError(null);
          }}
        />
      )}

      {/* New change dialog */}
      {showNewDialog && (
        <NewChangeDialog
          projectInfo={projectInfo}
          onClose={() => setShowNewDialog(false)}
          onCreated={handleNewChangeCreated}
        />
      )}
  </div>
  );
};

export default ChangesWorkbench;
