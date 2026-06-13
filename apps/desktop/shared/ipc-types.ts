/**
 * Typed IPC bridge surface for the OpenAdab desktop app.
 *
 * Defines all channels, request/response shapes, and event payloads
 * that flow between the Electron main process and the renderer via
 * `contextBridge.exposeInMainWorld`.
 *
 * The main process is the gatekeeper: it runs `openadab` CLI as a
 * child process, enforces path boundaries, and persists transcripts.
 * The renderer communicates exclusively through these typed channels.
 */

import { z } from 'zod';

// ─── Channel Name Constants ───────────────────────────────

export const IpcChannel = {
  // ── Project ──
  PROJECT_OPEN: 'project:open',
  PROJECT_GET_INFO: 'project:get-info',
  PROJECT_LIST_RECENT: 'project:list-recent',

  // ── CLI ──
  CLI_RUN: 'cli:run',
  CLI_CANCEL: 'cli:cancel',
  CLI_GET_HISTORY: 'cli:get-history',

  // ── File ──
  FILE_READ: 'file:read',
  FILE_WRITE: 'file:write',
  FILE_LIST_DIR: 'file:list-dir',
  FILE_WATCH: 'file:watch',
  FILE_UNWATCH: 'file:unwatch',

  // ── Transcript ──
  TRANSCRIPT_GET_EVENTS: 'transcript:get-events',
  TRANSCRIPT_CLEAR: 'transcript:clear',

  // ── Agent ──
  AGENT_START_SESSION: 'agent:start-session',
  AGENT_SEND_MESSAGE: 'agent:send-message',
  AGENT_STOP_SESSION: 'agent:stop-session',
  AGENT_APPROVE_PERMISSION: 'agent:approve-permission',
  AGENT_DENY_PERMISSION: 'agent:deny-permission',

  // ── Events (main → renderer) ──
  EVENT_COMMAND_OUTPUT: 'event:command-output',
  EVENT_COMMAND_COMPLETE: 'event:command-complete',
  EVENT_FILE_CHANGED: 'event:file-changed',
  EVENT_AGENT_MESSAGE: 'event:agent-message',
  EVENT_PERMISSION_REQUEST: 'event:permission-request',
} as const;

export type IpcChannel = (typeof IpcChannel)[keyof typeof IpcChannel];

// ─── Project Schemas ──────────────────────────────────────

export const ProjectOpenRequestSchema = z.object({
  projectRoot: z.string().min(1, 'Project root path must not be empty'),
});

export type ProjectOpenRequest = z.infer<typeof ProjectOpenRequestSchema>;

export const ProjectInfoSchema = z.object({
  projectRoot: z.string(),
  title: z.string().optional(),
  language: z.string().optional(),
  activeSchema: z.string().optional(),
  host: z.string().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

export type ProjectInfo = z.infer<typeof ProjectInfoSchema>;

export const RecentProjectSchema = z.object({
  projectRoot: z.string(),
  title: z.string().optional(),
  lastOpenedAt: z.string(),
});

export type RecentProject = z.infer<typeof RecentProjectSchema>;

// ─── CLI Schemas ──────────────────────────────────────────

export const CliRunRequestSchema = z.object({
  commandId: z.string(),
  args: z.array(z.string()),
  cwd: z.string(),
  initiator: z.enum(['user', 'agent', 'auto-refresh']),
});

export type CliRunRequest = z.infer<typeof CliRunRequestSchema>;

export const CliCancelRequestSchema = z.object({
  commandId: z.string(),
});

export type CliCancelRequest = z.infer<typeof CliCancelRequestSchema>;

export const CommandEventSchema = z.object({
  id: z.string(),
  command: z.literal('openadab'),
  args: z.array(z.string()),
  cwd: z.string(),
  startedAt: z.string(),
  endedAt: z.string().optional(),
  exitCode: z.number().optional(),
  stdout: z.string(),
  stderr: z.string(),
  parsedJson: z.unknown().optional(),
  parseError: z.string().optional(),
  initiator: z.enum(['user', 'agent', 'auto-refresh']),
  cancelled: z.boolean().default(false),
});

export type CommandEvent = z.infer<typeof CommandEventSchema>;

// ─── File Schemas ─────────────────────────────────────────

export const FileReadRequestSchema = z.object({
  filePath: z.string().min(1),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
});

export type FileReadRequest = z.infer<typeof FileReadRequestSchema>;

export const FileReadResponseSchema = z.object({
  filePath: z.string(),
  content: z.string(),
  mtimeMs: z.number(),
});

export type FileReadResponse = z.infer<typeof FileReadResponseSchema>;

export const FileWriteRequestSchema = z.object({
  filePath: z.string().min(1),
  content: z.string(),
  encoding: z.enum(['utf-8', 'base64']).default('utf-8'),
  expectedMtimeMs: z.number().optional(),
});

export type FileWriteRequest = z.infer<typeof FileWriteRequestSchema>;

export const FileWriteResponseSchema = z.object({
  filePath: z.string(),
  mtimeMs: z.number(),
  conflict: z.boolean().optional(),
});

export type FileWriteResponse = z.infer<typeof FileWriteResponseSchema>;

export const FileListDirRequestSchema = z.object({
  dirPath: z.string().min(1),
});

export type FileListDirRequest = z.infer<typeof FileListDirRequestSchema>;

export const FileListDirResponseSchema = z.object({
  dirPath: z.string(),
  entries: z.array(z.object({
    name: z.string(),
    isDirectory: z.boolean(),
    mtimeMs: z.number(),
  })),
});

export type FileListDirResponse = z.infer<typeof FileListDirResponseSchema>;

export const FileWatchRequestSchema = z.object({
  filePath: z.string().min(1),
});

export type FileWatchRequest = z.infer<typeof FileWatchRequestSchema>;

// ─── Transcript Schemas ───────────────────────────────────

export const TranscriptGetEventsRequestSchema = z.object({
  limit: z.number().int().positive().optional(),
  initiator: z.enum(['user', 'agent', 'auto-refresh']).optional(),
  changeId: z.string().optional(),
});

export type TranscriptGetEventsRequest = z.infer<
  typeof TranscriptGetEventsRequestSchema
>;

// ─── Agent Schemas ────────────────────────────────────────

export const AgentCapabilitySchema = z.enum([
  'read_project_file',
  'write_artifact_draft',
  'run_cli',
  'modify_wiki',
  'modify_manuscript',
  'apply_wiki_diff',
  'sync_change',
  'archive_change',
]);

export type AgentCapability = z.infer<typeof AgentCapabilitySchema>;

export const PermissionRequestSchema = z.object({
  id: z.string(),
  requestedBy: z.enum(['agent', 'renderer']),
  capability: AgentCapabilitySchema,
  scope: z.array(z.string()),
  commandPreview: z.string().optional(),
  diffPreview: z.unknown().optional(),
});

export type PermissionRequest = z.infer<typeof PermissionRequestSchema>;

export const PermissionResponseSchema = z.object({
  requestId: z.string(),
  approved: z.boolean(),
  reason: z.string().optional(),
});

export type PermissionResponse = z.infer<typeof PermissionResponseSchema>;

export const AgentStartSessionRequestSchema = z.object({
  agentCommand: z.string(),
  args: z.array(z.string()).default([]),
  cwd: z.string(),
});

export type AgentStartSessionRequest = z.infer<
  typeof AgentStartSessionRequestSchema
>;

export const AgentSendMessageRequestSchema = z.object({
  sessionId: z.string(),
  message: z.string(),
});

export type AgentSendMessageRequest = z.infer<
  typeof AgentSendMessageRequestSchema
>;

// ─── Event Payloads (main → renderer) ─────────────────────

export const CommandOutputEventSchema = z.object({
  commandId: z.string(),
  stream: z.enum(['stdout', 'stderr']),
  chunk: z.string(),
});

export type CommandOutputEvent = z.infer<typeof CommandOutputEventSchema>;

export const FileChangedEventSchema = z.object({
  filePath: z.string(),
  mtimeMs: z.number(),
});

export type FileChangedEvent = z.infer<typeof FileChangedEventSchema>;

export const AgentMessageEventSchema = z.object({
  sessionId: z.string(),
  role: z.enum(['agent', 'system']),
  content: z.string(),
  timestamp: z.string(),
});

export type AgentMessageEvent = z.infer<typeof AgentMessageEventSchema>;

// ─── Preload API Surface ──────────────────────────────────

/**
 * The typed API surface exposed to the renderer via
 * `contextBridge.exposeInMainWorld('openadab', api)`.
 *
 * Each method is an `ipcRenderer.invoke` or `ipcRenderer.on`
 * call serialized through the typed bridge.
 */
export interface OpenAdabPreloadApi {
  // ── Project ──
  openProject(request: ProjectOpenRequest): Promise<ProjectInfo | null>;
  getProjectInfo(): Promise<ProjectInfo | null>;
  listRecentProjects(): Promise<RecentProject[]>;

  // ── CLI ──
  runCli(request: CliRunRequest): Promise<CommandEvent>;
  cancelCli(request: CliCancelRequest): Promise<void>;
  getCliHistory(
    request?: TranscriptGetEventsRequest,
  ): Promise<CommandEvent[]>;

  // ── File ──
  readFile(request: FileReadRequest): Promise<FileReadResponse>;
  writeFile(request: FileWriteRequest): Promise<FileWriteResponse>;
  listDir(request: FileListDirRequest): Promise<FileListDirResponse>;
  watchFile(request: FileWatchRequest): Promise<void>;
  unwatchFile(request: FileWatchRequest): Promise<void>;

  // ── Transcript ──
  getTranscriptEvents(
    request?: TranscriptGetEventsRequest,
  ): Promise<CommandEvent[]>;
  clearTranscript(): Promise<void>;

  // ── Agent ──
  startAgentSession(
    request: AgentStartSessionRequest,
  ): Promise<{ sessionId: string }>;
  sendAgentMessage(request: AgentSendMessageRequest): Promise<void>;
  stopAgentSession(request: { sessionId: string }): Promise<void>;
  approvePermission(request: PermissionResponse): Promise<void>;
  denyPermission(request: PermissionResponse): Promise<void>;

  // ── Event listeners ──
  onCommandOutput(
    callback: (event: CommandOutputEvent) => void,
  ): () => void;
  onCommandComplete(
    callback: (event: CommandEvent) => void,
  ): () => void;
  onFileChanged(
    callback: (event: FileChangedEvent) => void,
  ): () => void;
  onAgentMessage(
    callback: (event: AgentMessageEvent) => void,
  ): () => void;
  onPermissionRequest(
    callback: (event: PermissionRequest) => void,
  ): () => void;
}

// ─── Desktop Selection (Renderer State) ───────────────────

export const DesktopSelectionSchema = z.object({
  projectRoot: z.string().nullable(),
  route: z.enum([
    'project',
    'manuscript',
    'changes',
    'timeline',
    'wiki',
    'schemas',
    'agent',
  ]),
  changeId: z.string().optional(),
  artifactId: z.string().optional(),
  wikiPage: z.string().optional(),
  chapterPath: z.string().optional(),
});

export type DesktopSelection = z.infer<typeof DesktopSelectionSchema>;
