/**
 * ArtifactEditor — main editor route for a single artifact.
 *
 * Orchestrates the split-pane markdown editor, frontmatter form,
 * instructions panel, validation hints display, dirty-state tracking,
 * save-with-conflict-detection flow, and diff preview for external changes.
 *
 * Receives `changeId` and `artifactId` from the parent routing context
 * (DesktopSelection in app.tsx). Resolves the artifact's generated file
 * path from CLI status data.
 *
 * All file I/O goes through `window.openadab.readFile()` /
 * `window.openadab.writeFile()`. Conflict detection uses `mtimeMs` /
 * `expectedMtimeMs`.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ProjectInfo,
  FileReadResponse,
  FileWriteResponse,
  CommandEvent,
} from '../../../shared/ipc-types.js';
import type { ArtifactStatus } from '../types/changes.js';
import FrontmatterForm, {
  parseFrontmatter,
  serializeFrontmatter,
} from '../components/FrontmatterForm.js';
import type { FrontmatterEntry } from '../components/FrontmatterForm.js';
import MarkdownEditor from '../components/MarkdownEditor.js';
import MarkdownPreview from '../components/MarkdownPreview.js';
import DiffPreview from '../components/DiffPreview.js';
import ArtifactInstructions from '../components/ArtifactInstructions.js';

interface ArtifactEditorProps {
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is still loading. */
  loading: boolean;
  /** The change ID to edit. */
  changeId: string | null;
  /** The artifact ID within the change. */
  artifactId: string | null;
  /** Artifact status data from the parent (ChangesWorkbench). */
  artifactStatus: ArtifactStatus | null;
  /** Called after a successful save to refresh status. */
  onSaved: () => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/**
 * Resolve the full file path for an artifact.
 *
 * Uses CLI status JSON `generatedFile` which is relative to project root.
 * Falls back to constructing: `adab/changes/<changeId>/<artifactId>.md`.
 */
function resolveFilePath(
  projectRoot: string,
  changeId: string,
  artifact: ArtifactStatus,
): string {
  if (artifact.generatedFile) {
    return `${projectRoot.replace(/[/\\]$/, '')}/${artifact.generatedFile.replace(/^[/\\]/, '')}`;
  }
  return `${projectRoot.replace(/[/\\]$/, '')}/adab/changes/${changeId}/${artifact.id}.md`;
}

/**
 * Extract validation hints from parsed instructions JSON.
 *
 * Looks for known keys: requiredFields, dependencies, equivalentCli,
 * contextBudget. Returns a structured object or null.
 */
function extractValidationHints(
  instructions: unknown,
): {
  requiredFields: string[];
  dependencies: string[];
  equivalentCli: string;
  contextBudget: string;
} | null {
  if (!instructions || typeof instructions !== 'object') return null;
  const obj = instructions as Record<string, unknown>;

  const requiredFields: string[] = Array.isArray(obj['requiredFields'])
    ? obj['requiredFields'].map(String)
    : [];
  const dependencies: string[] = Array.isArray(obj['dependencies'])
    ? obj['dependencies'].map(String)
    : [];
  const equivalentCli: string =
    obj['equivalentCli'] !== undefined
      ? String(obj['equivalentCli'])
      : '';
  const contextBudget: string =
    obj['contextBudget'] !== undefined
      ? String(obj['contextBudget'])
      : '';

  if (
    requiredFields.length === 0 &&
    dependencies.length === 0 &&
    !equivalentCli &&
    !contextBudget
  ) {
    return null;
  }

  return { requiredFields, dependencies, equivalentCli, contextBudget };
}

const ArtifactEditor: React.FC<ArtifactEditorProps> = ({
  projectInfo,
  loading,
  changeId,
  artifactId,
  artifactStatus,
  onSaved,
}) => {
  // ── File state ──
  const [fileContent, setFileContent] = useState<string>('');
  const [savedContent, setSavedContent] = useState<string>('');
  const [fileMtimeMs, setFileMtimeMs] = useState<number>(0);
  const [filePath, setFilePath] = useState<string>('');

  // ── Frontmatter state ──
  const [frontmatterEntries, setFrontmatterEntries] = useState<
    FrontmatterEntry[]
  >([]);
  const [markdownBody, setMarkdownBody] = useState<string>('');

  // ── UI state ──
  const [fileLoading, setFileLoading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [conflictDiskContent, setConflictDiskContent] = useState('');
  const [instructionsData, setInstructionsData] = useState<unknown>(null);
  const [splitRatio, setSplitRatio] = useState(50); // percentage for left pane

  // ── Refs ──
  const latestSavedContentRef = useRef(savedContent);
  latestSavedContentRef.current = savedContent;
  const latestMtimeRef = useRef(fileMtimeMs);
  latestMtimeRef.current = fileMtimeMs;

  // ── Load file ──
  const loadFile = useCallback(async () => {
    if (!projectInfo || !changeId || !artifactId || !artifactStatus) return;

    setFileLoading(true);
    setFileError(null);

    try {
      const resolvedPath = resolveFilePath(
        projectInfo.projectRoot,
        changeId,
        artifactStatus,
      );
      setFilePath(resolvedPath);

      const response: FileReadResponse = await window.openadab.readFile({
        filePath: resolvedPath,
        encoding: 'utf-8',
      });

      const content = response.content;
      setFileContent(content);
      setSavedContent(content);
      setFileMtimeMs(response.mtimeMs);
      setIsDirty(false);

      // Parse frontmatter
      const parsed = parseFrontmatter(content);
      setFrontmatterEntries(parsed.entries);
      setMarkdownBody(parsed.body);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes('ENOENT') || errMsg.includes('not found') || errMsg.includes('not exist')) {
        // File doesn't exist yet — start with empty content
        setFileContent('');
        setSavedContent('');
        setFrontmatterEntries([]);
        setMarkdownBody('');
        setIsDirty(false);
        setFileError(null);
      } else {
        setFileError(errMsg);
      }
    } finally {
      setFileLoading(false);
    }
  }, [projectInfo, changeId, artifactId, artifactStatus]);

  // Load when artifact changes
  useEffect(() => {
    if (projectInfo && changeId && artifactId && artifactStatus) {
      loadFile();
    } else {
      setFileContent('');
      setSavedContent('');
      setFrontmatterEntries([]);
      setMarkdownBody('');
      setFileError(null);
      setIsDirty(false);
    }
  }, [projectInfo, changeId, artifactId, artifactStatus, loadFile]);

  // ── Derived content when frontmatter or body changes ──
  const handleFrontmatterChange = useCallback(
    (entries: FrontmatterEntry[]) => {
      setFrontmatterEntries(entries);
      const newContent = serializeFrontmatter(entries, markdownBody);
      setFileContent(newContent);
      setIsDirty(newContent !== latestSavedContentRef.current);
    },
    [markdownBody],
  );

  const handleBodyChange = useCallback((body: string) => {
    setMarkdownBody(body);
    // Defer fileContent update via effect to avoid stale closure
  }, []);

  // Sync fileContent when markdownBody or frontmatterEntries change
  useEffect(() => {
    const newContent = serializeFrontmatter(frontmatterEntries, markdownBody);
    setFileContent(newContent);
    setIsDirty(newContent !== latestSavedContentRef.current);
  }, [frontmatterEntries, markdownBody]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!projectInfo || saving) return;

    setSaving(true);
    setSaveError(null);

    try {
      const response: FileWriteResponse = await window.openadab.writeFile({
        filePath,
        content: fileContent,
        encoding: 'utf-8',
        expectedMtimeMs: fileMtimeMs > 0 ? fileMtimeMs : undefined,
      });

      if (response.conflict) {
        // External change detected — read new disk content and show diff
        try {
          const diskResp: FileReadResponse = await window.openadab.readFile({
            filePath,
            encoding: 'utf-8',
          });
          setConflictDiskContent(diskResp.content);
          setShowDiff(true);
        } catch {
          setSaveError(
            'External change detected but failed to read current file.',
          );
        }
        return;
      }

      // Success
      setSavedContent(fileContent);
      setFileMtimeMs(response.mtimeMs);
      setIsDirty(false);
      setSaveError(null);
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [projectInfo, filePath, fileContent, fileMtimeMs, saving, onSaved]);

  // ── Conflict resolution ──
  const handleConfirmOverwrite = useCallback(async () => {
    setShowDiff(false);
    setSaving(true);
    setSaveError(null);

    try {
      const response: FileWriteResponse = await window.openadab.writeFile({
        filePath,
        content: fileContent,
        encoding: 'utf-8',
        // Force overwrite without expectedMtimeMs check
      });

      setSavedContent(fileContent);
      setFileMtimeMs(response.mtimeMs);
      setIsDirty(false);
      setSaveError(null);
      onSaved();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Overwrite failed.');
    } finally {
      setSaving(false);
    }
  }, [filePath, fileContent, onSaved]);

  const handleCancelOverwrite = useCallback(() => {
    setShowDiff(false);
    setSaving(false);
  }, []);

  // ── Auto-refresh on external change ──
  useEffect(() => {
    const unsub = window.openadab.onFileChanged((event) => {
      if (event.filePath === filePath && event.mtimeMs !== fileMtimeMs) {
        // File changed externally — mark with a subtle indicator
        // but don't auto-reload (user might have unsaved changes)
        if (!isDirty) {
          loadFile();
        }
      }
    });
    return unsub;
  }, [filePath, fileMtimeMs, isDirty, loadFile]);

  // ── Handle instructions data for validation hints ──
  const validationHints = extractValidationHints(instructionsData);

  // ── Render ──

  // Loading state
  if (loading) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 24px',
          gap: 16,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <span
          style={{
            width: 32,
            height: 32,
            borderRadius: '50%',
            border: '3px solid #d1d5db',
            borderTopColor: '#3b82f6',
            animation: 'spin 0.8s linear infinite',
            display: 'inline-block',
          }}
        />
        <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
          Loading project workspace…
        </span>
      </div>
    );
  }

  if (!projectInfo) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 24px',
          gap: 16,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.5rem',
            color: '#9ca3af',
          }}
        >
          📂
        </div>
        <h2
          style={{
            margin: 0,
            fontSize: '1.1rem',
            fontWeight: 600,
            color: '#374151',
          }}
        >
          No Project Open
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
          Open a project to edit artifacts.
        </p>
      </div>
    );
  }

  if (!changeId || !artifactId || !artifactStatus) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 24px',
          gap: 12,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            backgroundColor: '#f3f4f6',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '1.2rem',
            color: '#9ca3af',
          }}
        >
          📝
        </div>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
          Select an artifact from the Changes DAG to edit it.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        fontFamily: 'system-ui, sans-serif',
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
        <button
          type="button"
          onClick={() => {
            // Clear the editor artifact selection by notifying parent
            // via the saved callback — this is handled by app.tsx routing
            window.dispatchEvent(
              new CustomEvent('openadab:navigate-changes'),
            );
          }}
          title="Back to Changes DAG"
          style={{
            padding: '3px 8px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.7rem',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: 3,
          }}
        >
          ← Back
        </button>
        <span
          style={{
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#374151',
          }}
        >
          Editing
        </span>
        <span
          style={{
            fontSize: '0.72rem',
            fontFamily: 'monospace',
            color: '#6b7280',
            backgroundColor: '#f3f4f6',
            padding: '2px 8px',
            borderRadius: 3,
          }}
        >
          {artifactId}
        </span>

        {/* Dirty indicator */}
        {isDirty && (
          <span
            style={{
              fontSize: '0.65rem',
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

        {/* Status badge */}
        {artifactStatus && (
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 3,
              backgroundColor:
                artifactStatus.status === 'done'
                  ? '#f0fdf4'
                  : artifactStatus.status === 'ready'
                    ? '#fffbeb'
                    : artifactStatus.status === 'blocked'
                      ? '#fef2f2'
                      : '#f9fafb',
              color:
                artifactStatus.status === 'done'
                  ? '#166534'
                  : artifactStatus.status === 'ready'
                    ? '#92400e'
                    : artifactStatus.status === 'blocked'
                      ? '#991b1b'
                      : '#6b7280',
              border: '1px solid #e5e7eb',
            }}
          >
            {artifactStatus.status}
          </span>
        )}

        <span style={{ flex: 1 }} />

        {/* Save button */}
        <button
          type="button"
          onClick={handleSave}
          disabled={!isDirty || saving}
          title="Save (Ctrl+S)"
          style={{
            padding: '5px 14px',
            border: 'none',
            borderRadius: 4,
            backgroundColor: isDirty ? '#2563eb' : '#d1d5db',
            color: '#fff',
            fontSize: '0.72rem',
            fontWeight: 600,
            cursor: isDirty && !saving ? 'pointer' : 'not-allowed',
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
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      {/* Save error banner */}
      {saveError && (
        <div
          style={{
            padding: '6px 14px',
            backgroundColor: '#fef2f2',
            borderBottom: '1px solid #fecaca',
            fontSize: '0.7rem',
            fontFamily: 'monospace',
            color: '#dc2626',
          }}
        >
          Save error: {saveError}
        </div>
      )}

      {/* File loading indicator */}
      {fileLoading && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '40px',
            gap: 10,
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
          <span style={{ color: '#6b7280', fontSize: '0.78rem' }}>
            Loading artifact file…
          </span>
        </div>
      )}

      {/* File error */}
      {!fileLoading && fileError && (
        <div
          style={{
            margin: 12,
            padding: 12,
            backgroundColor: '#fef2f2',
            border: '1px solid #fecaca',
            borderRadius: 6,
          }}
        >
          <div
            style={{
              fontSize: '0.78rem',
              fontWeight: 600,
              color: '#dc2626',
              marginBottom: 6,
            }}
          >
            Failed to load artifact file
          </div>
          <pre
            style={{
              margin: 0,
              fontSize: '0.7rem',
              fontFamily: 'monospace',
              color: '#991b1b',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}
          >
            {fileError}
          </pre>
          <button
            type="button"
            onClick={loadFile}
            style={{
              marginTop: 8,
              padding: '5px 12px',
              border: '1px solid #fecaca',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#dc2626',
              fontSize: '0.72rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {/* File path indicator */}
      {!fileLoading && !fileError && filePath && (
        <div
          style={{
            padding: '4px 14px',
            borderBottom: '1px solid #e5e7eb',
            backgroundColor: '#f9fafb',
            fontSize: '0.65rem',
            fontFamily: 'monospace',
            color: '#9ca3af',
          }}
        >
          {filePath}
        </div>
      )}

      {/* Validation hints */}
      {validationHints && (
        <div
          style={{
            padding: '8px 14px',
            borderBottom: '1px solid #dbeafe',
            backgroundColor: '#eff6ff',
            fontSize: '0.7rem',
          }}
        >
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {validationHints.requiredFields.length > 0 && (
              <div>
                <span
                  style={{ fontWeight: 600, color: '#1d4ed8' }}
                >
                  Required Frontmatter:{' '}
                </span>
                <span style={{ color: '#3b82f6', fontFamily: 'monospace' }}>
                  {validationHints.requiredFields.join(', ')}
                </span>
              </div>
            )}
            {validationHints.dependencies.length > 0 && (
              <div>
                <span
                  style={{ fontWeight: 600, color: '#1d4ed8' }}
                >
                  Dependencies:{' '}
                </span>
                <span style={{ color: '#3b82f6', fontFamily: 'monospace' }}>
                  {validationHints.dependencies.join(', ')}
                </span>
              </div>
            )}
            {validationHints.equivalentCli && (
              <div>
                <span
                  style={{ fontWeight: 600, color: '#1d4ed8' }}
                >
                  CLI:{' '}
                </span>
                <span style={{ color: '#3b82f6', fontFamily: 'monospace' }}>
                  {validationHints.equivalentCli}
                </span>
              </div>
            )}
            {validationHints.contextBudget && (
              <div>
                <span
                  style={{ fontWeight: 600, color: '#1d4ed8' }}
                >
                  Budget:{' '}
                </span>
                <span style={{ color: '#3b82f6' }}>
                  {validationHints.contextBudget}
                </span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Frontmatter form */}
      <div
        style={{
          padding: '8px 14px',
          borderBottom: '1px solid #e5e7eb',
          flexShrink: 0,
        }}
      >
        <FrontmatterForm
          entries={frontmatterEntries}
          onChange={handleFrontmatterChange}
          disabled={fileLoading}
        />
      </div>

      {/* Split editor */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          minHeight: 0,
        }}
      >
        {/* Left pane: editor */}
        <div
          style={{
            flex: `0 0 ${splitRatio}%`,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
            borderRight: '1px solid #e5e7eb',
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
              fontSize: '0.68rem',
              fontWeight: 600,
              color: '#6b7280',
            }}
          >
            EDITOR
          </div>
          <MarkdownEditor
            value={markdownBody}
            onChange={handleBodyChange}
            disabled={fileLoading}
            onSave={handleSave}
          />
        </div>

        {/* Resize handle */}
        <div
          style={{
            width: 4,
            cursor: 'col-resize',
            backgroundColor: '#e5e7eb',
            flexShrink: 0,
          }}
          onMouseDown={(e) => {
            e.preventDefault();
            const startX = e.clientX;
            const startRatio = splitRatio;

            const onMouseMove = (ev: MouseEvent) => {
              const dx = ev.clientX - startX;
              const containerWidth =
                (e.target as HTMLElement).parentElement?.clientWidth ?? 1000;
              const newRatio = Math.max(
                20,
                Math.min(80, startRatio + (dx / containerWidth) * 100),
              );
              setSplitRatio(newRatio);
            };

            const onMouseUp = () => {
              document.removeEventListener('mousemove', onMouseMove);
              document.removeEventListener('mouseup', onMouseUp);
            };

            document.addEventListener('mousemove', onMouseMove);
            document.addEventListener('mouseup', onMouseUp);
          }}
        />

        {/* Right pane: preview */}
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            minWidth: 0,
          }}
        >
          <div
            style={{
              padding: '4px 12px',
              borderBottom: '1px solid #e5e7eb',
              backgroundColor: '#f9fafb',
              fontSize: '0.68rem',
              fontWeight: 600,
              color: '#6b7280',
            }}
          >
            PREVIEW
          </div>
          <MarkdownPreview content={markdownBody} />
        </div>
      </div>

      {/* Artifact instructions (collapsible) */}
      <div style={{ padding: '0 14px 10px', flexShrink: 0 }}>
        <ArtifactInstructions
          projectRoot={projectInfo.projectRoot}
          changeId={changeId}
          artifactId={artifactId}
          onInstructionsLoaded={setInstructionsData}
        />
      </div>

      {/* Diff preview modal */}
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

export default ArtifactEditor;
