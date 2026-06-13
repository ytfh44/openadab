/**
 * Electron preload script.
 *
 * Uses `contextBridge.exposeInMainWorld` to expose a narrow, typed
 * IPC API to the renderer. The renderer has NO direct access to Node.js
 * APIs (`nodeIntegration: false`). All project I/O and CLI execution
 * must go through these typed channels.
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
  OpenAdabPreloadApi,
  ProjectOpenRequest,
  ProjectOpenResult,
  ProjectInfo,
  RecentProject,
  CliRunRequest,
  CliCancelRequest,
  CommandEvent,
  FileReadRequest,
  FileReadResponse,
  FileWriteRequest,
  FileWriteResponse,
  FileListDirRequest,
  FileListDirResponse,
  FileWatchRequest,
  TranscriptGetEventsRequest,
  CliCheckResult,
  AgentStartSessionRequest,
  AgentSendMessageRequest,
  PermissionResponse,
  CommandOutputEvent,
  FileChangedEvent,
  AgentMessageEvent,
  PermissionRequest,
  AgentSpawnFailedEvent,
} from '../shared/ipc-types.js';

const api: OpenAdabPreloadApi = {
  // ── Project ──
  openProject(request: ProjectOpenRequest): Promise<ProjectOpenResult> {
    return ipcRenderer.invoke('project:open', request);
  },

  getProjectInfo(): Promise<ProjectInfo | null> {
    return ipcRenderer.invoke('project:get-info');
  },

  listRecentProjects(): Promise<RecentProject[]> {
    return ipcRenderer.invoke('project:list-recent');
  },

  selectProjectFolder(title?: string): Promise<string | null> {
    return ipcRenderer.invoke('project:select-folder', title);

  },

  // ── CLI ──
  runCli(request: CliRunRequest): Promise<CommandEvent> {
    return ipcRenderer.invoke('cli:run', request);
  },

  cancelCli(request: CliCancelRequest): Promise<void> {
    return ipcRenderer.invoke('cli:cancel', request);
  },

  getCliHistory(
    request?: TranscriptGetEventsRequest,
  ): Promise<CommandEvent[]> {
    return ipcRenderer.invoke('cli:get-history', request);
  },

  // ── CLI Check ──
  checkCli(): Promise<CliCheckResult> {
    return ipcRenderer.invoke('cli:check');
  },

  // ── File ──
  readFile(request: FileReadRequest): Promise<FileReadResponse> {
    return ipcRenderer.invoke('file:read', request);
  },

  writeFile(request: FileWriteRequest): Promise<FileWriteResponse> {
    return ipcRenderer.invoke('file:write', request);
  },

  listDir(request: FileListDirRequest): Promise<FileListDirResponse> {
    return ipcRenderer.invoke('file:list-dir', request);
  },

  watchFile(request: FileWatchRequest): Promise<void> {
    return ipcRenderer.invoke('file:watch', request);
  },

  unwatchFile(request: FileWatchRequest): Promise<void> {
    return ipcRenderer.invoke('file:unwatch', request);
  },

  // ── Transcript ──
  getTranscriptEvents(
    request?: TranscriptGetEventsRequest,
  ): Promise<CommandEvent[]> {
    return ipcRenderer.invoke('transcript:get-events', request);
  },

  clearTranscript(): Promise<void> {
    return ipcRenderer.invoke('transcript:clear');
  },

  // ── Agent ──
  startAgentSession(
    request: AgentStartSessionRequest,
  ): Promise<{ sessionId: string }> {
    return ipcRenderer.invoke('agent:start-session', request);
  },

  sendAgentMessage(request: AgentSendMessageRequest): Promise<void> {
    return ipcRenderer.invoke('agent:send-message', request);
  },

  stopAgentSession(request: { sessionId: string }): Promise<void> {
    return ipcRenderer.invoke('agent:stop-session', request);
  },

  approvePermission(request: PermissionResponse): Promise<void> {
    return ipcRenderer.invoke('agent:approve-permission', request);
  },

  denyPermission(request: PermissionResponse): Promise<void> {
    return ipcRenderer.invoke('agent:deny-permission', request);
  },

  // ── Event listeners (each returns an unsubscribe function) ──
  onCommandOutput(
    callback: (event: CommandOutputEvent) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: CommandOutputEvent,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:command-output', handler);
    return () => {
      ipcRenderer.removeListener('event:command-output', handler);
    };
  },

  onCommandComplete(
    callback: (event: CommandEvent) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: CommandEvent,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:command-complete', handler);
    return () => {
      ipcRenderer.removeListener('event:command-complete', handler);
    };
  },

  onFileChanged(
    callback: (event: FileChangedEvent) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: FileChangedEvent,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:file-changed', handler);
    return () => {
      ipcRenderer.removeListener('event:file-changed', handler);
    };
  },

  onAgentMessage(
    callback: (event: AgentMessageEvent) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: AgentMessageEvent,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:agent-message', handler);
    return () => {
      ipcRenderer.removeListener('event:agent-message', handler);
    };
  },

  onPermissionRequest(
    callback: (event: PermissionRequest) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: PermissionRequest,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:permission-request', handler);
    return () => {
      ipcRenderer.removeListener('event:permission-request', handler);
    };
  },


  onAgentSpawnFailed(
    callback: (event: AgentSpawnFailedEvent) => void,
  ): () => void {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: AgentSpawnFailedEvent,
    ): void => {
      callback(data);
    };
    ipcRenderer.on('event:agent-spawn-failed', handler);
    return () => {
      ipcRenderer.removeListener('event:agent-spawn-failed', handler);
    };
  },

};

contextBridge.exposeInMainWorld('openadab', api);
