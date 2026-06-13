/**
 * ChapterBinder — sidebar listing chapters from the manuscript directory.
 *
 * Lists chapter files from `adab/manuscript/chapters/` via `window.openadab.listDir()`.
 * Each chapter entry shows its filename, frontmatter title (if available),
 * status, and word count. Clicking a chapter selects it for preview.
 *
 * Handles loading, empty, and error states.
 */

import React, { useState, useEffect, useCallback } from 'react';
import type { FileListDirResponse } from '../../../shared/ipc-types.js';

/** Summary metadata for a single chapter. */
export interface ChapterSummary {
  /** File name (e.g. "ch-001.md"). */
  name: string;
  /** Full file path relative to project root. */
  path: string;
  /** Parsed chapter title from frontmatter, or fallback to filename. */
  title: string;
  /** Chapter status from frontmatter (e.g. "draft", "done"). */
  status: string;
  /** Approximate word count of the body text. */
  wordCount: number;
  /** File modification timestamp. */
  mtimeMs: number;
}

interface ChapterBinderProps {
  /** Absolute project root path. */
  projectRoot: string;
  /** Currently selected chapter path, or null. */
  selectedChapterPath: string | null;
  /** Called when a chapter is clicked. */
  onSelectChapter: (chapterPath: string) => void;
}

/** Regex: captures optional frontmatter block. */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

/** Extract a frontmatter key value by simple colon-split parsing. */
function extractFmValue(fmBlock: string, key: string): string {
  for (const line of fmBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}:`)) {
      return trimmed.slice(key.length + 1).trim();
    }
  }
  return '';
}

/** Count words in a markdown body string (split by whitespace, filter empty). */
function countWords(body: string): number {
  return body.split(/\s+/).filter((w) => w.length > 0).length;
}

const CHAPTER_DIR = 'adab/manuscript/chapters';

const ChapterBinder: React.FC<ChapterBinderProps> = ({
  projectRoot,
  selectedChapterPath,
  onSelectChapter,
}) => {
  const [chapters, setChapters] = useState<ChapterSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadChapters = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const dirPath = `${projectRoot.replace(/[/\\]$/, '')}/${CHAPTER_DIR}`;
      const listResp: FileListDirResponse = await window.openadab.listDir({
        dirPath,
      });

      const mdFiles = listResp.entries.filter(
        (e) => !e.isDirectory && e.name.endsWith('.md'),
      );

      const summaries: ChapterSummary[] = [];
      for (const file of mdFiles) {
        const filePath = `${dirPath}/${file.name}`;
        try {
          const readResp = await window.openadab.readFile({
            filePath,
            encoding: 'utf-8',
          });
          const content = readResp.content;
          const fmMatch = content.match(FM_RE);
          let title = file.name.replace(/\.md$/, '');
          let status = 'unknown';
          if (fmMatch) {
            const fmBlock = fmMatch[1];
            title = extractFmValue(fmBlock, 'title') || title;
            status = extractFmValue(fmBlock, 'status') || 'unknown';
          }
          const body = fmMatch ? content.slice(fmMatch[0].length).trim() : content;
          const wordCount = countWords(body);

          summaries.push({
            name: file.name,
            path: filePath,
            title,
            status,
            wordCount,
            mtimeMs: file.mtimeMs,
          });
        } catch {
          summaries.push({
            name: file.name,
            path: filePath,
            title: file.name.replace(/\.md$/, ''),
            status: 'unknown',
            wordCount: 0,
            mtimeMs: file.mtimeMs,
          });
        }
      }

      summaries.sort((a, b) => a.name.localeCompare(b.name));
      setChapters(summaries);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not exist')) {
        setError(null);
        setChapters([]);
      } else {
        setError(msg);
        setChapters([]);
      }
    } finally {
      setLoading(false);
    }
  }, [projectRoot]);

  useEffect(() => {
    if (projectRoot) {
      loadChapters();
    }
  }, [projectRoot, loadChapters]);

  const statusColor = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'done': return '#166534';
      case 'draft': return '#d97706';
      case 'outline': return '#6b7280';
      case 'revision': return '#2563eb';
      default: return '#9ca3af';
    }
  };

  const statusBg = (status: string): string => {
    switch (status.toLowerCase()) {
      case 'done': return '#f0fdf4';
      case 'draft': return '#fffbeb';
      case 'outline': return '#f9fafb';
      case 'revision': return '#eff6ff';
      default: return '#f9fafb';
    }
  };

  return (
    <div
      style={{
        width: 260,
        minWidth: 220,
        display: 'flex',
        flexDirection: 'column',
        borderRight: '1px solid #e5e7eb',
        backgroundColor: '#fafafa',
        fontFamily: 'system-ui, sans-serif',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '10px 14px',
          borderBottom: '1px solid #e5e7eb',
          backgroundColor: '#f3f4f6',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <span
          style={{
            fontSize: '0.75rem',
            fontWeight: 700,
            color: '#374151',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
          }}
        >
          Chapters
        </span>
        <button
          type="button"
          onClick={loadChapters}
          disabled={loading}
          title="Refresh chapter list"
          style={{
            padding: '2px 6px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.65rem',
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          ↻
        </button>
      </div>

      {/* Chapter list */}
      <div style={{ flex: 1, overflow: 'auto' }}>
        {loading && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '40px 12px',
              gap: 8,
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
            <span style={{ color: '#9ca3af', fontSize: '0.72rem' }}>
              Loading chapters…
            </span>
          </div>
        )}

        {!loading && error && (
          <div
            style={{
              padding: 12,
              margin: 8,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 4,
              fontSize: '0.7rem',
              color: '#dc2626',
            }}
          >
            {error}
            <button
              type="button"
              onClick={loadChapters}
              style={{
                display: 'block',
                marginTop: 6,
                padding: '3px 8px',
                border: '1px solid #fecaca',
                borderRadius: 3,
                backgroundColor: '#fff',
                color: '#dc2626',
                fontSize: '0.65rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && !error && chapters.length === 0 && (
          <div
            style={{
              padding: '40px 12px',
              textAlign: 'center',
              fontSize: '0.72rem',
              color: '#9ca3af',
            }}
          >
            No chapters found.
            <br />
            <span style={{ fontSize: '0.65rem' }}>
              Sync a change to add chapters.
            </span>
          </div>
        )}

        {!loading &&
          !error &&
          chapters.map((ch) => {
            const isSelected = selectedChapterPath === ch.path;
            return (
              <button
                key={ch.name}
                type="button"
                onClick={() => onSelectChapter(ch.path)}
                style={{
                  display: 'block',
                  width: '100%',
                  textAlign: 'left',
                  padding: '8px 14px',
                  border: 'none',
                  borderBottom: '1px solid #f3f4f6',
                  backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                  cursor: 'pointer',
                  transition: 'background-color 0.1s',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: 2,
                  }}
                >
                  <span
                    style={{
                      fontSize: '0.78rem',
                      fontWeight: 600,
                      color: isSelected ? '#1d4ed8' : '#1f2937',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      maxWidth: 160,
                    }}
                  >
                    {ch.title}
                  </span>
                  <span
                    style={{
                      fontSize: '0.6rem',
                      fontWeight: 600,
                      padding: '1px 5px',
                      borderRadius: 3,
                      backgroundColor: statusBg(ch.status),
                      color: statusColor(ch.status),
                      border: `1px solid ${statusColor(ch.status)}22`,
                      flexShrink: 0,
                    }}
                  >
                    {ch.status}
                  </span>
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 10,
                    fontSize: '0.62rem',
                    color: '#9ca3af',
                  }}
                >
                  <span>{ch.name}</span>
                  <span>{ch.wordCount.toLocaleString()} words</span>
                </div>
              </button>
            );
          })}
      </div>
    </div>
  );
};

export default ChapterBinder;
