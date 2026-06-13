/**
 * SchemaForkDialog — modal dialog for forking a schema.
 *
 * Provides:
 *   - A dropdown to select the base schema (from the installed schemas list).
 *   - A text input for the new schema name.
 *   - Validation: base must be selected, new name must be non-empty
 *     and not conflict with an existing schema.
 *   - Calls `schema fork <base> <name> --json` on confirm.
 *
 * Handles loading, error, and success states.
 */

import React, { useState, useCallback } from 'react';

interface SchemaForkDialogProps {
  /** List of installed schema names (for the base dropdown). */
  schemaNames: string[];
  /** Whether the fork operation is in progress. */
  forking: boolean;
  /** Error message from the fork operation, or null. */
  forkError: string | null;
  /** Success message from the fork operation, or null. */
  forkSuccess: string | null;
  /** Called when the user confirms the fork. */
  onFork: (base: string, name: string) => void;
  /** Called when the user cancels/closes the dialog. */
  onClose: () => void;
}

const SchemaForkDialog: React.FC<SchemaForkDialogProps> = ({
  schemaNames,
  forking,
  forkError,
  forkSuccess,
  onFork,
  onClose,
}) => {
  const [base, setBase] = useState('');
  const [name, setName] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);

  const handleNameChange = useCallback(
    (value: string) => {
      setName(value);
      if (value.trim() === '') {
        setNameError('Name must not be empty.');
      } else if (schemaNames.includes(value.trim())) {
        setNameError('A schema with this name already exists.');
      } else {
        setNameError(null);
      }
    },
    [schemaNames],
  );

  const canFork =
    base !== '' && name.trim() !== '' && nameError === null && !forking;

  const handleFork = () => {
    if (!canFork) return;
    onFork(base, name.trim());
  };

  return (
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
      onClick={forking ? undefined : onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !forking) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: '#fff',
          borderRadius: 8,
          padding: '24px 28px',
          minWidth: 400,
          maxWidth: 480,
          boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <h3
          style={{
            margin: '0 0 16px 0',
            fontSize: '1rem',
            fontWeight: 700,
            color: '#1f2937',
          }}
        >
          Fork Schema
        </h3>

        {/* Success message */}
        {forkSuccess && (
          <div
            style={{
              padding: '10px 12px',
              marginBottom: 14,
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 6,
              fontSize: '0.78rem',
              fontWeight: 600,
              color: '#166534',
            }}
          >
            ✅ {forkSuccess}
          </div>
        )}

        {/* Error message */}
        {forkError && (
          <div
            style={{
              padding: '8px 12px',
              marginBottom: 14,
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
            {forkError}
          </div>
        )}

        {/* Base schema dropdown */}
        <div style={{ marginBottom: 14 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 4,
            }}
          >
            Base schema
          </label>
          <select
            value={base}
            onChange={(e) => setBase(e.target.value)}
            disabled={forking}
            style={{
              width: '100%',
              padding: '7px 10px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              color: '#1f2937',
              backgroundColor: '#fff',
              cursor: forking ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="">-- Select a base schema --</option>
            {schemaNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>

        {/* New name input */}
        <div style={{ marginBottom: 18 }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.75rem',
              fontWeight: 600,
              color: '#374151',
              marginBottom: 4,
            }}
          >
            New schema name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            disabled={forking}
            placeholder="e.g. my-custom-schema"
            style={{
              width: '100%',
              padding: '7px 10px',
              border: `1px solid ${nameError ? '#fca5a5' : '#d1d5db'}`,
              borderRadius: 4,
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              color: '#1f2937',
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          {nameError && (
            <div
              style={{
                marginTop: 4,
                fontSize: '0.68rem',
                color: '#dc2626',
              }}
            >
              {nameError}
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            disabled={forking}
            style={{
              padding: '7px 16px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '0.78rem',
              fontWeight: 500,
              cursor: forking ? 'not-allowed' : 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleFork}
            disabled={!canFork}
            style={{
              padding: '7px 16px',
              border: 'none',
              borderRadius: 4,
              backgroundColor: canFork ? '#2563eb' : '#9ca3af',
              color: '#fff',
              fontSize: '0.78rem',
              fontWeight: 600,
              cursor: canFork ? 'pointer' : 'not-allowed',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {forking && (
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
            {forking ? 'Forking…' : 'Fork Schema'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default SchemaForkDialog;
