/**
 * ManuscriptWorkspace — manuscript route combining ChapterBinder and ChapterPreview.
 *
 * Provides a split-pane layout: left sidebar (ChapterBinder) lists chapters
 * from the manuscript directory, right pane (ChapterPreview) shows the selected
 * chapter with read-only preview and explicit edit mode.
 *
 * Supports navigation via `DesktopSelection.chapterPath`.
 */

import React, { useState, useCallback } from 'react';
import type { ProjectInfo } from '../../../shared/ipc-types.js';
import ChapterBinder from '../components/ChapterBinder.js';
import ChapterPreview from '../components/ChapterPreview.js';

interface ManuscriptWorkspaceProps {
  /** Current project info. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is loading. */
  loading: boolean;
  /** Initial chapter path from navigation target. */
  initialChapterPath?: string;
}

const ManuscriptWorkspace: React.FC<ManuscriptWorkspaceProps> = ({
  projectInfo,
  loading,
  initialChapterPath,
}) => {
  const [selectedChapterPath, setSelectedChapterPath] = useState<string | null>(
    initialChapterPath ?? null,
  );

  const handleSelectChapter = useCallback((chapterPath: string) => {
    setSelectedChapterPath(chapterPath);
  }, []);

  // ── Loading state ──
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

  // ── No project open ──
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
          Open a project to view the manuscript.
        </p>
      </div>
    );
  }

  // ── Main layout ──
  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        minHeight: 0,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      <ChapterBinder
        projectRoot={projectInfo.projectRoot}
        selectedChapterPath={selectedChapterPath}
        onSelectChapter={handleSelectChapter}
      />
      <ChapterPreview chapterPath={selectedChapterPath} />
    </div>
  );
};

export default ManuscriptWorkspace;
