/**
 * SchemaList — displays installed schemas with active-schema highlighting.
 *
 * Calls `schema list --json` and renders each schema as a selectable row.
 * The active schema (as reported by the CLI or passed from ProjectInfo) is
 * rendered in bold with a "• active" indicator.
 *
 * Handles loading, empty, and error states.
 */

import React from 'react';
import type { SchemaEntry } from '../types/schema.js';

interface SchemaListProps {
  /** Parsed schema entries from the CLI list output. */
  schemas: SchemaEntry[];
  /** Name of the currently active schema, or null. */
  activeSchema: string | null;
  /** Whether the schema list is still loading. */
  loading: boolean;
  /** Error message if the list load failed, or null. */
  error: string | null;
  /** Called when the user selects a schema. */
  onSelect: (schemaName: string) => void;
  /** The currently selected schema name, or null. */
  selectedSchema: string | null;
  /** Called to refresh the schema list. */
  onRefresh: () => void;
}

const SchemaList: React.FC<SchemaListProps> = ({
  schemas,
  activeSchema,
  loading,
  error,
  onSelect,
  selectedSchema,
  onRefresh,
}) => {
  // ── Loading state ──
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '16px 12px',
        }}
      >
        <span
          style={{
            width: 16,
            height: 16,
            borderRadius: '50%',
            border: '2px solid #d1d5db',
            borderTopColor: '#3b82f6',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
        <span style={{ fontSize: '0.78rem', color: '#6b7280' }}>
          Loading schemas…
        </span>
      </div>
    );
  }

  // ── Error state ──
  if (error) {
    return (
      <div
        style={{
          padding: '10px 12px',
          backgroundColor: '#fef2f2',
          border: '1px solid #fecaca',
          borderRadius: 6,
        }}
      >
        <div
          style={{
            fontSize: '0.72rem',
            fontFamily: 'monospace',
            color: '#dc2626',
            marginBottom: 6,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}
        >
          {error}
        </div>
        <button
          type="button"
          onClick={onRefresh}
          style={{
            padding: '4px 10px',
            border: '1px solid #fca5a5',
            borderRadius: 4,
            backgroundColor: '#fff',
            color: '#dc2626',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ──
  if (schemas.length === 0) {
    return (
      <div
        style={{
          padding: '24px 16px',
          textAlign: 'center',
          color: '#9ca3af',
          fontSize: '0.82rem',
        }}
      >
        No schemas installed. Fork a built-in schema to get started.
      </div>
    );
  }

  // ── Schema list ──
  return (
    <div style={{ fontFamily: 'system-ui, sans-serif' }}>
      {schemas.map((schema) => {
        const isActive =
          (activeSchema && schema.name === activeSchema) ?? false;
        const isSelected = selectedSchema === schema.name;

        return (
          <div
            key={schema.name}
            role="button"
            tabIndex={0}
            onClick={() => onSelect(schema.name)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onSelect(schema.name);
              }
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '8px 12px',
              cursor: 'pointer',
              backgroundColor: isSelected ? '#eff6ff' : 'transparent',
              borderLeft: isSelected
                ? '3px solid #2563eb'
                : '3px solid transparent',
              borderBottom: '1px solid #f3f4f6',
              transition: 'background-color 0.1s',
            }}
          >
            {/* Schema name */}
            <span
              style={{
                fontSize: '0.8rem',
                fontWeight: isActive ? 700 : 500,
                color: isActive ? '#1f2937' : '#374151',
                fontFamily: 'monospace',
              }}
            >
              {schema.name}
            </span>

            {/* Active indicator */}
            {isActive && (
              <span
                style={{
                  fontSize: '0.62rem',
                  fontWeight: 700,
                  color: '#2563eb',
                  backgroundColor: '#dbeafe',
                  padding: '1px 6px',
                  borderRadius: 3,
                }}
              >
                active
              </span>
            )}

            {/* Builtin tag */}
            {schema.builtin && (
              <span
                style={{
                  fontSize: '0.6rem',
                  fontWeight: 600,
                  color: '#6b7280',
                  backgroundColor: '#f3f4f6',
                  padding: '1px 5px',
                  borderRadius: 3,
                }}
              >
                built-in
              </span>
            )}

            {/* Artifact count */}
            {schema.artifactCount !== undefined && (
              <span
                style={{
                  marginLeft: 'auto',
                  fontSize: '0.65rem',
                  color: '#9ca3af',
                }}
              >
                {schema.artifactCount} artifacts
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default SchemaList;
