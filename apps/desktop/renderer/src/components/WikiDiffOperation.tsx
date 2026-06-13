/**
 * WikiDiffOperation — single wiki-diff operation detail row.
 *
 * Renders a single operation with expandable detail showing:
 * - Target page, operation type (color-coded badge), source artifact
 * - Warnings summary (toggleable)
 * - Full payload (JSON content changes)
 * - Source evidence string
 *
 * Operation types: add=green, update=blue, remove=red, merge=purple.
 */

import React, { useState } from 'react';
import type { WikiDiffOperation as WikiDiffOp } from '../types/inspector.js';

interface WikiDiffOperationProps {
  /** The wiki-diff operation to display. */
  operation: WikiDiffOp;
  /** Whether this operation is checked for selective apply. */
  checked: boolean;
  /** Called when the checkbox is toggled. */
  onToggle: () => void;
}

/** Color badge config per operation type. */
const OP_BADGE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  add: { bg: '#f0fdf4', text: '#166534', label: 'Add' },
  update: { bg: '#eff6ff', text: '#1d4ed8', label: 'Update' },
  remove: { bg: '#fef2f2', text: '#dc2626', label: 'Remove' },
  merge: { bg: '#faf5ff', text: '#7c3aed', label: 'Merge' },
};

function badgeStyle(type: string): { bg: string; text: string; label: string } {
  return (
    OP_BADGE_STYLES[type] ?? {
      bg: '#f9fafb',
      text: '#6b7280',
      label: type,
    }
  );
}

function prettyJson(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const WikiDiffOperation: React.FC<WikiDiffOperationProps> = ({
  operation,
  checked,
  onToggle,
}) => {
  const [expanded, setExpanded] = useState(false);
  const [showWarnings, setShowWarnings] = useState(false);
  const style = badgeStyle(operation.type);
  const hasWarnings = operation.warnings && operation.warnings.length > 0;

  return (
    <div
      style={{
        borderBottom: '1px solid #e5e7eb',
        backgroundColor: checked ? '#fafafa' : '#fef2f2',
        opacity: checked ? 1 : 0.7,
      }}
    >
      {/* Summary row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 12px',
          fontSize: '0.72rem',
        }}
      >
        {/* Checkbox */}
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            cursor: 'pointer',
            flexShrink: 0,
          }}
        >
          <input
            type="checkbox"
            checked={checked}
            onChange={onToggle}
            style={{ cursor: 'pointer' }}
          />
        </label>

        {/* Type badge */}
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 3,
            fontSize: '0.6rem',
            fontWeight: 600,
            backgroundColor: style.bg,
            color: style.text,
            flexShrink: 0,
            minWidth: 48,
            textAlign: 'center',
          }}
        >
          {style.label}
        </span>

        {/* Target page */}
        <span
          style={{
            fontFamily: 'monospace',
            color: '#1f2937',
            flex: 1,
            wordBreak: 'break-all',
            lineHeight: 1.4,
            fontWeight: 500,
          }}
        >
          {operation.target}
        </span>

        {/* Source */}
        <span
          style={{
            color: '#6b7280',
            fontSize: '0.65rem',
            maxWidth: 120,
            flexShrink: 0,
            textAlign: 'right',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {operation.source}
        </span>

        {/* Warnings indicator */}
        {hasWarnings && (
          <span
            style={{
              color: '#d97706',
              fontSize: '0.6rem',
              fontWeight: 600,
              flexShrink: 0,
              cursor: 'pointer',
            }}
            onClick={(e) => {
              e.stopPropagation();
              setShowWarnings((p) => !p);
            }}
          >
            ⚠ {operation.warnings!.length}
          </span>
        )}

        {/* Expand toggle */}
        <span
          style={{
            color: '#9ca3af',
            fontSize: '0.65rem',
            flexShrink: 0,
            cursor: 'pointer',
            userSelect: 'none',
          }}
          onClick={() => setExpanded((p) => !p)}
        >
          {expanded ? '▲' : '▼'}
        </span>
      </div>

      {/* Warnings detail */}
      {showWarnings && hasWarnings && (
        <div
          style={{
            padding: '4px 12px 4px 60px',
            borderTop: '1px solid #fef3c7',
            backgroundColor: '#fffbeb',
          }}
        >
          {operation.warnings!.map((w, i) => (
            <div
              key={i}
              style={{
                fontSize: '0.62rem',
                color: '#92400e',
                lineHeight: 1.5,
              }}
            >
              ⚠ {w}
            </div>
          ))}
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div
          style={{
            padding: '8px 12px 10px 60px',
            borderTop: '1px solid #f3f4f6',
            backgroundColor: '#fafafa',
          }}
        >
          {/* Source evidence */}
          <div style={{ marginBottom: 8 }}>
            <div
              style={{
                fontSize: '0.6rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: 2,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Source
            </div>
            <div
              style={{
                fontSize: '0.68rem',
                fontFamily: 'monospace',
                color: '#374151',
                backgroundColor: '#f3f4f6',
                padding: '4px 8px',
                borderRadius: 3,
                wordBreak: 'break-all',
              }}
            >
              {operation.source}
            </div>
          </div>

          {/* Full payload */}
          <div>
            <div
              style={{
                fontSize: '0.6rem',
                fontWeight: 600,
                color: '#6b7280',
                marginBottom: 2,
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              Payload
            </div>
            <pre
              style={{
                margin: 0,
                padding: 8,
                backgroundColor: '#f3f4f6',
                border: '1px solid #e5e7eb',
                borderRadius: 3,
                fontSize: '0.65rem',
                fontFamily: 'monospace',
                color: '#1f2937',
                maxHeight: 200,
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {prettyJson(operation.payload)}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
};

export default WikiDiffOperation;
