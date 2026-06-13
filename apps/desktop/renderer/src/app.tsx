/**
 * OpenAdab desktop renderer entry point.
 *
 * Bootstraps the React application into the BrowserWindow.
 * Manages top-level application state: the current `DesktopSelection`
 * (route + project), `ProjectInfo`, and tab navigation.
 *
 * All visual layout is delegated to `AppShell` which provides the
 * consistent three-column-plus-bottom-panel structure.
 *
 * The renderer has access to `window.openadab` (the typed preload API)
 * for all project, CLI, file, transcript, and agent operations.
 */

import type React from 'react';
import { StrictMode, useState, useEffect, useCallback } from 'react';
import { createRoot } from 'react-dom/client';

import type {
  OpenAdabPreloadApi,
  DesktopSelection,
  ProjectInfo,
  CommandEvent,
} from '../../shared/ipc-types.js';
import type { ArtifactStatus } from './types/changes.js';
import AppShell from './components/AppShell.js';
import ProjectDashboard from './routes/ProjectDashboard.js';
import ChangesWorkbench from './routes/ChangesWorkbench.js';
import ArtifactEditor from './routes/ArtifactEditor.js';
import Inspector from './routes/Inspector.js';
import WikiDiffReview from './routes/WikiDiffReview.js';
import ManuscriptWorkspace from './routes/ManuscriptWorkspace.js';
import WikiWorkspace from './routes/WikiWorkspace.js';
import TimelineWorkspace from './routes/TimelineWorkspace.js';
import SchemaWorkbench from './routes/SchemaWorkbench.js';
import AgentDock from './routes/AgentDock.js';

/**
 * Global preload API surface exposed by the Electron preload script.
 * Available as `window.openadab` in the renderer.
 */
declare global {
  interface Window {
    openadab: OpenAdabPreloadApi;
  }
}

/**
 * Root application component.
 *
 * Owns the top-level `DesktopSelection` and `ProjectInfo` state.
 * Renders the AppShell wrapper and dispatches to route-specific views.
 * The AppShell provides consistent layout (left nav, main area, inspector,
 * bottom transcript) across all routes.
 */
const App: React.FC = () => {
  const [selection, setSelection] = useState<DesktopSelection>({
    projectRoot: null,
    route: 'project',
  });
  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);
  const [editorArtifact, setEditorArtifact] = useState<{
    changeId: string;
    artifactId: string;
    artifact: ArtifactStatus;
  } | null>(null);

  // Wiki diff review modal state
  const [wikiDiffReviewVisible, setWikiDiffReviewVisible] = useState(false);

  /** Fetch current project info from the main process. */
  const fetchProjectInfo = useCallback(async () => {
    setInfoLoading(true);
    try {
      const info = await window.openadab.getProjectInfo();
      setProjectInfo(info);
      setSelection((prev) => ({
        ...prev,
        projectRoot: info?.projectRoot ?? null,
      }));
    } catch {
      setProjectInfo(null);
    } finally {
      setInfoLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    fetchProjectInfo();
  }, [fetchProjectInfo]);

  // Refresh after any CLI command completes
  useEffect(() => {
    const unsub = window.openadab.onCommandComplete(
      (_event: CommandEvent) => {
        fetchProjectInfo();
      },
    );
    return unsub;
  }, [fetchProjectInfo]);

  // Listen for back-to-DAG navigation from ArtifactEditor
  useEffect(() => {
    const handler = () => {
      setEditorArtifact(null);
    };
    window.addEventListener('openadab:navigate-changes', handler);
    return () => {
      window.removeEventListener('openadab:navigate-changes', handler);
    };
  }, []);

  /** Switch to a different route tab. */
  const navigateTo = useCallback(
    (route: DesktopSelection['route']) => {
      setSelection((prev) => ({ ...prev, route }));
    },
    [],
  );

  /** Open an existing project via native system file picker. */
  const handleOpenExisting = useCallback(async () => {
    const path = await window.openadab.selectProjectFolder('Select OpenAdab Project');
    if (!path) return;
    try {
      await window.openadab.openProject({ projectRoot: path });
      await fetchProjectInfo();
    } catch (e) {
      window.alert(
        `Failed to open project: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, [fetchProjectInfo]);

  /** Called when a new project is initialized. */
  const handleProjectInit = useCallback(
    async (projectRoot: string) => {
      try {
        await window.openadab.openProject({ projectRoot });
        await fetchProjectInfo();
      } catch (e) {
        window.alert(
          `Project initialized but failed to open: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    },
    [fetchProjectInfo],
  );

  /** Called when an artifact is selected in ChangesWorkbench. */
  const handleSelectArtifact = useCallback(
    (changeId: string, artifactId: string, artifact: ArtifactStatus) => {
      if (changeId && artifactId && artifact.id) {
        setEditorArtifact({ changeId, artifactId, artifact });
      } else {
        setEditorArtifact(null);
      }
    },
    [],
  );

  /** Called after a successful save in ArtifactEditor. */
  const handleArtifactSaved = useCallback(() => {
    // Future: could trigger status refresh here
  }, []);

  // ── Determine if inspector should be shown ──
  const showInspector =
    selection.route === 'changes' && editorArtifact !== null;

  // ── Determine if agent dock route needs inspector ──
  const showAgentInspector =
    selection.route === 'agent' && projectInfo !== null;

  // ── Render main content based on route ──
  const mainContent = (() => {
    if (selection.route === 'project') {
      return (
        <ProjectDashboard
          projectInfo={projectInfo}
          loading={infoLoading}
          onRefresh={fetchProjectInfo}
          onProjectInit={handleProjectInit}
          onOpenExisting={handleOpenExisting}
        />
      );
    }

    if (selection.route === 'changes' && !editorArtifact) {
      return (
        <ChangesWorkbench
          projectInfo={projectInfo}
          loading={infoLoading}
          onSelectArtifact={handleSelectArtifact}
        />
      );
    }

    if (selection.route === 'changes' && editorArtifact) {
      return (
        <ArtifactEditor
          projectInfo={projectInfo}
          loading={infoLoading}
          changeId={editorArtifact.changeId}
          artifactId={editorArtifact.artifactId}
          artifactStatus={editorArtifact.artifact}
          onSaved={handleArtifactSaved}
        />
      );
    }

    if (selection.route === 'manuscript') {
      return (
        <ManuscriptWorkspace
          projectInfo={projectInfo}
          loading={infoLoading}
          initialChapterPath={selection.chapterPath}
        />
      );
    }

    if (selection.route === 'wiki') {
      return (
        <WikiWorkspace
          projectInfo={projectInfo}
          loading={infoLoading}
          initialWikiPage={selection.wikiPage}
        />
      );
    }

    if (selection.route === 'timeline') {
      return (
        <TimelineWorkspace
          projectInfo={projectInfo}
          loading={infoLoading}
          onNavigateToManuscript={(chapterPath) => {
            setSelection((prev) => ({
              ...prev,
              route: 'manuscript',
              chapterPath,
            }));
          }}
          onNavigateToWiki={(wikiPage) => {
            setSelection((prev) => ({
              ...prev,
              route: 'wiki',
              wikiPage,
            }));
          }}
        />
      );
    }

    if (selection.route === 'schemas') {
      return (
        <SchemaWorkbench
          projectInfo={projectInfo}
          loading={infoLoading}
        />
      );
    }

    if (selection.route === 'agent') {
      return <AgentDock projectInfo={projectInfo} />;
    }

    return null;
  })();

  // ── Render inspector content (conditional) ──
  const inspectorContent =
    showInspector && editorArtifact ? (
      <Inspector
        projectInfo={projectInfo}
        changeId={editorArtifact.changeId}
        artifactId={editorArtifact.artifactId}
        onReviewWikiDiff={() => setWikiDiffReviewVisible(true)}
      />
    ) : undefined;

  // ── Render ──

  return (
    <>
      <AppShell
        selection={selection}
        onNavigate={navigateTo}
        projectInfo={projectInfo}
        infoLoading={infoLoading}
        onOpenExisting={handleOpenExisting}
        onRefresh={fetchProjectInfo}
        showInspector={showInspector || showAgentInspector}
        inspector={inspectorContent}
      >
        {mainContent}
      </AppShell>

      {/* Wiki Diff Review modal */}
      {wikiDiffReviewVisible &&
        editorArtifact &&
        projectInfo?.projectRoot && (
          <WikiDiffReview
            projectRoot={projectInfo.projectRoot}
            changeId={editorArtifact.changeId}
            onClose={() => setWikiDiffReviewVisible(false)}
          />
        )}
    </>
  );
};

const container = document.getElementById('root');
if (container !== null) {
  const root = createRoot(container);
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
