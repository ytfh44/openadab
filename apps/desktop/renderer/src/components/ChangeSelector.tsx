/**
 * ChangeSelector — input and list for selecting which change to view.
 *
 * Provides a text input for entering a change ID and a list of
 * existing changes inferred from filesystem or status command output.
 * Emits the selected change ID upward so the parent can load status.
 */

import React, { useState, useCallback } from 'react';

interface ChangeSelectorProps {
  /** Currently selected change ID, or null if none selected. */
  selectedChangeId: string | null;
  /** List of known change IDs in the current project. */
  changeIds: string[];
  /** Whether change IDs are still loading. */
  loading?: boolean;
  /** Error message if change list could not be loaded. */
  error?: string | null;
  /** Called when the user selects a change (by click or text input submit). */
  onSelect: (changeId: string) => void;
  /** Called when the user wants to create a new change. */
  onNewChange: () => void;
}

const ChangeSelector: React.FC<ChangeSelectorProps> = ({
  selectedChangeId,
  changeIds,
  loading,
  error,
  onSelect,
  onNewChange,
}) => {
  const [inputValue, setInputValue] = useState('');

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = inputValue.trim();
      if (trimmed.length > 0) {
        onSelect(trimmed);
        setInputValue('');
      }
    },
    [inputValue, onSelect],
  );

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      {/* Input form */}
      <form
        onSubmit={handleSubmit}
        style={{ display: 'flex', gap: 8, alignItems: 'center' }}
      >
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter change ID (e.g. ch-001)"
          style={{
            flex: 1,
            padding: '6px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            fontSize: '0.82rem',
            fontFamily: 'monospace',
            outline: 'none',
            backgroundColor: '#fff',
          }}
        />
        <button
          type="submit"
          disabled={inputValue.trim().length === 0}
          style={{
            padding: '6px 14px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#374151',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: inputValue.trim().length === 0 ? 'not-allowed' : 'pointer',
            opacity: inputValue.trim().length === 0 ? 0.5 : 1,
          }}
        >
          Load
        </button>
        <button
          type="button"
          onClick={onNewChange}
          style={{
            padding: '6px 14px',
            border: 'none',
            borderRadius: 4,
            backgroundColor: '#16a34a',
            color: '#fff',
            fontSize: '0.75rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          + New
        </button>
      </form>

      {/* Loading state */}
      {loading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '8px 0',
            fontSize: '0.75rem',
            color: '#6b7280',
          }}
        >
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
          Loading changes…
        </div>
      )}

      {/* Error state */}
      {error && (
        <div
          style={{
            padding: '6px 10px',
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: '0.72rem',
            color: '#dc2626',
          }}
        >
          {error}
        </div>
      )}

      {/* Change list */}
      {!loading && changeIds.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {changeIds.map((cid) => {
            const isSelected = cid === selectedChangeId;
            return (
              <button
                key={cid}
                type="button"
                onClick={() => onSelect(cid)}
                style={{
                  padding: '4px 12px',
                  border: `1px solid ${isSelected ? '#2563eb' : '#d1d5db'}`,
                  borderRadius: 4,
                  backgroundColor: isSelected ? '#eff6ff' : '#fff',
                  color: isSelected ? '#1d4ed8' : '#374151',
                  fontSize: '0.75rem',
                  fontWeight: isSelected ? 600 : 400,
                  fontFamily: 'monospace',
                  cursor: 'pointer',
                  transition: 'all 0.1s',
                }}
              >
                {cid}
              </button>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && changeIds.length === 0 && (
        <div
          style={{
            padding: '12px 0',
            fontSize: '0.78rem',
            color: '#9ca3af',
            textAlign: 'center',
          }}
        >
          No changes found. Create one to get started.
        </div>
      )}
    </div>
  );
};

export default ChangeSelector;
