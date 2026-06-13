/**
 * TimelineWorkspace — chronological timeline of story events.
 *
 * Reads `progressions.json`, `mentions.json`, and chapter files to build
 * a chronological event list. Each event is displayed as a TimelineEventCard
 * with source evidence links back to manuscript chapters or wiki pages.
 *
 * Detects stale-index states by comparing index file mtimes with source
 * file mtimes, displaying a warning banner when indices are outdated.
 *
 * Supports navigation to manuscript and wiki routes via app-level routing.
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import type {
  ProjectInfo,
  FileReadResponse,
  FileListDirResponse,
  CommandEvent,
} from '../../../shared/ipc-types.js';
import TimelineEventCard from '../components/TimelineEventCard.js';
import type { TimelineEvent } from '../components/TimelineEventCard.js';

interface TimelineWorkspaceProps {
  /** Current project info. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is loading. */
  loading: boolean;
  /** Called to navigate to a manuscript chapter. */
  onNavigateToManuscript?: (chapterPath: string) => void;
  /** Called to navigate to a wiki page. */
  onNavigateToWiki?: (wikiPage: string) => void;
}

function genCommandId(): string {
  return crypto.randomUUID();
}

/**
 * Build the CLI args used by Timeline when it can refresh index data without
 * a selected change id.
 *
 * @returns Arguments for a read/write maintenance command that does not
 * require `--change`.
 */
export function buildTimelineIndexRefreshArgs(): string[] {
  return ['wiki', 'index', '--json'];
}

/** Shape from progressions.json chapters[].events[]. */
interface ProgEventRaw {
  chapter: string;
  entity: string;
  type: string;
  change: string;
  timestamp: string;
  relatedEntity?: string;
  from?: string;
  to?: string;
}

interface ProgChapterRaw {
  chapter: string;
  events: ProgEventRaw[];
}

interface ProgressionsRaw {
  chapters: ProgChapterRaw[];
}

/** Shape from mentions.json (simplified). */
interface MentionRaw {
  source: string;
  target: string;
  context?: string;
  chapter?: string;
}

interface MentionsRaw {
  entries?: MentionRaw[];
}

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

const TimelineWorkspace: React.FC<TimelineWorkspaceProps> = ({
  projectInfo,
  loading,
  onNavigateToManuscript,
  onNavigateToWiki,
}) => {
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [dataLoading, setDataLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staleWarnings, setStaleWarnings] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<TimelineEvent['type'] | 'all'>('all');

  const loadTimeline = useCallback(async () => {
    if (!projectInfo) return;
    setDataLoading(true);
    setError(null);
    setStaleWarnings([]);

    try {
      const root = projectInfo.projectRoot.replace(/[/\\]$/, '');
      const indexDir = `${root}/adab/index`;
      const manuscriptChaptersDir = `${root}/adab/manuscript/chapters`;

      // ── Read progressions.json ──
      let progResp: FileReadResponse;
      try {
        progResp = await window.openadab.readFile({
          filePath: `${indexDir}/progressions.json`,
          encoding: 'utf-8',
        });
      } catch {
        setError('progressions.json not found. Run `openadab wiki index` to generate timeline data.');
        setEvents([]);
        return;
      }

      const progData: ProgressionsRaw = JSON.parse(progResp.content);
      const progMtime = progResp.mtimeMs;

      // ── Read mentions.json ──
      let mentionEntries: MentionRaw[] = [];
      try {
        const menResp = await window.openadab.readFile({
          filePath: `${indexDir}/mentions.json`,
          encoding: 'utf-8',
        });
        const menData: MentionsRaw = JSON.parse(menResp.content);
        mentionEntries = menData.entries ?? [];
      } catch {
        // Mentions are optional
      }

      // ── Build timeline events ──
      const timelineEvents: TimelineEvent[] = [];
      const stalePaths: string[] = [];

      if (progData.chapters) {
        for (const chapter of progData.chapters) {
          const chapterId = chapter.chapter;

          // Try to find chapter file for story time
          let chapterFilePath = '';
          let storyTime: string | undefined;
          try {
            const chDirResp: FileListDirResponse = await window.openadab.listDir({
              dirPath: manuscriptChaptersDir,
            });
            const match = chDirResp.entries.find(
              (e) => e.name.startsWith(chapterId) || e.name === `${chapterId}.md`,
            );
            if (match) {
              chapterFilePath = `${manuscriptChaptersDir}/${match.name}`;
              try {
                const chRead = await window.openadab.readFile({
                  filePath: chapterFilePath,
                  encoding: 'utf-8',
                });
                const fmMatch = chRead.content.match(FM_RE);
                if (fmMatch) {
                  storyTime = extractFmValue(fmMatch[1], 'story_time') || extractFmValue(fmMatch[1], 'date') || undefined;
                }
                // Check stale: if chapter file is newer than progressions
                if (chRead.mtimeMs > progMtime + 1000) {
                  stalePaths.push(chapterId);
                }
              } catch {
                // Chapter file might not be readable
              }
            }
          } catch {
            // Manuscript directory might not exist
          }

          for (const evt of chapter.events) {
            const relatedEntities: string[] = [evt.entity];
            if (evt.relatedEntity) relatedEntities.push(evt.relatedEntity);

            // Find matching wiki page for the entity
            const sourceWikiPage = evt.entity;

            timelineEvents.push({
              id: `${chapterId}-${timelineEvents.length}`,
              title: `${evt.entity}: ${evt.change}`,
              chapter: chapterId,
              type: (evt.type as TimelineEvent['type']) || 'other',
              description: evt.change,
              timestamp: evt.timestamp,
              storyTime,
              relatedEntities,
              sourceChapterPath: chapterFilePath || undefined,
              sourceWikiPage: sourceWikiPage || undefined,
            });
          }
        }
      }

      // Add mention-based events
      for (const mention of mentionEntries) {
        if (mention.chapter) {
          timelineEvents.push({
            id: `mention-${timelineEvents.length}`,
            title: `[[${mention.target}]] mentioned in ${mention.source}`,
            chapter: mention.chapter,
            type: 'other',
            description: mention.context || `Reference to ${mention.target} from ${mention.source}`,
            timestamp: new Date().toISOString(),
            relatedEntities: [mention.source, mention.target],
            sourceWikiPage: mention.target,
          });
        }
      }

      // Sort by timestamp (ascending)
      timelineEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      setEvents(timelineEvents);

      // Stale-index detection
      const uniqueStale = [...new Set(stalePaths)];
      if (uniqueStale.length > 0) {
        setStaleWarnings([
          `Chapters with data newer than index: ${uniqueStale.join(', ')}. Run \`openadab wiki index\` to refresh.`,
        ]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setEvents([]);
    } finally {
      setDataLoading(false);
    }
  }, [projectInfo]);

  useEffect(() => {
    if (projectInfo) {
      loadTimeline();
    }
  }, [projectInfo, loadTimeline]);

  // ── Filter ──
  const filteredEvents = useMemo(() => {
    return events.filter((evt) => {
      if (typeFilter !== 'all' && evt.type !== typeFilter) return false;
      if (!filter) return true;
      const f = filter.toLowerCase();
      return (
        evt.title.toLowerCase().includes(f) ||
        evt.description.toLowerCase().includes(f) ||
        evt.chapter.toLowerCase().includes(f) ||
        evt.relatedEntities.some((e) => e.toLowerCase().includes(f))
      );
    });
  }, [events, filter, typeFilter]);

  // ── Regenerate index handler ──
  const handleRegenerateIndex = useCallback(async () => {
    if (!projectInfo) return;
    setDataLoading(true);
    setError(null);
    try {
      const event: CommandEvent = await window.openadab.runCli({
        commandId: genCommandId(),
        args: buildTimelineIndexRefreshArgs(),
        cwd: projectInfo.projectRoot,
        initiator: 'user',
      });

      if (event.cancelled) {
        setError('Index refresh was cancelled.');
        return;
      }

      if (event.exitCode !== 0) {
        const errMsg =
          event.parseError ??
          event.stderr.trim() ??
          `Index refresh exited with code ${event.exitCode ?? 'unknown'}`;
        setError(errMsg);
        return;
      }

      await loadTimeline();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown index refresh error.');
    } finally {
      setDataLoading(false);
    }
  }, [projectInfo, loadTimeline]);

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
          Open a project to view the timeline.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        flex: 1,
        minHeight: 0,
        fontFamily: 'system-ui, sans-serif',
      }}
    >
      {/* Stale-index warning banner */}
      {staleWarnings.length > 0 && (
        <div
          style={{
            padding: '8px 14px',
            backgroundColor: '#fffbeb',
            borderBottom: '2px solid #f59e0b',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span style={{ fontSize: '1rem' }}>⚠️</span>
          <div style={{ flex: 1 }}>
            {staleWarnings.map((w, i) => (
              <div
                key={i}
                style={{
                  fontSize: '0.72rem',
                  color: '#92400e',
                  fontWeight: 600,
                }}
              >
                {w}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={handleRegenerateIndex}
            disabled={dataLoading}
            style={{
              padding: '4px 12px',
              border: '1px solid #f59e0b',
              borderRadius: 4,
              backgroundColor: '#fff',
              color: '#92400e',
              fontSize: '0.68rem',
              fontWeight: 700,
              cursor: dataLoading ? 'not-allowed' : 'pointer',
              flexShrink: 0,
            }}
          >
            {dataLoading ? 'Refreshing…' : 'Regenerate'}
          </button>
        </div>
      )}

      {/* Toolbar */}
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
            color: '#374151',
          }}
        >
          Timeline
        </span>

        <span
          style={{
            fontSize: '0.62rem',
            color: '#9ca3af',
            fontFamily: 'monospace',
          }}
        >
          {events.length} events
        </span>

        <span style={{ flex: 1 }} />

        {/* Type filter */}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TimelineEvent['type'] | 'all')}
          style={{
            padding: '3px 6px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            fontSize: '0.65rem',
            fontFamily: 'system-ui, sans-serif',
            color: '#374151',
            backgroundColor: '#fff',
          }}
        >
          <option value="all">All Types</option>
          <option value="knowledge">Knowledge</option>
          <option value="relationship">Relationship</option>
          <option value="thread_status">Thread Status</option>
          <option value="state">State</option>
          <option value="other">Other</option>
        </select>

        {/* Text filter */}
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter events…"
          style={{
            padding: '3px 8px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            fontSize: '0.65rem',
            fontFamily: 'system-ui, sans-serif',
            color: '#374151',
            backgroundColor: '#fff',
            width: 160,
          }}
        />

        <button
          type="button"
          onClick={loadTimeline}
          disabled={dataLoading}
          title="Refresh timeline"
          style={{
            padding: '3px 8px',
            border: '1px solid #d1d5db',
            borderRadius: 3,
            backgroundColor: '#fff',
            color: '#374151',
            fontSize: '0.65rem',
            fontWeight: 600,
            cursor: dataLoading ? 'not-allowed' : 'pointer',
          }}
        >
          ↻ Refresh
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 14px' }}>
        {/* Data loading */}
        {dataLoading && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 24px',
              gap: 12,
            }}
          >
            <span
              style={{
                width: 28,
                height: 28,
                borderRadius: '50%',
                border: '3px solid #d1d5db',
                borderTopColor: '#3b82f6',
                animation: 'spin 0.8s linear infinite',
                display: 'inline-block',
              }}
            />
            <span style={{ color: '#6b7280', fontSize: '0.82rem' }}>
              Loading timeline data…
            </span>
          </div>
        )}

        {/* Error */}
        {!dataLoading && error && (
          <div
            style={{
              padding: 16,
              backgroundColor: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              fontSize: '0.78rem',
              color: '#dc2626',
            }}
          >
            <div style={{ fontWeight: 600, marginBottom: 8 }}>
              Failed to load timeline
            </div>
            <pre
              style={{
                margin: 0,
                fontSize: '0.7rem',
                fontFamily: 'monospace',
                color: '#991b1b',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error}
            </pre>
            <button
              type="button"
              onClick={loadTimeline}
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

        {/* Empty state */}
        {!dataLoading && !error && events.length === 0 && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '60px 24px',
              gap: 12,
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
              ⏳
            </div>
            <p style={{ margin: 0, fontSize: '0.85rem', color: '#6b7280' }}>
              No timeline events found.
            </p>
            <p style={{ margin: 0, fontSize: '0.72rem', color: '#9ca3af' }}>
              Run <code style={{ fontFamily: 'monospace', backgroundColor: '#f3f4f6', padding: '1px 4px', borderRadius: 2 }}>openadab wiki index</code> to generate timeline data.
            </p>
          </div>
        )}

        {/* Event list */}
        {!dataLoading && !error && filteredEvents.length === 0 && events.length > 0 && (
          <div
            style={{
              padding: '40px 12px',
              textAlign: 'center',
              color: '#9ca3af',
              fontSize: '0.78rem',
            }}
          >
            No events match the current filter.
          </div>
        )}

        {!dataLoading &&
          !error &&
          filteredEvents.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              {filteredEvents.map((evt) => (
                <TimelineEventCard
                  key={evt.id}
                  event={evt}
                  onNavigateToChapter={
                    onNavigateToManuscript
                      ? (path) => onNavigateToManuscript(path)
                      : undefined
                  }
                  onNavigateToWiki={
                    onNavigateToWiki
                      ? (page) => onNavigateToWiki(page)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
      </div>
    </div>
  );
};

export default TimelineWorkspace;
