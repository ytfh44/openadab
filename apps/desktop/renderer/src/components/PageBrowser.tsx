/**
 * PageBrowser — wiki page list sidebar with type category filtering.
 *
 * Lists wiki pages organized by type category (characters/, locations/,
 * threads/, rules/, etc.). Each category is a collapsible section.
 * Clicking a page selects it for viewing/editing in WikiWorkspace.
 *
 * Handles loading, empty, and error states.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type { FileListDirResponse } from '../../../shared/ipc-types.js';

/** Summary for a single wiki page. */
export interface WikiPageSummary {
  /** Page filename without extension (e.g. "protagonist") */
  name: string;
  /** Category directory (e.g. "characters") */
  category: string;
  /** Full path relative to wiki dir. */
  path: string;
  /** Absolute file path. */
  absPath: string;
  /** Page type from frontmatter (e.g. "character", "location"). */
  pageType: string;
  /** Page title from frontmatter. */
  title: string;
  /** File modification timestamp. */
  mtimeMs: number;
}

interface PageBrowserProps {
  /** Absolute project root path. */
  projectRoot: string;
  /** Currently selected wiki page path. */
  selectedWikiPage: string | null;
  /** Called when a page is clicked. */
  onSelectPage: (pagePath: string) => void;
}

const WIKI_DIR = 'adab/wiki';

/** Regex: captures optional frontmatter. */
const FM_RE = /^---\r?\n([\s\S]*?)\r?\n---/;

function extractFmValue(fmBlock: string, key: string): string {
  for (const line of fmBlock.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith(`${key}:`)) {
      return trimmed.slice(key.length + 1).trim();
    }
  }
  return '';
}

const PageBrowser: React.FC<PageBrowserProps> = ({
  projectRoot,
  selectedWikiPage,
  onSelectPage,
}) => {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(
    new Set(),
  );

  const loadPages = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const wikiAbsDir = `${projectRoot.replace(/[/\\]$/, '')}/${WIKI_DIR}`;
      const listResp: FileListDirResponse = await window.openadab.listDir({
        dirPath: wikiAbsDir,
      });

      const categories = listResp.entries.filter((e) => e.isDirectory);
      const allPages: WikiPageSummary[] = [];

      for (const cat of categories) {
        // Skip non-content dirs
        if (cat.name.startsWith('.') || cat.name === 'index.md') continue;

        try {
          const catDir = `${wikiAbsDir}/${cat.name}`;
          const catList: FileListDirResponse = await window.openadab.listDir({
            dirPath: catDir,
          });

          for (const file of catList.entries) {
            if (file.isDirectory || !file.name.endsWith('.md')) continue;
            const absPath = `${catDir}/${file.name}`;
            const relPath = `${cat.name}/${file.name}`;

            let title = file.name.replace(/\.md$/, '');
            let pageType = cat.name;

            try {
              const readResp = await window.openadab.readFile({
                filePath: absPath,
                encoding: 'utf-8',
              });
              const fmMatch = readResp.content.match(FM_RE);
              if (fmMatch) {
                const fm = fmMatch[1];
                title = extractFmValue(fm, 'title') || title;
                pageType = extractFmValue(fm, 'type') || cat.name;
              }
            } catch {
              // Use defaults — page might be unreadable
            }

            allPages.push({
              name: file.name.replace(/\.md$/, ''),
              category: cat.name,
              path: relPath,
              absPath,
              pageType,
              title,
              mtimeMs: file.mtimeMs,
            });
          }
        } catch {
          // Category directory might not be readable
        }
      }

      allPages.sort((a, b) => {
        if (a.category !== b.category) return a.category.localeCompare(b.category);
        return a.name.localeCompare(b.name);
      });

      setPages(allPages);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (msg.includes('ENOENT') || msg.includes('not found') || msg.includes('not exist')) {
        setError(null);
        setPages([]);
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [projectRoot]);

  useEffect(() => {
    if (projectRoot) {
      loadPages();
    }
  }, [projectRoot, loadPages]);

  // Group pages by category
  const grouped = useMemo(() => {
    const map = new Map<string, WikiPageSummary[]>();
    for (const p of pages) {
      const list = map.get(p.category) || [];
      list.push(p);
      map.set(p.category, list);
    }
    return map;
  }, [pages]);

  const toggleCategory = useCallback((cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return next;
    });
  }, []);

  return (
    <div
      style={{
        width: 250,
        minWidth: 200,
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
          Wiki Pages
        </span>
        <button
          type="button"
          onClick={loadPages}
          disabled={loading}
          title="Refresh page list"
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

      {/* Page list */}
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
              Loading pages…
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
              onClick={loadPages}
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

        {!loading && !error && pages.length === 0 && (
          <div
            style={{
              padding: '40px 12px',
              textAlign: 'center',
              fontSize: '0.72rem',
              color: '#9ca3af',
            }}
          >
            No wiki pages found.
          </div>
        )}

        {!loading &&
          !error &&
          Array.from(grouped.entries()).map(([category, catPages]) => {
            const collapsed = collapsedCategories.has(category);
            return (
              <div key={category}>
                {/* Category header */}
                <button
                  type="button"
                  onClick={() => toggleCategory(category)}
                  style={{
                    display: 'flex',
                    width: '100%',
                    alignItems: 'center',
                    gap: 4,
                    padding: '6px 14px',
                    border: 'none',
                    borderBottom: '1px solid #e5e7eb',
                    backgroundColor: '#f3f4f6',
                    cursor: 'pointer',
                    fontSize: '0.7rem',
                    fontWeight: 700,
                    color: '#6b7280',
                    textTransform: 'capitalize',
                  }}
                >
                  <span style={{ fontSize: '0.6rem' }}>
                    {collapsed ? '▸' : '▾'}
                  </span>
                  {category}
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: '0.6rem',
                      color: '#9ca3af',
                      fontWeight: 400,
                    }}
                  >
                    {catPages.length}
                  </span>
                </button>

                {/* Page entries */}
                {!collapsed &&
                  catPages.map((page) => {
                    const isSelected = selectedWikiPage === page.absPath;
                    return (
                      <button
                        key={page.path}
                        type="button"
                        onClick={() => onSelectPage(page.absPath)}
                        style={{
                          display: 'block',
                          width: '100%',
                          textAlign: 'left',
                          padding: '6px 14px 6px 24px',
                          border: 'none',
                          borderBottom: '1px solid #f3f4f6',
                          backgroundColor: isSelected ? '#eff6ff' : 'transparent',
                          cursor: 'pointer',
                          fontSize: '0.72rem',
                          color: isSelected ? '#1d4ed8' : '#374151',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {page.title || page.name}
                      </button>
                    );
                  })}
              </div>
            );
          })}
      </div>
    </div>
  );
};

export default PageBrowser;
