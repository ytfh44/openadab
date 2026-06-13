/**
 * TimelineEventCard — single timeline event with metadata and source evidence link.
 *
 * Displays an event's title, date/story-time, related characters/locations,
 * event type badge, description, and a source evidence link that navigates
 * to the originating manuscript chapter or wiki page.
 *
 * Used by TimelineWorkspace to render individual events in the chronological list.
 */

import React from 'react';

/** A single timeline event shape. */
export interface TimelineEvent {
  /** Unique identifier (derived from chapter + index). */
  id: string;
  /** Event title or summary. */
  title: string;
  /** Chapter identifier the event belongs to. */
  chapter: string;
  /** Event category. */
  type: 'knowledge' | 'relationship' | 'thread_status' | 'state' | 'other';
  /** Human-readable description. */
  description: string;
  /** ISO timestamp from progression data. */
  timestamp: string;
  /** Story-time label if available from chapter frontmatter. */
  storyTime?: string;
  /** Related entities (characters, locations). */
  relatedEntities: string[];
  /** Source chapter file path for navigation. */
  sourceChapterPath?: string;
  /** Source wiki page name for navigation. */
  sourceWikiPage?: string;
}

interface TimelineEventCardProps {
  /** The event to display. */
  event: TimelineEvent;
  /** Called when source chapter is clicked. */
  onNavigateToChapter?: (chapterPath: string) => void;
  /** Called when source wiki page is clicked. */
  onNavigateToWiki?: (pageName: string) => void;
}

const typeColors: Record<TimelineEvent['type'], { bg: string; text: string; border: string }> = {
  knowledge: { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe' },
  relationship: { bg: '#fdf2f8', text: '#be185d', border: '#fbcfe8' },
  thread_status: { bg: '#f0fdf4', text: '#166534', border: '#bbf7d0' },
  state: { bg: '#fffbeb', text: '#92400e', border: '#fde68a' },
  other: { bg: '#f9fafb', text: '#6b7280', border: '#e5e7eb' },
};

const TimelineEventCard: React.FC<TimelineEventCardProps> = ({
  event,
  onNavigateToChapter,
  onNavigateToWiki,
}) => {
  const colors = typeColors[event.type] || typeColors.other;

  return (
    <div
      style={{
        border: '1px solid #e5e7eb',
        borderRadius: 6,
        backgroundColor: '#fff',
        padding: '12px 14px',
        fontFamily: 'system-ui, sans-serif',
        transition: 'box-shadow 0.15s',
      }}
    >
      {/* Header row */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          marginBottom: 6,
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontSize: '0.82rem',
              fontWeight: 700,
              color: '#1f2937',
              marginBottom: 2,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {event.title}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <span
              style={{
                fontSize: '0.62rem',
                fontFamily: 'monospace',
                color: '#9ca3af',
              }}
            >
              {event.chapter}
            </span>
            {event.storyTime && (
              <span
                style={{
                  fontSize: '0.62rem',
                  color: '#6b7280',
                }}
              >
                📅 {event.storyTime}
              </span>
            )}
          </div>
        </div>

        <span
          style={{
            fontSize: '0.58rem',
            fontWeight: 700,
            padding: '2px 8px',
            borderRadius: 3,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            backgroundColor: colors.bg,
            color: colors.text,
            border: `1px solid ${colors.border}`,
            flexShrink: 0,
          }}
        >
          {event.type.replace('_', ' ')}
        </span>
      </div>

      {/* Description */}
      <div
        style={{
          fontSize: '0.75rem',
          color: '#374151',
          lineHeight: 1.5,
          marginBottom: 6,
        }}
      >
        {event.description}
      </div>

      {/* Related entities */}
      {event.relatedEntities.length > 0 && (
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
            marginBottom: 8,
          }}
        >
          {event.relatedEntities.map((entity) => (
            <span
              key={entity}
              style={{
                fontSize: '0.6rem',
                padding: '1px 6px',
                borderRadius: 3,
                backgroundColor: '#f3f4f6',
                color: '#374151',
                border: '1px solid #e5e7eb',
                fontFamily: 'monospace',
              }}
            >
              {entity}
            </span>
          ))}
        </div>
      )}

      {/* Source evidence links */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          borderTop: '1px solid #f3f4f6',
          paddingTop: 6,
        }}
      >
        {event.sourceChapterPath && onNavigateToChapter && (
          <button
            type="button"
            onClick={() => onNavigateToChapter(event.sourceChapterPath!)}
            style={{
              padding: '2px 8px',
              border: '1px solid #d1d5db',
              borderRadius: 3,
              backgroundColor: '#fff',
              color: '#2563eb',
              fontSize: '0.6rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
            title={`Open chapter: ${event.sourceChapterPath}`}
          >
            📄 Ch. {event.chapter}
          </button>
        )}
        {event.sourceWikiPage && onNavigateToWiki && (
          <button
            type="button"
            onClick={() => onNavigateToWiki(event.sourceWikiPage!)}
            style={{
              padding: '2px 8px',
              border: '1px solid #d1d5db',
              borderRadius: 3,
              backgroundColor: '#fff',
              color: '#059669',
              fontSize: '0.6rem',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'monospace',
            }}
            title={`Open wiki page: ${event.sourceWikiPage}`}
          >
            📝 {event.sourceWikiPage}
          </button>
        )}
      </div>
    </div>
  );
};

export default TimelineEventCard;
