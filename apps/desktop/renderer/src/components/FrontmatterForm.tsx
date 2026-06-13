/**
 * FrontmatterForm — YAML frontmatter key-value editor.
 *
 * Parses `---\nkey: value\n---\n` blocks from file content via a simple regex.
 * Renders each key-value pair as an editable form field.
 * On change, reconstructs the full `---\n...\n---\n` + body string.
 *
 * No external YAML libraries are used — the renderer must stay
 * dependency-free of Node.js modules.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';

/** A single key-value entry extracted from frontmatter. */
export interface FrontmatterEntry {
  key: string;
  value: string;
}

/** Parsed frontmatter result. */
export interface ParsedFrontmatter {
  entries: FrontmatterEntry[];
  body: string;
}

/** Regex: captures optional frontmatter block `---\n...\n---` then body. */
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

/**
 * Parse YAML frontmatter from raw file content.
 *
 * Extracts `---\nkey: value\n---` header. Each non-empty line
 * inside the frontmatter block is split at the first colon.
 * If no frontmatter is found, returns an empty entries array
 * with the entire content as the body.
 */
export function parseFrontmatter(
  raw: string,
): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { entries: [], body: raw };
  }

  const fmBlock = match[1];
  let body = match[2];
  // Strip leading newline from body (between closing --- and first content)
  body = body.replace(/^\r?\n/, '');
  const entries: FrontmatterEntry[] = [];

  for (const line of fmBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();
    if (key.length > 0) {
      entries.push({ key, value });
    }
  }

  return { entries, body };
}

/**
 * Serialize entries and body back into a full file content string.
 *
 * Produces `---\nkey: value\n---\n\nbody`.
 * Empty values are still serialized as `key: `.
 */
export function serializeFrontmatter(
  entries: FrontmatterEntry[],
  body: string,
): string {
  if (entries.length === 0) return body;

  const fmLines = entries.map((e) => `${e.key}: ${e.value}`);
  return `---\n${fmLines.join('\n')}\n---\n\n${body}`;
}

interface FrontmatterFormProps {
  /** Current entries (controlled). */
  entries: FrontmatterEntry[];
  /** Called when entries change. */
  onChange: (entries: FrontmatterEntry[]) => void;
  /** If true, the field controls are disabled. */
  disabled?: boolean;
}

/**
 * Editable key-value form for YAML frontmatter fields.
 *
 * Renders a compact table-like form where each row is a
 * key (read-only label) and an editable value input.
 * Supports adding and removing entries.
 */
const FrontmatterForm: React.FC<FrontmatterFormProps> = ({
  entries,
  onChange,
  disabled = false,
}) => {
  const handleValueChange = useCallback(
    (index: number, newValue: string) => {
      const updated = [...entries];
      updated[index] = { ...updated[index], value: newValue };
      onChange(updated);
    },
    [entries, onChange],
  );

  const handleAdd = useCallback(() => {
    onChange([...entries, { key: '', value: '' }]);
  }, [entries, onChange]);

  const handleRemove = useCallback(
    (index: number) => {
      const updated = entries.filter((_, i) => i !== index);
      onChange(updated);
    },
    [entries, onChange],
  );

  const handleKeyChange = useCallback(
    (index: number, newKey: string) => {
      const updated = [...entries];
      updated[index] = { ...updated[index], key: newKey };
      onChange(updated);
    },
    [entries, onChange],
  );

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        backgroundColor: '#fafafa',
        padding: 10,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: entries.length > 0 ? 8 : 0,
        }}
      >
        <span
          style={{
            fontSize: '0.72rem',
            fontWeight: 700,
            color: '#374151',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Frontmatter
        </span>
        <button
          type="button"
          onClick={handleAdd}
          disabled={disabled}
          style={{
            padding: '2px 8px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.68rem',
            fontWeight: 600,
            cursor: disabled ? 'not-allowed' : 'pointer',
          }}
        >
          + Add
        </button>
      </div>

      {entries.length === 0 && (
        <div
          style={{
            fontSize: '0.7rem',
            color: '#9ca3af',
            textAlign: 'center',
            padding: '8px 0',
          }}
        >
          No frontmatter fields. Click +Add to create one.
        </div>
      )}

      {entries.map((entry, idx) => (
        <div
          key={idx}
          style={{
            display: 'flex',
            gap: 6,
            marginBottom: 4,
            alignItems: 'center',
          }}
        >
          <input
            type="text"
            value={entry.key}
            onChange={(e) => handleKeyChange(idx, e.target.value)}
            disabled={disabled}
            placeholder="key"
            style={{
              flex: '0 0 120px',
              padding: '3px 6px',
              border: '1px solid #d1d5db',
              borderRadius: 3,
              fontSize: '0.72rem',
              fontFamily: 'monospace',
              color: '#1f2937',
              backgroundColor: '#fff',
            }}
          />
          <input
            type="text"
            value={entry.value}
            onChange={(e) => handleValueChange(idx, e.target.value)}
            disabled={disabled}
            placeholder="value"
            style={{
              flex: 1,
              padding: '3px 6px',
              border: '1px solid #d1d5db',
              borderRadius: 3,
              fontSize: '0.72rem',
              fontFamily: 'monospace',
              color: '#1f2937',
              backgroundColor: '#fff',
            }}
          />
          <button
            type="button"
            onClick={() => handleRemove(idx)}
            disabled={disabled}
            title="Remove field"
            style={{
              padding: '1px 5px',
              border: '1px solid #fecaca',
              borderRadius: 3,
              backgroundColor: '#fef2f2',
              color: '#dc2626',
              fontSize: '0.65rem',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
};

export default FrontmatterForm;
