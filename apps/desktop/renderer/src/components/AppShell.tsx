/**
 * AppShell — main three-column-plus-bottom-panel application layout.
 *
 * Structure:
 * ┌─────────────────────────────────────────────────────┐
 * │ Top bar: brand + project indicator + window controls │
 * ├────────┬──────────────────────────────┬─────────────┤
 * │  Left  │                              │   Right     │
 * │  Nav   │      Main Content Area       │  Inspector  │
 * │ ~200px │         (children)           │  ~320px     │
 * │        │                              │ (optional)  │
 * ├────────┴──────────────────────────────┴─────────────┤
 * │            TranscriptPanel (collapsible)             │
 * └─────────────────────────────────────────────────────┘
 *
 * Responsive breakpoints:
 * - ≥900px: full three-column layout
 * - 600-899px: inspector collapsed; left nav stays
 * - <600px: vertical stack (nav → content → transcript)
 *
 * Keyboard navigation:
 * - Tab order: nav tabs → main content → inspector → transcript
 * - Enter/Space activates focused elements
 * - Escape bubbles to parent for modal dismissal
 * - Arrow keys navigate within nav and DAG nodes
 *
 * Windows path handling:
 * - Paths are truncated with ellipsis in narrow containers
 * - Full path shown on hover via title attribute
 *
 * CJK text rendering:
 * - font-family includes Microsoft YaHei, SimHei, sans-serif
 * - word-break: break-word for Chinese text wrapping
 */

import React, {
  useState,
  useCallback,
  useEffect,
  useRef,
} from 'react';
import type {
  DesktopSelection,
  ProjectInfo,
} from '../../../shared/ipc-types.js';
import TranscriptPanel from './TranscriptPanel.js';

/** Ordered tab definitions for the left navigation bar. */
const TAB_DEFS: {
  route: DesktopSelection['route'];
  label: string;
  icon: string;
}[] = [
  { route: 'project', label: 'Project', icon: '◇' },
  { route: 'manuscript', label: 'Manuscript', icon: '≡' },
  { route: 'changes', label: 'Changes', icon: '↗' },
  { route: 'timeline', label: 'Timeline', icon: '◷' },
  { route: 'wiki', label: 'Wiki', icon: '☷' },
  { route: 'schemas', label: 'Schemas', icon: '◎' },
  { route: 'agent', label: 'Agent', icon: '◈' },
];

interface AppShellProps {
  /** Current desktop selection (route + project). */
  selection: DesktopSelection;
  /** Called to switch to a different route tab. */
  onNavigate: (route: DesktopSelection['route']) => void;
  /** Current project info, or null if no project is open. */
  projectInfo: ProjectInfo | null;
  /** Whether project info is still loading. */
  infoLoading: boolean;
  /** Called when the user wants to open an existing project. */
  onOpenExisting: () => void;
  /** Called when the user wants to refresh project info. */
  onRefresh: () => void;
  /** Main content area (route component). */
  children: React.ReactNode;
  /** Optional inspector panel content. */
  inspector?: React.ReactNode;
  /** Whether the inspector should be rendered. */
  showInspector?: boolean;
}

/**
 * Main application shell that wraps all content.
 *
 * Provides the consistent three-column-plus-bottom-panel layout
 * with responsive breakpoints, keyboard navigation support,
 * and the collapsible CLI transcript at the bottom.
 */
const AppShell: React.FC<AppShellProps> = ({
  selection,
  onNavigate,
  projectInfo,
  infoLoading,
  onOpenExisting,
  onRefresh,
  children,
  inspector,
  showInspector = false,
}) => {
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcriptHeight, setTranscriptHeight] = useState(280);
  const transcriptBarRef = useRef<HTMLDivElement>(null);

  /** Toggle transcript panel open/closed. */
  const toggleTranscript = useCallback(() => {
    setTranscriptOpen((prev) => !prev);
  }, []);

  /** Handle keyboard navigation within the shell. */
  const handleShellKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Escape is reserved for modal dismissal — bubble up
      if (e.key === 'Escape') {
        return;
      }
    },
    [],
  );

  /** Active route for nav highlighting. */
  const activeRoute = selection.route;

  return (
    <div
      onKeyDown={handleShellKeyDown}
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',
        fontFamily:
          "'Microsoft YaHei', 'SimHei', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        backgroundColor: '#f9fafb',
        color: '#1f2937',
      }}
    >
      {/* ── Top bar ── */}
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          backgroundColor: '#1f2937',
          padding: '0 12px',
          minHeight: 36,
          gap: 8,
          flexShrink: 0,
          zIndex: 20,
        }}
      >
        {/* Brand */}
        <span
          role="banner"
          aria-label="OpenAdab"
          tabIndex={0}
          style={{
            color: '#f9fafb',
            fontSize: '0.85rem',
            fontWeight: 700,
            letterSpacing: '-0.02em',
            userSelect: 'none',
          }}
        >
          OpenAdab
        </span>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Project indicator */}
        <span
          tabIndex={0}
          aria-label={
            projectInfo
              ? `Current project: ${projectInfo.title ?? projectInfo.projectRoot}`
              : 'No project open'
          }
          title={
            projectInfo
              ? (projectInfo.title ?? projectInfo.projectRoot)
              : 'No project open'
          }
          style={{
            fontSize: '0.7rem',
            color: projectInfo ? '#9ca3af' : '#ef4444',
            fontFamily: 'monospace',
            maxWidth: 320,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            padding: '0 4px',
          }}
        >
          {infoLoading
            ? 'Loading…'
            : projectInfo
              ? (projectInfo.title ?? projectInfo.projectRoot)
              : 'No project'}
        </span>

        {/* Open project button */}
        {!projectInfo && !infoLoading && (
          <button
            type="button"
            onClick={onOpenExisting}
            tabIndex={0}
            aria-label="Open a project"
            style={{
              padding: '3px 10px',
              border: '1px solid #4b5563',
              borderRadius: 4,
              backgroundColor: 'transparent',
              color: '#9ca3af',
              fontSize: '0.68rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            Open
          </button>
        )}

        {/* Refresh button */}
        {projectInfo && (
          <button
            type="button"
            onClick={onRefresh}
            tabIndex={0}
            aria-label="Refresh project info"
            title="Refresh project info"
            style={{
              padding: '3px 8px',
              border: '1px solid #4b5563',
              borderRadius: 4,
              backgroundColor: 'transparent',
              color: '#9ca3af',
              fontSize: '0.68rem',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
            }}
          >
            ↻
          </button>
        )}
      </header>

      {/* ── Main body: nav + content + inspector ── */}
      <div
        className="appshell-body"
        style={{
          display: 'flex',
          flex: 1,
          minHeight: 0,
          position: 'relative',
        }}
      >
        {/* ── Left nav sidebar ── */}
        <nav
          role="navigation"
          aria-label="Main navigation"
          className="appshell-left-nav"
          style={{
            display: 'flex',
            flexDirection: 'column',
            width: 200,
            minWidth: 160,
            flexShrink: 0,
            backgroundColor: '#111827',
            overflow: 'auto',
          }}
        >
          {TAB_DEFS.map((tab) => {
            const isActive = activeRoute === tab.route;
            return (
              <button
                key={tab.route}
                type="button"
                role="tab"
                aria-selected={isActive}
                tabIndex={0}
                onClick={() => onNavigate(tab.route)}
                onKeyDown={(e) => {
                  const idx = TAB_DEFS.findIndex((t) => t.route === tab.route);
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = TAB_DEFS[(idx + 1) % TAB_DEFS.length];
                    onNavigate(next.route);
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev =
                      TAB_DEFS[(idx - 1 + TAB_DEFS.length) % TAB_DEFS.length];
                    onNavigate(prev.route);
                  } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    onNavigate(tab.route);
                  }
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  width: '100%',
                  padding: '10px 14px',
                  border: 'none',
                  borderLeft: isActive ? '3px solid #60a5fa' : '3px solid transparent',
                  backgroundColor: isActive ? '#1f2937' : 'transparent',
                  color: isActive ? '#f9fafb' : '#9ca3af',
                  fontSize: '0.78rem',
                  fontWeight: isActive ? 600 : 400,
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'background-color 0.12s, border-color 0.12s, color 0.12s',
                }}
              >
                {/* Icon */}
                <span
                  aria-hidden="true"
                  style={{
                    fontSize: '0.95rem',
                    width: 20,
                    textAlign: 'center',
                    flexShrink: 0,
                  }}
                >
                  {tab.icon}
                </span>
                {/* Label */}
                <span style={{ lineHeight: 1.3 }}>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {/* ── Main content area ── */}
        <main
          className="appshell-main"
          role="main"
          aria-label="Main content"
          style={{
            flex: 1,
            minWidth: 0,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'auto',
          }}
        >
          {children}
        </main>

        {/* ── Right inspector panel ── */}
        {showInspector && inspector && (
          <aside
            className="appshell-inspector"
            role="complementary"
            aria-label="Inspector panel"
            style={{
              width: 320,
              minWidth: 240,
              flexShrink: 0,
              borderLeft: '2px solid #d1d5db',
              backgroundColor: '#f9fafb',
              overflow: 'auto',
            }}
          >
            {inspector}
          </aside>
        )}
      </div>

      {/* ── Bottom transcript bar + panel ── */}
      <div
        className="appshell-transcript-area"
        style={{
          flexShrink: 0,
          borderTop: '1px solid #d1d5db',
          backgroundColor: '#f3f4f6',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Transcript toggle bar */}
        <div
          ref={transcriptBarRef}
          role="button"
          tabIndex={0}
          aria-expanded={transcriptOpen}
          aria-label={
            transcriptOpen ? 'Collapse transcript' : 'Expand transcript'
          }
          onClick={toggleTranscript}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleTranscript();
            }
          }}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            cursor: 'pointer',
            userSelect: 'none',
            minHeight: 28,
          }}
        >
          <span
            style={{
              fontSize: '0.65rem',
              fontWeight: 700,
              color: '#6b7280',
              letterSpacing: '0.04em',
              textTransform: 'uppercase',
            }}
          >
            CLI Transcript
          </span>
          <span
            aria-hidden="true"
            style={{
              fontSize: '0.65rem',
              color: '#9ca3af',
              transition: 'transform 0.15s',
              transform: transcriptOpen ? 'rotate(180deg)' : 'rotate(0deg)',
            }}
          >
            ▲
          </span>
          <div style={{ flex: 1 }} />
          {transcriptOpen && (
            <span
              style={{
                fontSize: '0.6rem',
                color: '#9ca3af',
              }}
            >
              Click or press Escape to close
            </span>
          )}
        </div>

        {/* TranscriptPanel body (when open) */}
        {transcriptOpen && (
          <div
            style={{
              maxHeight: transcriptHeight,
              overflow: 'auto',
              borderTop: '1px solid #e5e7eb',
            }}
          >
            <TranscriptPanel maxHeight={`${transcriptHeight}px`} />
          </div>
        )}
      </div>

      {/* ── Responsive styles (injected via style element) ── */}
      <style>{`
        /* Below 900px: collapse inspector */
        @media (max-width: 899px) {
          .appshell-inspector {
            display: none !important;
          }
        }

        /* Below 600px: stack nav on top, content below */
        @media (max-width: 599px) {
          .appshell-body {
            flex-direction: column !important;
          }
          .appshell-left-nav {
            flex-direction: row !important;
            width: 100% !important;
            min-width: 0 !important;
            overflow-x: auto !important;
            flex-shrink: 0 !important;
          }
          .appshell-left-nav button {
            flex-shrink: 0 !important;
            border-left: none !important;
            border-bottom: 3px solid transparent !important;
          }
          .appshell-left-nav button[aria-selected="true"] {
            border-bottom-color: #60a5fa !important;
            border-left-color: transparent !important;
          }
          .appshell-main {
            min-height: 0 !important;
          }
        }

        /* CKJ text wrapping helper */
        .appshell-body,
        .appshell-main,
        .appshell-inspector {
          word-break: break-word;
          overflow-wrap: break-word;
        }
      `}</style>
    </div>
  );
};

export default AppShell;
