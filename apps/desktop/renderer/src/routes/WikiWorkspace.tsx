/**
 * WikiWorkspace — wiki page browser, editor, backlinks, mentions, and lint warnings.
 *
 * Split-pane layout: left sidebar (PageBrowser) lists wiki pages by category,
 * right pane shows the selected page with MarkdownEditor/FrontmatterForm for
 * editing, backlinks panel, mentions panel, and lint warnings.
 *
 * Reuses existing MarkdownEditor, MarkdownPreview, FrontmatterForm, DiffPreview
 * components from Section 6.
 *
 * Background tasks for wikilinks index and lint warnings run via CLI.
 * File I/O goes through `window.openadab.readFile()` / `writeFile()`.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type {
  ProjectInfo,
  FileReadResponse,
  FileWriteResponse,
  CommandEvent,
} from '../../../shared/ipc-types.js';
import FrontmatterForm, {
  parseFrontmatter,
  serializeFrontmatter,
} from '../components/FrontmatterForm.js';
import type { FrontmatterEntry } from '../components/FrontmatterForm.js';
import MarkdownEditor from '../components/MarkdownEditor.js';
import MarkdownPreview from '../components/MarkdownPreview.js';
import DiffPreview from '../components/DiffPreview.js';
import PageBrowser from '../components/PageBrowser.js';

/** Shape of a wikilinks.json index entry (partial). */
interface WikiLinkEntry {
  source: string;
  target: string;
}

/** Shape of `openadab wiki lint --json` output. */
interface WikiLintResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

interface WikiWorkspaceProps {
  /** Current project info. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is loading. */
  loading: boolean;
  /** Initial wiki page path from navigation target. */
  initialWikiPage?: string;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/** Extract all [[wikilinks]] from markdown text. */
function extractWikilinks(text: string): string[] {
  const results: string[] = [];
  const re = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    const target = match[1].trim();
    if (target && !results.includes(target)) {
      results.push(target);
    }
  }
  return results;
}

const WikiWorkspace: React.FC<WikiWorkspaceProps> = ({
  projectInfo,
  loading,
  initialWikiPage,
}) => {
  // ── Page selection ──
  const [selectedPagePath, setSelectedPagePath] = useState<string | null>(
    initialWikiPage ?? null,
  );

  // ── File state ──
  const [fileContent, setFileContent] = useState('');
  const [savedContent, setSavedContent] = useState('');
  const [fileMtimeMs, setFileMtimeMs] = useState(0);

  // ── Frontmatter state ──
  const [fmEntries, setFmEntries] = useState<FrontmatterEntry[]>([]);
  const [markdownBody, setMarkdownBody] = useState('');

  // ── UI state ──
  const [pageLoading, setPageLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showDiff, setShowDiff] = useState(false);
  const [conflictDiskContent, setConflictDiskContent] = useState('');

  // ── Wiki extras ──
  const [backlinks, setBacklinks] = useState<string[]>([]);
  const [mentions, setMentions] = useState<string[]>([]);
  const [lintIssues, setLintIssues] = useState<{ errors: string[]; warnings: string[] }>({ errors: [], warnings: [] });
  const [lintLoading, setLintLoading] = useState(false);

  // ── Refs ──
  const latestSavedRef = useRef(savedContent);
  latestSavedRef.current = savedContent;
  const latestMtimeRef = useRef(fileMtimeMs);
  latestMtimeRef.current = fileMtimeMs;

  const currentPageName = useMemo(() => {
    if (!selectedPagePath) return '';
    const parts = selectedPagePath.replace(/\\/g, '/').split('/');
    const filename = parts[parts.length - 1];
    return filename.replace(/\.md$/, '');
  }, [selectedPagePath]);

  // ── Load page ──
  const loadPage = useCallback(async () => {
    if (!selectedPagePath) {
      setFileContent('');
      setSavedContent('');
      setFmEntries([]);
      setMarkdownBody('');
      setFileMtimeMs(0);
      setIsDirty(false);
      setBacklinks([]);
      setMentions([]);
      return;
    }

    setPageLoading(true);
    setPageError(null);
    try {
      const resp: FileReadResponse = await window.openadab.readFile({
        filePath: selectedPagePath,
        encoding: 'utf-8',
      });
      setFileContent(resp.content);
      setSavedContent(resp.content);
      setFileMtimeMs(resp.mtimeMs);
      setIsDirty(false);

      const parsed = parseFrontmatter(resp.content);
      setFmEntries(parsed.entries);
      setMarkdownBody(parsed.body);

      // Extract backlinks
      setBacklinks(extractWikilinks(parsed.body));
    } catch (e) {
      setPageError(e instanceof Error ? e.message : String(e));
      setFileContent('');
    } finally {
      setPageLoading(false);
    }
  }, [selectedPagePath]);

  useEffect(() => {
    loadPage();
  }, [loadPage]);

  // ── Load mentions and lint ──
  const loadMentionsAndLint = useCallback(async () => {
    if (!projectInfo || !currentPageName) return;

    // Mentions: read wikilinks.json from adab/index/
    try {
      const indexPath = `${projectInfo.projectRoot.replace(/[/\\]$/, '')}/adab/index/wikilinks.json`;
      const resp: FileReadResponse = await window.openadab.readFile({
        filePath: indexPath,
        encoding: 'utf-8',
      });
      const linkData = JSON.parse(resp.content) as WikiLinkEntry[] | { entries?: WikiLinkEntry[] };
      const entries: WikiLinkEntry[] = Array.isArray(linkData) ? linkData : (linkData as { entries?: WikiLinkEntry[] }).entries ?? [];
      const mentionSources = entries
        .filter((e) => e.target === currentPageName)
        .map((e) => e.source)
        .filter((s) => s !== currentPageName);
      setMentions([...new Set(mentionSources)]);
    } catch {
      setMentions([]);
    }
  }, [projectInfo, currentPageName]);

  useEffect(() => {
    loadMentionsAndLint();
  }, [loadMentionsAndLint]);

  // ── Wiki lint ──
  const runLint = useCallback(async () => {
    if (!projectInfo) return;
    setLintLoading(true);
    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: ['wiki', 'lint', '--json'],
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });
      if (event.exitCode === 0 && event.parsedJson) {
        const result = event.parsedJson as WikiLintResult;
        const pageIssues = {
          errors: (result.errors || []).filter((e) => e.includes(currentPageName)),
          warnings: (result.warnings || []).filter((w) => w.includes(currentPageName)),
        };
        setLintIssues(pageIssues);
      } else if (event.parsedJson) {
        const result = event.parsedJson as WikiLintResult;
        const pageIssues = {
          errors: (result.errors || []).filter((e) => e.includes(currentPageName)),
          warnings: (result.warnings || []).filter((w) => w.includes(currentPageName)),
        };
        setLintIssues(pageIssues);
      }
    } catch {
      setLintIssues({ errors: [], warnings: [] });
    } finally {
      setLintLoading(false);
    }
  }, [projectInfo, currentPageName]);

  useEffect(() => {
    if (currentPageName) {
      runLint();
    }
  }, [currentPageName, runLint]);

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
    // Update backlinks in real-time
    setBacklinks(extractWikilinks(body));
  }, []);

  useEffect(() => {
    const newContent = serializeFrontmatter(fmEntries, markdownBody);
    setFileContent(newContent);
    setIsDirty(newContent !== latestSavedRef.current);
  }, [fmEntries, markdownBody]);

  // ── Save ──
  const handleSave = useCallback(async () => {
    if (!selectedPagePath || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      const resp: FileWriteResponse = await window.openadab.writeFile({
        filePath: selectedPagePath,
        content: fileContent,
        encoding: 'utf-8',
        expectedMtimeMs: fileMtimeMs > 0 ? fileMtimeMs : undefined,
      });
      if (resp.conflict) {
        try {
          const diskResp: FileReadResponse = await window.openadab.readFile({
            filePath: selectedPagePath,
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
      setSaveError(null);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Save failed.');
    } finally {
      setSaving(false);
    }
  }, [selectedPagePath, fileContent, fileMtimeMs, saving]);

  const handleConfirmOverwrite = useCallback(async () => {
    setShowDiff(false);
    setSaving(true);
    setSaveError(null);
    try {
      const resp: FileWriteResponse = await window.openadab.writeFile({
        filePath: selectedPagePath!,
        content: fileContent,
        encoding: 'utf-8',
      });
      setSavedContent(fileContent);
      setFileMtimeMs(resp.mtimeMs);
      setIsDirty(false);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Overwrite failed.');
    } finally {
      setSaving(false);
    }
  }, [selectedPagePath, fileContent]);

  const handleCancelOverwrite = useCallback(() => {
    setShowDiff(false);
    setSaving(false);
  }, []);

  // ── Navigate to a backlink or mention ──
  const handleNavigateToPage = useCallback(
    (pageName: string) => {
      if (!projectInfo) return;
      // Try to find the page in common categories
      const categories = ['characters', 'locations', 'threads', 'rules', 'events'];
      (async () => {
        for (const cat of categories) {
          const tryPath = `${projectInfo.projectRoot.replace(/[/\\]$/, '')}/adab/wiki/${cat}/${pageName}.md`;
          try {
            await window.openadab.readFile({ filePath: tryPath, encoding: 'utf-8' });
            setSelectedPagePath(tryPath);
            return;
          } catch {
            // continue trying
          }
        }
      })().catch(() => {});
    },
    [projectInfo],
  );

  // ── Render ──
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
        <h2 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 600, color: '#374151' }}>
          No Project Open
        </h2>
        <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
          Open a project to browse the wiki.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <PageBrowser
        projectRoot={projectInfo.projectRoot}
        selectedWikiPage={selectedPagePath}
        onSelectPage={setSelectedPagePath}
      />

      {/* Right pane: editor or empty state */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {!selectedPagePath && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: '0.82rem',
            }}
          >
            Select a wiki page to view or edit.
          </div>
        )}

        {selectedPagePath && (
          <>
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
                  fontSize: '0.8rem',
                  fontWeight: 700,
                  color: '#1f2937',
                  fontFamily: 'monospace',
                }}
              >
                {currentPageName}
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

              <button
                type="button"
                onClick={handleSave}
                disabled={!isDirty || saving}
                title="Save (Ctrl+S)"
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

            {/* Page loading */}
            {pageLoading && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 40,
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
                  Loading page…
                </span>
              </div>
            )}

            {/* Page error */}
            {!pageLoading && pageError && (
              <div
                style={{
                  padding: 12,
                  margin: 8,
                  backgroundColor: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  fontSize: '0.72rem',
                  color: '#dc2626',
                }}
              >
                Failed to load page: {pageError}
                <button
                  type="button"
                  onClick={loadPage}
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
            )}

            {/* Frontmatter */}
            {!pageLoading && !pageError && (
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
                  disabled={pageLoading || saving}
                />
              </div>
            )}

            {/* Lint warnings */}
            {!pageLoading && !pageError && (lintIssues.errors.length > 0 || lintIssues.warnings.length > 0) && (
              <div
                style={{
                  padding: '6px 14px',
                  borderBottom: '1px solid #fde68a',
                  backgroundColor: '#fffbeb',
                  flexShrink: 0,
                }}
              >
                {lintIssues.errors.map((e, i) => (
                  <div key={`err-${i}`} style={{ fontSize: '0.65rem', color: '#dc2626', fontFamily: 'monospace' }}>
                    ⚠ {e}
                  </div>
                ))}
                {lintIssues.warnings.map((w, i) => (
                  <div key={`warn-${i}`} style={{ fontSize: '0.65rem', color: '#d97706', fontFamily: 'monospace' }}>
                    ⚡ {w}
                  </div>
                ))}
                <button
                  type="button"
                  onClick={runLint}
                  disabled={lintLoading}
                  style={{
                    marginTop: 4,
                    padding: '2px 8px',
                    border: '1px solid #fde68a',
                    borderRadius: 3,
                    backgroundColor: '#fff',
                    color: '#92400e',
                    fontSize: '0.6rem',
                    fontWeight: 600,
                    cursor: lintLoading ? 'not-allowed' : 'pointer',
                  }}
                >
                  {lintLoading ? 'Linting…' : 'Re-lint'}
                </button>
              </div>
            )}

            {/* Split editor */}
            {!pageLoading && !pageError && (
              <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                <div
                  style={{
                    flex: 1,
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
                    disabled={pageLoading || saving}
                    onSave={handleSave}
                  />
                </div>
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
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
            )}

            {/* Side info panels (backlinks + mentions) */}
            {!pageLoading && !pageError && (
              <div
                style={{
                  borderTop: '1px solid #e5e7eb',
                  backgroundColor: '#f9fafb',
                  padding: '8px 14px',
                  display: 'flex',
                  gap: 16,
                  flexShrink: 0,
                  flexWrap: 'wrap',
                }}
              >
                {/* Backlinks */}
                <div style={{ minWidth: 120 }}>
                  <div
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Backlinks ({backlinks.length})
                  </div>
                  {backlinks.length === 0 && (
                    <span style={{ fontSize: '0.62rem', color: '#9ca3af' }}>
                      None
                    </span>
                  )}
                  {backlinks.map((link) => (
                    <button
                      key={link}
                      type="button"
                      onClick={() => handleNavigateToPage(link)}
                      style={{
                        display: 'inline-block',
                        margin: '1px 4px 1px 0',
                        padding: '1px 6px',
                        border: '1px solid #d1d5db',
                        borderRadius: 3,
                        backgroundColor: '#fff',
                        color: '#2563eb',
                        fontSize: '0.62rem',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                      }}
                    >
                      [[{link}]]
                    </button>
                  ))}
                </div>

                {/* Mentions */}
                <div style={{ minWidth: 120 }}>
                  <div
                    style={{
                      fontSize: '0.62rem',
                      fontWeight: 700,
                      color: '#6b7280',
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      marginBottom: 4,
                    }}
                  >
                    Mentions ({mentions.length})
                  </div>
                  {mentions.length === 0 && (
                    <span style={{ fontSize: '0.62rem', color: '#9ca3af' }}>
                      None
                    </span>
                  )}
                  {mentions.map((mention) => (
                    <button
                      key={mention}
                      type="button"
                      onClick={() => handleNavigateToPage(mention)}
                      style={{
                        display: 'inline-block',
                        margin: '1px 4px 1px 0',
                        padding: '1px 6px',
                        border: '1px solid #d1d5db',
                        borderRadius: 3,
                        backgroundColor: '#fff',
                        color: '#059669',
                        fontSize: '0.62rem',
                        fontFamily: 'monospace',
                        cursor: 'pointer',
                      }}
                    >
                      ← {mention}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
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

export default WikiWorkspace;
