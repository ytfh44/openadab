/**
 * ChapterPreview — read-only chapter viewer with explicit edit mode.
 *
 * Displays chapter frontmatter (title, status, word count) and body content
 * as rendered markdown. An "Edit" button activates edit mode, which loads
 * the MarkdownEditor and FrontmatterForm for editing.
 *
 * Save requires diff confirmation when `expectedMtimeMs` detects external
 * changes since the last read (reuses the DiffPreview component).
 *
 * All file I/O goes through `window.openadab.readFile()` / `writeFile()`.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  FileReadResponse,
  FileWriteResponse,
} from '../../../shared/ipc-types.js';
import FrontmatterForm, {
  parseFrontmatter,
  serializeFrontmatter,
} from './FrontmatterForm.js';
import type { FrontmatterEntry } from './FrontmatterForm.js';
import MarkdownEditor from './MarkdownEditor.js';
import MarkdownPreview from './MarkdownPreview.js';
import DiffPreview from './DiffPreview.js';

interface ChapterPreviewProps {
  /** Absolute path to the chapter file, or null if none selected. */
  chapterPath: string | null;
}

/** Count words in a string. */
function countWords(text: string): number {
  return text.split(/\s+/).filter((w) => w.length > 0).length;
}

const ChapterPreview: React.FC<ChapterPreviewProps> = ({ chapterPath }) => {
  // ── File state ──
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [fileMtimeMs, setFileMtimeMs] = useState(0);

  // ── Frontmatter state ──
  const [fmEntries, setFmEntries] = useState<FrontmatterEntry[]>([]);
  const [markdownBody, setMarkdownBody] = useState('');

  // ── UI state ──
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [conflictDiskContent, setConflictDiskContent] = useState('');

  const latestSavedRef = useRef(savedContent);
  latestSavedRef.current = savedContent;
  const latestMtimeRef = useRef(fileMtimeMs);
  latestMtimeRef.current = fileMtimeMs;

  // ── Load chapter ──
  const loadChapter = useCallback(async () => {
    if (!chapterPath) {
      setFileContent('');
      setSavedContent('');
      setFmEntries([]);
      setMarkdownBody('');
      setFileMtimeMs(0);
      setIsDirty(false);
      setIsEditing(false);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const resp: FileReadResponse = await window.openadab.readFile({
        filePath: chapterPath,
        encoding: 'utf-8',
      });
      setFileContent(resp.content);
      setSavedContent(resp.content);
      setFileMtimeMs(resp.mtimeMs);
      setIsDirty(false);
      setIsEditing(false);

      const parsed = parseFrontmatter(resp.content);
      setFmEntries(parsed.entries);
      setMarkdownBody(parsed.body);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setFileContent('');
    } finally {
      setLoading(false);
    }
  }, [chapterPath]);

  useEffect(() => {
    loadChapter();
  }, [loadChapter]);

  // ── Derived content changes ──
  const handleFmChange = useCallback(
    (entries: FrontmatterEntry[]) => {
      setFmEntries(entries);
      const newContent = serializeFrontmatter(entries, markdownBody);
      setFileContent(newContent);
      setIsDirty(newContent !== latestSavedRef.current);
    },
    [markdownBody],
  );

  const handleBodyChange = useCallback((body: string) => {
    setMarkdownBody(body);
  }, []);

  useEffect(() => {
    const newContent = serializeFrontmatter(fmEntries, markdownBody);
    setFileContent(newContent);
    setIsDirty(newContent !== latestSavedRef.current);
  }, [fmEntries, markdownBody]);

  // ── Enter/exit edit mode ──
  const handleEnterEdit = useCallback(() => {
    setIsEditing(true);
    setSaveError(null);
    setShowDiff(false);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setIsEditing(false);
    setSaveError(null);
    setShowDiff(false);
    // Revert to saved content
    const parsed = parseFrontmatter(savedContent);
    setFmEntries(parsed.entries);
    setMarkdownBody(parsed.body);
    setFileContent(savedContent);
    setIsDirty(false);
  }, [savedContent]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!chapterPath || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const resp: FileWriteResponse = await window.openadab.writeFile({
        filePath: chapterPath,
        content: fileContent,
        encoding: 'utf-8',
        expectedMtimeMs: fileMtimeMs > 0 ? fileMtimeMs : undefined,
      });
      if (resp.conflict) {
        try {
          const diskResp: FileReadResponse = await window.openadab.readFile({
            filePath: chapterPath,
            encoding: 'utf-8',
          });
          setConflictDiskContent(diskResp.content);
          setShowDiff(true);
        } catch {
          setSaveError('External change detected but failed to read current file.');
        }
        return;
      }
      setSavedContent(fileContent);
      setFileMtimeMs(resp.mtimeMs);
      setIsDirty(false);
      setIsEditing(false);
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [chapterPath, fileContent, fileMtimeMs, saving]);

  const handleConfirmOverwrite = useCallback(async () => {
    setShowDiff(false);
    setSaving(true);
    setSaveError(null);
    try {
      const resp: FileWriteResponse = await window.openadab.writeFile({
        filePath: chapterPath!,
        content: fileContent,
        encoding: 'utf-8',
      });
      setSavedContent(fileContent);
      setFileMtimeMs(resp.mtimeMs);
      setIsDirty(false);
      setIsEditing(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Overwrite failed.');
    } finally {
      setSaving(false);
    }
  }, [chapterPath, fileContent]);

  const handleCancelOverwrite = useCallback(() => {
    setShowDiff(false);
    setSaving(false);
  }, []);

  // ── Derived display data ──
  const title = fmEntries.find((e) => e.key === 'title')?.value || 'Untitled';
  const status = fmEntries.find((e) => e.key === 'status')?.value || 'unknown';
  const wc = countWords(markdownBody);

  // ── Render ──
  if (!chapterPath) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          color: '#9ca3af',
          fontSize: '0.82rem',
          padding: 40,
        }}
      >
        Select a chapter to preview.
      </div>
    );
  }

  if (loading) {
    return (
      <div
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 10,
          fontFamily: 'system-ui, sans-serif',
          color: '#6b7280',
          fontSize: '0.78rem',
          padding: 40,
        }}
      >
        <span
          style={{
            width: 20,
            height: 20,
            borderRadius: '50%',
            border: '2px solid #d1d5db',
            borderTopColor: '#3b82f6',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
        Loading chapter…
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          flex: 1,
          padding: 20,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            padding: 12,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
            fontSize: '0.72rem',
            color: '#dc2626',
          }}
        >
          Failed to load chapter: {error}
          <button
            type="button"
            onClick={loadChapter}
            style={{
              display: 'block',
              marginTop: 8,
              padding: '4px 10px',
              border: '1px solid #fecaca',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#dc2626',
              fontSize: '0.68rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'system-ui, sans-serif',
        minWidth: 0,
      }}
    >
      {/* Top bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '8px 14px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#fafafa',
          flexShrink: 0,
          flexWrap: 'wrap',
        }}
      >
        <span
          style={{
            fontSize: '0.82rem',
            fontWeight: 700,
            color: '#1f2937',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {title}
        </span>

        <span
          style={{
            fontSize: '0.62rem',
            fontWeight: 600,
            padding: '2px 8px',
            borderRadius: 3,
            backgroundColor: '#f3f4f6',
            color: '#6b7280',
            border: '1px solid #e5e7eb',
          }}
        >
          {status}
        </span>

        <span
          style={{
            fontSize: '0.62rem',
            color: '#9ca3af',
            fontFamily: 'monospace',
          }}
        >
          {wc.toLocaleString()} words
        </span>

        {isDirty && (
          <span
            style={{
              fontSize: '0.62rem',
              fontWeight: 600,
              color: '#d97706',
              backgroundColor: '#fffbeb',
              padding: '2px 6px',
              borderRadius: 3,
              border: '1px solid #fde68a',
            }}
          >
            ● Unsaved
          </span>
        )}

        <span style={{ flex: 1 }} />

        {!isEditing && (
          <button
            type="button"
            onClick={handleEnterEdit}
            style={{
              padding: '4px 12px',
              border: '1px solid #d1d5db',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#374151',
              fontSize: '0.7rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Edit
          </button>
        )}

        {isEditing && (
          <>
            <button
              type="button"
              onClick={handleCancelEdit}
              disabled={saving}
              style={{
                padding: '4px 10px',
                border: '1px solid #d1d5db',
                borderRadius: 4,
                backgroundColor: '#fff',
                color: '#374151',
                fontSize: '0.7rem',
                fontWeight: 500,
                cursor: saving ? 'not-allowed' : 'pointer',
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!isDirty || saving}
              style={{
                padding: '4px 14px',
                border: 'none',
                borderRadius: 4,
                backgroundColor: isDirty ? '#2563eb' : '#d1d5db',
                color: '#fff',
                fontSize: '0.7rem',
                fontWeight: 600,
                cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
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
              Save
            </button>
          </>
        )}
      </div>

      {/* Save error */}
      {saveError && (
        <div
          style={{
            padding: '6px 14px',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            fontSize: '0.7rem',
            color: '#dc2626',
            fontFamily: 'monospace',
          }}
        >
          Save error: {saveError}
        </div>
      )}

      {/* File path */}
      <div
        style={{
          padding: '3px 14px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f9fafb',
          fontSize: '0.62rem',
          fontFamily: 'monospace',
          color: '#9ca3af',
        }}
      >
        {chapterPath}
      </div>

      {/* Frontmatter form (only in edit mode) */}
      {isEditing && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid #e5e7eb',
            flexShrink: 0,
          }}
        >
          <FrontmatterForm
            entries={fmEntries}
            onChange={handleFmChange}
            disabled={saving}
          />
        </div>
      )}

      {/* Read-only frontmatter display */}
      {!isEditing && fmEntries.length > 0 && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#fafafa',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 8,
            flexShrink: 0,
          }}
        >
          {fmEntries.map((entry, i) => (
            <div
              key={i}
              style={{
                fontSize: '0.65rem',
                padding: '2px 8px',
                borderRadius: 3,
                backgroundColor: '#fff',
                border: '1px solid #e5e7eb',
              }}
            >
              <span style={{ fontWeight: 600, color: '#374151' }}>
                {entry.key}:
              </span>{' '}
              <span style={{ color: '#6b7280' }}>{entry.value || '(empty)'}</span>
            </div>
          ))}
        </div>
      )}

      {/* Body: preview or editor */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        {isEditing ? (
          <MarkdownEditor
            value={markdownBody}
            onChange={handleBodyChange}
            disabled={saving}
            onSave={handleSave}
          />
        ) : (
          <MarkdownPreview content={markdownBody} />
        )}
      </div>

      {/* Diff modal */}
      {showDiff && (
        <DiffPreview
          oldContent={conflictDiskContent}
          newContent={fileContent}
          onConfirmOverwrite={handleConfirmOverwrite}
          onCancel={handleCancelOverwrite}
          saving={saving}
        />
      )}
    </div>
  );
};

export default ChapterPreview;
