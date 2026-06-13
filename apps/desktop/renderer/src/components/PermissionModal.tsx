/**
 * PermissionModal — modal overlay for agent permission requests.
 *
 * Displays when an agent requests a capability that requires explicit user
 * approval (canon mutations, CLI execution, or first-time low-risk capabilities).
 * Shows the capability name, scope details, command/diff preview where applicable,
 * and provides approve/deny buttons with an optional reason for denial.
 *
 * Canon-mutation capabilities display a warning banner.
 */

import React, { useState } from 'react';
import type {
  PermissionRequest,
  AgentCapability,
  PermissionResponse,
} from '../../../shared/ipc-types.js';

interface PermissionModalProps {
  /** The pending permission request. */
  request: PermissionRequest;
  /** Called when user approves the request. */
  onApprove: (response: PermissionResponse) => void;
  /** Called when user denies the request. */
  onDeny: (response: PermissionResponse) => void;
}

/** Human-readable labels for capabilities. */
const CAPABILITY_LABELS: Record<AgentCapability, string> = {
  read_project_file: 'Read Project File',
  write_artifact_draft: 'Write Artifact Draft',
  run_cli: 'Run CLI Command',
  modify_wiki: 'Modify Wiki',
  modify_manuscript: 'Modify Manuscript',
  apply_wiki_diff: 'Apply Wiki Diff',
  sync_change: 'Sync Change',
  archive_change: 'Archive Change',
};

/** Descriptions for each capability. */
const CAPABILITY_DESCRIPTIONS: Record<AgentCapability, string> = {
  read_project_file: 'The agent wants to read a file within the project.',
  write_artifact_draft: 'The agent wants to write or update an artifact draft file.',
  run_cli: 'The agent wants to execute a CLI command.',
  modify_wiki: 'The agent wants to modify wiki pages.',
  modify_manuscript: 'The agent wants to modify manuscript chapters.',
  apply_wiki_diff: 'The agent wants to apply wiki diff operations.',
  sync_change: 'The agent wants to run the sync workflow for a change.',
  archive_change: 'The agent wants to archive a completed change.',
};

/** Capabilities that mutate canon — display a warning. */
const CANON_MUTATIONS: ReadonlySet<AgentCapability> = new Set([
  'modify_wiki',
  'modify_manuscript',
  'apply_wiki_diff',
  'sync_change',
  'archive_change',
]);

/** Icons for capabilities. */
const CAPABILITY_ICONS: Record<AgentCapability, string> = {
  read_project_file: '\u{1F4C4}',
  write_artifact_draft: '\u{270F}\u{FE0F}',
  run_cli: '\u{1F4BB}',
  modify_wiki: '\u{1F4D6}',
  modify_manuscript: '\u{1F4DD}',
  apply_wiki_diff: '\u{1F504}',
  sync_change: '\u{1F504}',
  archive_change: '\u{1F4E6}',
};

const PermissionModal: React.FC<PermissionModalProps> = ({
  request,
  onApprove,
  onDeny,
}) => {
  const [reason, setReason] = useState('');
  const [showDenyReason, setShowDenyReason] = useState(false);

  const isCanonMutation = CANON_MUTATIONS.has(request.capability);
  const icon = CAPABILITY_ICONS[request.capability] ?? '\u{1F6AB}';
  const label = CAPABILITY_LABELS[request.capability] ?? request.capability;

  const handleApprove = (): void => {
    onApprove({ requestId: request.id, approved: true });
  };

  const handleDeny = (): void => {
    onDeny({ requestId: request.id, approved: false, reason: reason || undefined });
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.45)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        fontFamily: 'system-ui, sans-serif',
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          /* Keep modal open — require explicit decision */
        }
      }}
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 8,
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.18)',
          maxWidth: 520,
          width: '90%',
          maxHeight: '80vh',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            padding: '16px 20px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: isCanonMutation ? '#fef3c7' : '#f9fafb',
          }}
        >
          <span style={{ fontSize: '1.4rem' }}>{icon}</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '0.85rem',
                fontWeight: 700,
                color: '#111827',
              }}
            >
              {label}
            </div>
            <div
              style={{
                fontSize: '0.7rem',
                color: '#6b7280',
                marginTop: 2,
              }}
            >
              Agent Permission Request
            </div>
          </div>
          {isCanonMutation && (
            <span
              style={{
                fontSize: '0.62rem',
                fontWeight: 600,
                color: '#92400e',
                backgroundColor: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: 4,
                padding: '2px 8px',
              }}
            >
              Canon Mutation
            </span>
          )}
        </div>

        {/* Body */}
        <div
          style={{
            padding: '16px 20px',
            overflow: 'auto',
            flex: 1,
          }}
        >
          {/* Description */}
          <p
            style={{
              margin: '0 0 12px 0',
              fontSize: '0.8rem',
              color: '#374151',
              lineHeight: 1.5,
            }}
          >
            {CAPABILITY_DESCRIPTIONS[request.capability] ??
              `The agent is requesting capability: ${request.capability}`}
          </p>

          {/* Scope */}
          {request.scope.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                Scope
              </div>
              <div
                style={{
                  backgroundColor: '#f3f4f6',
                  borderRadius: 4,
                  padding: '8px 12px',
                  maxHeight: 120,
                  overflow: 'auto',
                }}
              >
                {request.scope.map((item, i) => (
                  <div
                    key={i}
                    style={{
                      fontSize: '0.72rem',
                      fontFamily: 'monospace',
                      color: '#1f2937',
                      padding: '2px 0',
                    }}
                  >
                    {item}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Command Preview */}
          {request.commandPreview && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                Command Preview
              </div>
              <pre
                style={{
                  backgroundColor: '#1f2937',
                  color: '#f9fafb',
                  borderRadius: 4,
                  padding: '10px 14px',
                  fontSize: '0.72rem',
                  fontFamily: 'monospace',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {request.commandPreview}
              </pre>
            </div>
          )}

          {/* Diff Preview */}
          {request.diffPreview != null && (
            <div style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: '0.68rem',
                  fontWeight: 600,
                  color: '#6b7280',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 6,
                }}
              >
                Diff Preview
              </div>
              <pre
                style={{
                  backgroundColor: '#f3f4f6',
                  borderRadius: 4,
                  padding: '10px 14px',
                  fontSize: '0.7rem',
                  fontFamily: 'monospace',
                  margin: 0,
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                  maxHeight: 200,
                  overflow: 'auto',
                  color: '#1f2937',
                }}
              >
                {typeof request.diffPreview === 'string'
                  ? request.diffPreview
                  : JSON.stringify(request.diffPreview, null, 2)}
              </pre>
            </div>
          )}

          {/* Canon Mutation Warning */}
          {isCanonMutation && (
            <div
              style={{
                backgroundColor: '#fef3c7',
                border: '1px solid #f59e0b',
                borderRadius: 6,
                padding: '10px 14px',
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  fontSize: '0.72rem',
                  fontWeight: 600,
                  color: '#92400e',
                  marginBottom: 4,
                }}
              >
                {'\u26A0'}&nbsp; This action modifies project canon
              </div>
              <div
                style={{
                  fontSize: '0.68rem',
                  color: '#78350f',
                  lineHeight: 1.4,
                }}
              >
                Canon mutations permanently alter your project's wiki pages,
                manuscript chapters, or change history. This cannot be
                automatically undone. Please review carefully before approving.
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            borderTop: '1px solid #e5e7eb',
            padding: '14px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Deny reason */}
          {showDenyReason && (
            <div>
              <input
                type="text"
                placeholder="Reason for denial (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                style={{
                  width: '100%',
                  boxSizing: 'border-box',
                  padding: '6px 10px',
                  borderRadius: 4,
                  border: '1px solid #d1d5db',
                  fontSize: '0.75rem',
                  fontFamily: 'system-ui, sans-serif',
                }}
              />
            </div>
          )}

          {/* Buttons */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              justifyContent: 'flex-end',
            }}
          >
            {!showDenyReason ? (
              <button
                type="button"
                onClick={() => setShowDenyReason(true)}
                style={{
                  padding: '7px 16px',
                  borderRadius: 5,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#6b7280',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Deny
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setShowDenyReason(false);
                  setReason('');
                }}
                style={{
                  padding: '7px 16px',
                  borderRadius: 5,
                  border: '1px solid #d1d5db',
                  backgroundColor: '#ffffff',
                  color: '#6b7280',
                  fontSize: '0.78rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                }}
              >
                Cancel
              </button>
            )}

            {showDenyReason && (
              <button
                type="button"
                onClick={handleDeny}
                style={{
                  padding: '7px 16px',
                  borderRadius: 5,
                  border: 'none',
                  backgroundColor: '#dc2626',
                  color: '#ffffff',
                  fontSize: '0.78rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Confirm Deny
              </button>
            )}

            <button
              type="button"
              onClick={handleApprove}
              style={{
                padding: '7px 20px',
                borderRadius: 5,
                border: 'none',
                backgroundColor: isCanonMutation ? '#f59e0b' : '#059669',
                color: '#ffffff',
                fontSize: '0.78rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {isCanonMutation ? 'Approve Canon Mutation' : 'Approve'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PermissionModal;
