/**
 * DiffPreview — side-by-side diff comparison for save conflicts.
 *
 * When a file has been modified externally since the last read,
 * this component shows the old (disk) content and the new (editor) content
 * side-by-side, allowing the user to review changes before overwriting.
 *
 * Also provides a unified-line diff view as an alternative.
 */

import React, { useMemo } from 'react';

interface DiffPreviewProps {
  /** Original file content from the last read (disk version). */
  oldContent: string;
  /** Current editor content (unsaved changes). */
  newContent: string;
  /** Called when the user confirms overwrite. */
  onConfirmOverwrite: () => void;
  /** Called when the user cancels the save. */
  onCancel: () => void;
  /** If true, the save is in progress. */
  saving?: boolean;
}

/**
 * Compute a simple line-by-line diff between two strings.
 * Returns an array of diff segments: each line is classified
 * as 'same', 'added', or 'removed'.
 */
function computeLineDiff(
  oldText: string,
  newText: string,
): { type: 'same' | 'added' | 'removed'; line: string }[] {
  const oldLines = oldText.split('\n');
  const newLines = newText.split('\n');
  const result: { type: 'same' | 'added' | 'removed'; line: string }[] = [];

  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;

    if (oldLine === newLine) {
      result.push({ type: 'same', line: oldLine ?? '' });
    } else {
      if (oldLine !== undefined) {
        result.push({ type: 'removed', line: oldLine });
      }
      if (newLine !== undefined) {
        result.push({ type: 'added', line: newLine });
      }
    }
  }

  return result;
}

const DiffPreview: React.FC<DiffPreviewProps> = ({
  oldContent,
  newContent,
  onConfirmOverwrite,
  onCancel,
  saving = false,
}) => {
  const diffLines = useMemo(
    () => computeLineDiff(oldContent, newContent),
    [oldContent, newContent],
  );

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
      onClick={onCancel}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !saving) onCancel();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
          width: '90vw',
          maxWidth: 900,
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 18px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#fffbeb',
            borderRadius: '8px 8px 0 0',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: '1.1rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <div
              style={{
                fontSize: '0.88rem',
                fontWeight: 700,
                color: '#92400e',
              }}
            >
              External Change Detected
            </div>
            <div
              style={{
                fontSize: '0.72rem',
                color: '#a16207',
                marginTop: 2,
              }}
            >
              This file was modified externally since you last loaded it.
              Review the changes below before overwriting.
            </div>
          </div>
        </div>

        {/* Unified diff view */}
        <div
          style={{
            flex: 1,
            overflow: 'auto',
            fontFamily: 'monospace',
            fontSize: '0.7rem',
            borderBottom: '1px solid #e5e7eb',
          }}
        >
          <div
            style={{
              display: 'flex',
              backgroundColor: '#f9fafb',
              borderBottom: '1px solid #e5e7eb',
              padding: '4px 12px',
              position: 'sticky',
              top: 0,
              zIndex: 1,
            }}
          >
            <span
              style={{
                flex: 1,
                fontWeight: 600,
                fontSize: '0.65rem',
                color: '#6b7280',
              }}
            >
              Disk → Editor (unified diff)
            </span>
            <span style={{ fontSize: '0.6rem', color: '#9ca3af' }}>
              {diffLines.length} lines
            </span>
          </div>

          <div style={{ padding: '4px 0' }}>
            {diffLines.map((d, i) => (
              <div
                key={i}
                style={{
                  padding: '1px 12px',
                  backgroundColor:
                    d.type === 'added'
                      ? '#f0fdf4'
                      : d.type === 'removed'
                        ? '#fef2f2'
                        : 'transparent',
                  whiteSpace: 'pre',
                }}
              >
                <span
                  style={{
                    display: 'inline-block',
                    width: 16,
                    color:
                      d.type === 'added'
                        ? '#16a34a'
                        : d.type === 'removed'
                          ? '#dc2626'
                          : '#d1d5db',
                    fontWeight: 600,
                    fontSize: '0.65rem',
                    userSelect: 'none',
                  }}
                >
                  {d.type === 'added' ? '+' : d.type === 'removed' ? '-' : ' '}
                </span>
                <span
                  style={{
                    color:
                      d.type === 'added'
                        ? '#166534'
                        : d.type === 'removed'
                          ? '#991b1b'
                          : '#374151',
                  }}
                >
                  {d.line || '\u00A0'}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            padding: '12px 18px',
            display: 'flex',
            gap: 8,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            style={{
              padding: '7px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirmOverwrite}
            disabled={saving}
            style={{
              padding: '7px 16px',
              border: 'none',
              borderRadius: 4,
              backgroundColor: saving ? '#fbbf24' : '#d97706',
              color: '#fff',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {saving && (
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
            Overwrite with My Changes
          </button>
        </div>
      </div>
    </div>
  );
};

export default DiffPreview;
