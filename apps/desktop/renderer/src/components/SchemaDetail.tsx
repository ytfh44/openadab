/**
 * SchemaDetail — displays schema metadata, artifact list, and validation results.
 *
 * Supports two sub-views:
 *   1. Schema show — calls `schema show <name> --json` and displays the full
 *      schema definition (name, version, description, artifact count).
 *   2. Schema validate — calls `schema validate <path> --json` and displays
 *      pass/fail status with error details.
 *
 * Both views handle loading, empty, error, and missing-schema states.
 */

import React from 'react';
import type {
  SchemaDefinition,
  SchemaValidateResponse,
} from '../types/schema.js';

interface SchemaDetailProps {
  /** The schema name being viewed, or null. */
  schemaName: string | null;
  /** The full schema definition from `schema show`, or null. */
  schemaDef: SchemaDefinition | null;
  /** Whether the schema show call is in progress. */
  showLoading: boolean;
  /** Error from the schema show call, or null. */
  showError: string | null;
  /** Validation results from `schema validate`, or null. */
  validation: SchemaValidateResponse | null;
  /** Whether the validate call is in progress. */
  validateLoading: boolean;
  /** Error from the validate call, or null. */
  validateError: string | null;
  /** Called to trigger schema show for this schema. */
  onShow: (schemaName: string) => void;
  /** Called to trigger schema validate for this schema. */
  onValidate: (schemaName: string) => void;
  /** Called to close the detail view. */
  onClose: () => void;
}

const SchemaDetail: React.FC<SchemaDetailProps> = ({
  schemaName,
  schemaDef,
  showLoading,
  showError,
  validation,
  validateLoading,
  validateError,
  onShow,
  onValidate,
  onClose,
}) => {
  if (!schemaName) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '60px 24px',
          gap: 12,
          color: '#9ca3af',
          fontSize: '0.85rem',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span style={{ fontSize: '2rem' }}>📋</span>
        <span>Select a schema to view details.</span>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: '16px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          marginBottom: 14,
        }}
      >
        <h3
          style={{
            margin: 0,
            fontSize: '0.95rem',
            fontWeight: 700,
            color: '#1f2937',
          }}
        >
          Schema: {schemaName}
        </h3>

        <button
          type="button"
          onClick={onClose}
          style={{
            marginLeft: 'auto',
            padding: '4px 10px',
            border: '1px solid #d1d5db',
            borderRadius: 4,
            backgroundColor: '#fff',
            color: '#6b7280',
            fontSize: '0.7rem',
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          Close
        </button>
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        <button
          type="button"
          disabled={showLoading}
          onClick={() => onShow(schemaName)}
          style={{
            padding: '5px 14px',
            border: '1px solid #2563eb',
            borderRadius: 4,
            backgroundColor: showLoading ? '#eff6ff' : '#eff6ff',
            color: '#1d4ed8',
            fontSize: '0.73rem',
            fontWeight: 600,
            cursor: showLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {showLoading ? 'Loading…' : 'Show Details'}
        </button>
        <button
          type="button"
          disabled={validateLoading}
          onClick={() => onValidate(schemaName)}
          style={{
            padding: '5px 14px',
            border: '1px solid #059669',
            borderRadius: 4,
            backgroundColor: validateLoading ? '#ecfdf5' : '#ecfdf5',
            color: '#047857',
            fontSize: '0.73rem',
            fontWeight: 600,
            cursor: validateLoading ? 'not-allowed' : 'pointer',
          }}
        >
          {validateLoading ? 'Validating…' : 'Validate'}
        </button>
      </div>

      {/* Show error */}
      {showError && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
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
          {showError}
        </div>
      )}

      {/* Show loading */}
      {showLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
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
            Loading schema definition…
          </span>
        </div>
      )}

      {/* Schema definition details */}
      {schemaDef && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 6,
            backgroundColor: '#fafafa',
            padding: '14px 16px',
            marginBottom: 14,
          }}
        >
          <table
            style={{
              width: '100%',
              fontSize: '0.75rem',
              borderCollapse: 'collapse',
            }}
          >
            <tbody>
              <tr>
                <td
                  style={{
                    padding: '4px 8px 4px 0',
                    fontWeight: 600,
                    color: '#6b7280',
                    width: 100,
                  }}
                >
                  Name
                </td>
                <td style={{ padding: '4px 0', color: '#1f2937', fontFamily: 'monospace' }}>
                  {schemaDef.name}
                </td>
              </tr>
              <tr>
                <td
                  style={{
                    padding: '4px 8px 4px 0',
                    fontWeight: 600,
                    color: '#6b7280',
                  }}
                >
                  Version
                </td>
                <td style={{ padding: '4px 0', color: '#1f2937' }}>
                  {schemaDef.version}
                </td>
              </tr>
              {schemaDef.description && (
                <tr>
                  <td
                    style={{
                      padding: '4px 8px 4px 0',
                      fontWeight: 600,
                      color: '#6b7280',
                    }}
                  >
                    Description
                  </td>
                  <td style={{ padding: '4px 0', color: '#374151' }}>
                    {schemaDef.description}
                  </td>
                </tr>
              )}
              <tr>
                <td
                  style={{
                    padding: '4px 8px 4px 0',
                    fontWeight: 600,
                    color: '#6b7280',
                  }}
                >
                  Artifacts
                </td>
                <td style={{ padding: '4px 0', color: '#1f2937' }}>
                  {schemaDef.artifacts?.length ?? 0}
                </td>
              </tr>
              {schemaDef.apply && (
                <tr>
                  <td
                    style={{
                      padding: '4px 8px 4px 0',
                      fontWeight: 600,
                      color: '#6b7280',
                    }}
                  >
                    Apply target
                  </td>
                  <td style={{ padding: '4px 0', color: '#1f2937', fontFamily: 'monospace' }}>
                    {schemaDef.apply.target}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* Validation error */}
      {validateError && (
        <div
          style={{
            padding: '8px 12px',
            marginBottom: 10,
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
          {validateError}
        </div>
      )}

      {/* Validate loading */}
      {validateLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
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
            Running validation…
          </span>
        </div>
      )}

      {/* Validation result */}
      {validation && (
        <div
          style={{
            border: `1px solid ${validation.passed ? '#bbf7d0' : '#fecaca'}`,
            borderRadius: 6,
            backgroundColor: validation.passed ? '#f0fdf4' : '#fef2f2',
            padding: '14px 16px',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginBottom: validation.errors.length > 0 ? 10 : 0,
            }}
          >
            <span style={{ fontSize: '1rem' }}>
              {validation.passed ? '✅' : '❌'}
            </span>
            <span
              style={{
                fontSize: '0.82rem',
                fontWeight: 700,
                color: validation.passed ? '#166534' : '#dc2626',
              }}
            >
              {validation.passed ? 'Validation Passed' : 'Validation Failed'}
            </span>
          </div>

          {validation.errors.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {validation.errors.map((err, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: '0.7rem',
                    fontFamily: 'monospace',
                    color: '#991b1b',
                    padding: '3px 0',
                    borderBottom:
                      i < validation.errors.length - 1
                        ? '1px solid #fecaca'
                        : 'none',
                  }}
                >
                  {err}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SchemaDetail;
