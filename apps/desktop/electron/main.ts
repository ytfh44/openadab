/**
 * Electron main process entry point.
 *
 * Creates the BrowserWindow with secure defaults (context isolation on,
 * node integration off), loads the renderer (Vite dev server in dev mode,
 * built files in production), and sets up the IPC handler backbone.
 */

import { app, BrowserWindow, ipcMain } from 'electron';
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, statSync, readdirSync, watch, type FSWatcher } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { CommandRunner } from './command-runner.js';
import { TranscriptStore } from './transcript-store.js';
import { AgentSupervisor } from './agent-supervisor.js';
import { AgentLogger } from './agent-logger.js';
import {
  CliRunRequestSchema,
  CliCancelRequestSchema,
  TranscriptGetEventsRequestSchema,
  ProjectOpenRequestSchema,
  FileReadRequestSchema,
  FileWriteRequestSchema,
  FileListDirRequestSchema,
  FileWatchRequestSchema,
  AgentStartSessionRequestSchema,
  AgentSendMessageRequestSchema,
  PermissionResponseSchema,
} from '../shared/ipc-types.js';
import type {
  ProjectInfo,
  ProjectOpenResult,
  FileReadResponse,
  FileWriteResponse,
  FileListDirResponse,
} from '../shared/ipc-types.js';
import { guardProjectFilePath } from './path-guards.js';
import {
  detectProject,
  validateProjectRoot,
  showOpenProjectDialog,
  loadRecentProjects,
  addRecentProject,
  recentProjectsPath,
} from './project-store.js';


/** Whether the app is running from source (unpackaged). */
const isDev = !app.isPackaged;

let mainWindow: BrowserWindow | null = null;

/** Current project info (populated by project:open). */
let currentProject: ProjectInfo | null = null;

/** Persistent transcript store for the current project. */
let transcriptStore: TranscriptStore | null = null;

/** Singleton command runner for spawning openadab processes. */
const commandRunner = new CommandRunner();

/** Singleton agent supervisor for managing agent processes and sessions. */
const agentSupervisor = new AgentSupervisor();

/** Agent event logger for the current project. */
let agentLogger: AgentLogger | null = null;

/** Active file watchers keyed by absolute file path. */
const fileWatchers = new Map<string, FSWatcher>();

/**
 * Create the main application window with secure web preferences.
 *
 * Security defaults:
 * - `contextIsolation: true` �?preload scripts run in isolated world
 * - `nodeIntegration: false` �?renderer has no Node.js access
 * - `sandbox: true` �?renderer runs in OS sandbox (platform-dependent)
 * - `webSecurity: true` �?same-origin policy enforced
 */
function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'OpenAdab',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      preload: join(__dirname, 'preload.cjs'),
    },
  });

  win.once('ready-to-show', () => {
    win.show();
  });

  win.on('closed', () => {
    mainWindow = null;
  });

  return win;
}

/**
 * Load the renderer content into the main window.
 *
 * In dev mode, loads from the Vite HMR dev server at localhost:5173.
 * In production, loads the built `index.html` from the renderer dist folder.
 */
async function loadRenderer(win: BrowserWindow): Promise<void> {
  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(
      join(__dirname, '..', '..', 'renderer', 'dist', 'index.html'),
    );
  }
}

// ─── IPC Handler Registration ─────────────────────────────

/**
 * Register IPC handlers for all channels.
 *
 * CLI and transcript handlers use the real CommandRunner and TranscriptStore.
 * Project and file handlers use project-store and path-guards (Section 2).
 * Agent handlers remain stubs until Section 11 is implemented.
 */
function registerIpcHandlers(): void {
  // ── Project handlers ──────────────────────────────
  ipcMain.handle('project:open', async (_event, request) => {
    const parseResult = ProjectOpenRequestSchema.safeParse(request);
    const projectRoot: string =
      parseResult.success ? parseResult.data.projectRoot : '';

    let root: string | null = projectRoot || null;

    if (!root) {
      root = await showOpenProjectDialog(mainWindow);
      if (!root) {
        const result: ProjectOpenResult = { success: false, reason: 'cancelled' };
        return result;
      }
    }

    const resolvedRoot = root;
    const validated = validateProjectRoot(resolvedRoot);

    if (!validated.valid) {
      currentProject = null;
      transcriptStore = null;
      agentLogger = null;
      agentSupervisor.setLogger(null);
      commandRunner.onCommandComplete = undefined;
      const result: ProjectOpenResult = { success: false, reason: validated.reason };
      return result;
    }

    const info = detectProject(validated.projectRoot);

    if (!info) {
      currentProject = null;
      transcriptStore = null;
      agentLogger = null;
      agentSupervisor.setLogger(null);
      commandRunner.onCommandComplete = undefined;
      const result: ProjectOpenResult = { success: false, reason: 'not_a_project' };
      return result;
    }

    currentProject = info;
    addRecentProject(await recentProjectsPath(), validated.projectRoot, info.title);

    transcriptStore = new TranscriptStore(validated.projectRoot);
    await transcriptStore.load();
    commandRunner.onCommandComplete = async (event) => {
      await transcriptStore?.append(event);
    };

    agentLogger = new AgentLogger(validated.projectRoot);
    await agentLogger.load();
    agentSupervisor.setLogger(agentLogger);

    const result: ProjectOpenResult = { success: true, project: currentProject };
    return result;
  });

  ipcMain.handle('project:get-info', async () => {
    if (!currentProject) return null;
    const refreshed = detectProject(currentProject.projectRoot);
    currentProject = refreshed ?? currentProject;
    return currentProject;
  });

  ipcMain.handle('project:list-recent', async () => {
    return loadRecentProjects(await recentProjectsPath());
  });

  // ── CLI handlers (real implementations �?Section 3) ──────
  ipcMain.handle('cli:run', async (event, request) => {
    const parseResult = CliRunRequestSchema.safeParse(request);
    if (!parseResult.success) {
      const errorEvent = {
        id: request.commandId as string ?? randomUUID(),
        command: 'openadab' as const,
        args: (request as { args?: string[] }).args ?? [],
        cwd: (request as { cwd?: string }).cwd ?? '',
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: Number.NaN,
        stdout: '',
        stderr: `Invalid request: ${parseResult.error.message}`,
        initiator: 'user' as const,
        cancelled: false,
      };
      return errorEvent;
    }
    return commandRunner.run(parseResult.data, event.sender);
  });

  ipcMain.handle('cli:cancel', async (_event, request) => {
    const parseResult = CliCancelRequestSchema.safeParse(request);
    if (!parseResult.success) return;
    commandRunner.cancel(parseResult.data);
  });

  ipcMain.handle('cli:get-history', async (_event, request) => {
    if (!transcriptStore) return [];
    const parseResult = TranscriptGetEventsRequestSchema.safeParse(request ?? {});
    return transcriptStore.getEvents(
      parseResult.success ? parseResult.data : undefined,
    );
  });

  // ── File handlers ────────────────────────────────
  ipcMain.handle('file:read', async (_event, request) => {
    if (!currentProject) {
      throw new Error('No project is open.');
    }

    const parseResult = FileReadRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid file:read request: ${parseResult.error.message}`);
    }
    const { filePath, encoding } = parseResult.data;

    const safePath = guardProjectFilePath(
      filePath,
      currentProject.projectRoot,
      'read',
    );
    const stat = statSync(safePath);
    const content = readFileSync(safePath, encoding);

    const response: FileReadResponse = {
      filePath: safePath,
      content,
      mtimeMs: stat.mtimeMs,
    };
    return response;
  });

  ipcMain.handle('file:write', async (_event, request) => {
    if (!currentProject) {
      throw new Error('No project is open.');
    }

    const parseResult = FileWriteRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid file:write request: ${parseResult.error.message}`);
    }
    const { filePath, content, encoding, expectedMtimeMs } = parseResult.data;

    const safePath = guardProjectFilePath(
      filePath,
      currentProject.projectRoot,
      'write',
    );

    if (expectedMtimeMs !== undefined) {
      try {
        const stat = statSync(safePath);
        if (stat.mtimeMs !== expectedMtimeMs) {
          const response: FileWriteResponse = {
            filePath: safePath,
            mtimeMs: stat.mtimeMs,
            conflict: true,
          };
          return response;
        }
      } catch {
        // File does not exist yet �?no conflict possible.
      }
    }

    mkdirSync(dirname(safePath), { recursive: true });
    writeFileSync(safePath, content, encoding);
    const newStat = statSync(safePath);

    const response: FileWriteResponse = {
      filePath: safePath,
      mtimeMs: newStat.mtimeMs,
    };
    return response;
  });

  ipcMain.handle('file:list-dir', async (_event, request) => {
    if (!currentProject) {
      throw new Error('No project is open.');
    }

    const parseResult = FileListDirRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid file:list-dir request: ${parseResult.error.message}`);
    }
    const { dirPath } = parseResult.data;

    const safePath = guardProjectFilePath(
      dirPath,
      currentProject.projectRoot,
      'list',
    );
    const entries = readdirSync(safePath, { withFileTypes: true, encoding: 'utf-8' });

    const response: FileListDirResponse = {
      dirPath: safePath,
      entries: entries.map((entry) => {
        const fullPath = `${safePath}/${entry.name}`;
        let mtimeMs = 0;
        try {
          mtimeMs = statSync(fullPath).mtimeMs;
        } catch {
          mtimeMs = Date.now();
        }
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          mtimeMs,
        };
      }),
    };
    return response;
  });

  ipcMain.handle('file:watch', async (_event, request) => {
    if (!currentProject) {
      throw new Error('No project is open.');
    }

    const parseResult = FileWatchRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid file:watch request: ${parseResult.error.message}`);
    }
    const { filePath } = parseResult.data;
    const safePath = guardProjectFilePath(
      filePath,
      currentProject.projectRoot,
      'watch',
    );

    if (fileWatchers.has(safePath)) return;

    const watcher = watch(safePath, (_eventType) => {
      try {
        const stat = statSync(safePath);
        mainWindow?.webContents.send('event:file-changed', {
          filePath: safePath,
          mtimeMs: stat.mtimeMs,
        });
      } catch {
        mainWindow?.webContents.send('event:file-changed', {
          filePath: safePath,
          mtimeMs: Date.now(),
        });
      }
    });

    fileWatchers.set(safePath, watcher);
  });

  ipcMain.handle('file:unwatch', async (_event, request) => {
    const parseResult = FileWatchRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(
        `Invalid file:unwatch request: ${parseResult.error.message}`,
      );
    }
    const { filePath } = parseResult.data;

    let key = filePath;
    if (currentProject) {
      try {
        key = guardProjectFilePath(
          filePath,
          currentProject.projectRoot,
          'watch',
        );
      } catch {
        key = filePath;
      }
    }

    const watcher = fileWatchers.get(key);
    if (watcher) {
      watcher.close();
      fileWatchers.delete(key);
    }
  });

  // ── Transcript handlers (real implementations �?Section 3)
  ipcMain.handle('transcript:get-events', async (_event, request) => {
    if (!transcriptStore) return [];
    const parseResult =
      TranscriptGetEventsRequestSchema.safeParse(request ?? {});
    return transcriptStore.getEvents(
      parseResult.success ? parseResult.data : undefined,
    );
  });

  ipcMain.handle('transcript:clear', async () => {
    if (transcriptStore) {
      await transcriptStore.clear();
    }
  });

  // ── Agent handlers (real �?Section 11) ────────────────
  ipcMain.handle('agent:start-session', async (_event, request) => {
    if (!agentSupervisor.isConfigured()) {
      throw new Error('No agent configured. Configure an agent in the Agent Dock to get started.');
    }
    const parseResult = AgentStartSessionRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid start-session request: ${parseResult.error.message}`);
    }
    return agentSupervisor.startSession(parseResult.data);
  });

  ipcMain.handle('agent:send-message', async (_event, request) => {
    const parseResult = AgentSendMessageRequestSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid send-message request: ${parseResult.error.message}`);
    }
    await agentSupervisor.sendMessage(parseResult.data);
  });

  ipcMain.handle('agent:stop-session', async (_event, request) => {
    const { sessionId } = request as { sessionId: string };
    await agentSupervisor.stopSession(sessionId);
  });

  ipcMain.handle('agent:approve-permission', async (_event, request) => {
    const parseResult = PermissionResponseSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid approve-permission request: ${parseResult.error.message}`);
    }
    await agentSupervisor.approvePermission(parseResult.data);
  });

  ipcMain.handle('agent:deny-permission', async (_event, request) => {
    const parseResult = PermissionResponseSchema.safeParse(request);
    if (!parseResult.success) {
      throw new Error(`Invalid deny-permission request: ${parseResult.error.message}`);
    }
    await agentSupervisor.denyPermission(parseResult.data);
  });
}

// ─── App Lifecycle ────────────────────────────────────────

app.whenReady().then(async () => {
  registerIpcHandlers();
  mainWindow = createMainWindow();
  agentSupervisor.setSender(mainWindow.webContents);
  await loadRenderer(mainWindow);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
      void loadRenderer(mainWindow);
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
