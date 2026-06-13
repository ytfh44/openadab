/**
 * ArtifactNode — single node in the artifact DAG.
 *
 * Renders a card showing artifact ID, status indicator (color-coded dot),
 * generated file name, dependency list, blocking issues with warning icon,
 * and validation issue indicators.
 *
 * Schema-generic: all data comes from the ArtifactStatus parsed from CLI JSON.
 */

import React from 'react';
import type { ArtifactStatus, ValidationResult } from '../types/changes.js';
import { STATUS_COLORS } from '../types/changes.js';

interface ArtifactNodeProps {
  /** The artifact data parsed from CLI status JSON. */
  artifact: ArtifactStatus;
  /** Whether this node is currently selected (focused) by the user. */
  isSelected?: boolean;
  /** Called when the user clicks this node to select it. */
  onSelect?: (artifactId: string) => void;
}

/** Extract a short file name from a path for display. */
function shortFileName(path: string | null | undefined): string | null {
  if (!path) return null;
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] ?? path;
}

/** Count total validation issues across errors and warnings. */
function validationCount(v?: ValidationResult): number {
  if (!v) return 0;
  return (v.errors?.length ?? 0) + (v.warnings?.length ?? 0);
}

const ArtifactNode: React.FC<ArtifactNodeProps> = ({
  artifact,
  isSelected,
  onSelect,
}) => {
  const colors = STATUS_COLORS[artifact.status];
  const hasBlocking = (artifact.blockingIssues?.length ?? 0) > 0;
  const vCount = validationCount(artifact.validations);
  const hasValidationErrors = (artifact.validations?.errors?.length ?? 0) > 0;
  const deps = artifact.dependencies ?? [];

  const handleClick = () => {
    onSelect?.(artifact.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect?.(artifact.id);
    }
  };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        padding: '10px 14px',
        border: `2px solid ${isSelected ? '#2563eb' : colors.border}`,
        borderRadius: 8,
        backgroundColor: isSelected ? '#eff6ff' : colors.bg,
        cursor: 'pointer',
        minWidth: 180,
        maxWidth: 260,
        fontFamily: 'system-ui, sans-serif',
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: isSelected
          ? '0 0 0 2px rgba(37, 99, 235, 0.3)'
          : '0 1px 3px rgba(0,0,0,0.06)',
        position: 'relative',
        userSelect: 'none',
      }}
    >
      {/* Top row: status dot + artifact ID */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {/* Status dot */}
        <span
          title={colors.label}
          style={{
            width: 10,
            height: 10,
            borderRadius: '50%',
            backgroundColor: colors.dot,
            flexShrink: 0,
          }}
        />

        {/* Artifact ID */}
        <span
          style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            color: colors.text,
            fontFamily: 'monospace',
          }}
        >
          {artifact.id}
        </span>

        {/* Status label */}
        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            color: colors.dot,
            marginLeft: 'auto',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          {colors.label}
        </span>
      </div>

      {/* Generated file name */}
      {artifact.generatedFile && (
        <div
          style={{
            fontSize: '0.65rem',
            color: '#6b7280',
            fontFamily: 'monospace',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
          title={artifact.generatedFile}
        >
          {shortFileName(artifact.generatedFile)}
        </div>
      )}

      {/* Dependencies */}
      {deps.length > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            flexWrap: 'wrap',
            marginTop: 2,
          }}
        >
          <span
            style={{
              fontSize: '0.6rem',
              fontWeight: 600,
              color: '#9ca3af',
            }}
          >
            deps:
          </span>
          {deps.map((dep) => (
            <span
              key={dep}
              style={{
                fontSize: '0.6rem',
                fontFamily: 'monospace',
                color: '#6b7280',
                backgroundColor: '#f3f4f6',
                padding: '1px 5px',
                borderRadius: 3,
              }}
            >
              {dep}
            </span>
          ))}
        </div>
      )}

      {/* Blocking issues warning */}
      {hasBlocking && (
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 4,
            marginTop: 4,
            padding: '4px 6px',
            backgroundColor: '#fef2f2',
            borderRadius: 4,
            border: '1px solid #fecaca',
          }}
        >
          <span style={{ fontSize: '0.7rem', flexShrink: 0 }}>⚠</span>
          <div
            style={{
              fontSize: '0.62rem',
              color: '#991b1b',
              lineHeight: 1.3,
            }}
          >
            {artifact.blockingIssues!.map((issue, i) => (
              <div key={i}>{issue}</div>
            ))}
          </div>
        </div>
      )}

      {/* Validation issues indicator */}
      {vCount > 0 && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            marginTop: 4,
            fontSize: '0.62rem',
            fontWeight: 600,
            color: hasValidationErrors ? '#dc2626' : '#d97706',
          }}
        >
          <span>
            {hasValidationErrors ? '✗' : '!'}
          </span>
          <span>
            {vCount} validation {vCount === 1 ? 'issue' : 'issues'}
          </span>
        </div>
      )}
    </div>
  );
};

export default ArtifactNode;
