/**
 * Agent event persistence store for the Electron main process.
 *
 * Writes agent log entries as JSONL (one JSON object per line) to
 * `{projectRoot}/.adab-agent-log.jsonl`. Supports appending tool calls,
 * permission requests/responses, file diffs, and session lifecycle events.
 *
 * Pattern mirrors {@link TranscriptStore} for crash-safe incremental writing.
 */

import { appendFile, readFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import type { PermissionRequest, PermissionResponse } from '../shared/ipc-types.js';

const AGENT_LOG_FILENAME = '.adab-agent-log.jsonl';

/** Categories of agent log events. */
export type AgentLogEventType =
  | 'tool_call'
  | 'permission_request'
  | 'permission_response'
  | 'file_diff'
  | 'session_start'
  | 'session_stop'
  | 'session_error'
  | 'message';

/** A single JSONL entry in the agent log. */
export interface AgentLogEntry {
  /** Unix timestamp in milliseconds. */
  timestamp: number;
  /** ISO-8601 timestamp string. */
  iso: string;
  /** Event category. */
  event: AgentLogEventType;
  /** Human-readable description. */
  description: string;
  /** Session ID this event belongs to. */
  sessionId: string;
  /** Optional structured payload. */
  payload?: unknown;
}

/**
 * Manages persistent storage of agent event logs.
 *
 * One instance per open project. Events are appended as JSONL lines
 * for crash-safe incremental writing.
 */
export class AgentLogger {
  private filePath: string;
  private entries: AgentLogEntry[] = [];

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, AGENT_LOG_FILENAME);
  }

  /** Load existing log entries from disk into memory. */
  async load(): Promise<void> {
    try {
      await access(this.filePath);
    } catch {
      this.entries = [];
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.split('\n');
      const parsed: AgentLogEntry[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          const entry = JSON.parse(trimmed) as AgentLogEntry;
          if (entry.timestamp && entry.event && entry.sessionId) {
            parsed.push(entry);
          }
        } catch {
          // Skip malformed lines silently
        }
      }
      this.entries = parsed;
    } catch {
      this.entries = [];
    }
  }

  /** Append a single entry to the JSONL file and in-memory array. */
  async log(entry: AgentLogEntry): Promise<void> {
    const line = JSON.stringify(entry) + '\n';
    await appendFile(this.filePath, line, 'utf-8');
    this.entries.push(entry);
  }

  /**
   * Log a permission request.
   */
  async logPermissionRequest(
    request: PermissionRequest,
    sessionId: string,
  ): Promise<void> {
    const now = Date.now();
    await this.log({
      timestamp: now,
      iso: new Date(now).toISOString(),
      event: 'permission_request',
      description: `Permission requested: ${request.capability}`,
      sessionId,
      payload: request,
    });
  }

  /**
   * Log a permission response (approval or denial).
   */
  async logPermissionResponse(
    response: PermissionResponse,
    sessionId: string,
  ): Promise<void> {
    const now = Date.now();
    await this.log({
      timestamp: now,
      iso: new Date(now).toISOString(),
      event: 'permission_response',
      description: response.approved
        ? `Permission approved: ${response.requestId}`
        : `Permission denied: ${response.requestId}${response.reason ? ` (${response.reason})` : ''}`,
      sessionId,
      payload: response,
    });
  }

  /**
   * Log a tool call made by the agent.
   */
  async logToolCall(
    toolName: string,
    args: unknown,
    sessionId: string,
    success: boolean,
    error?: string,
  ): Promise<void> {
    const now = Date.now();
    await this.log({
      timestamp: now,
      iso: new Date(now).toISOString(),
      event: 'tool_call',
      description: `Tool call: ${toolName} ${success ? 'succeeded' : 'failed'}${error ? ` - ${error}` : ''}`,
      sessionId,
      payload: { toolName, args, success, error },
    });
  }

  /**
   * Log a file diff produced by the agent.
   */
  async logFileDiff(
    filePath: string,
    sessionId: string,
    diffPreview?: unknown,
  ): Promise<void> {
    const now = Date.now();
    await this.log({
      timestamp: now,
      iso: new Date(now).toISOString(),
      event: 'file_diff',
      description: `File diff: ${filePath}`,
      sessionId,
      payload: { filePath, diffPreview },
    });
  }

  /** Log a session lifecycle event. */
  async logSessionEvent(
    event: 'session_start' | 'session_stop' | 'session_error',
    sessionId: string,
    detail?: string,
  ): Promise<void> {
    const now = Date.now();
    await this.log({
      timestamp: now,
      iso: new Date(now).toISOString(),
      event,
      description: detail ?? `${event} for session ${sessionId}`,
      sessionId,
    });
  }

  /**
   * Query entries with optional filtering.
   *
   * @param sessionId - Filter by session
   * @param eventType - Filter by event type
   * @param limit - Max number of results (most recent)
   */
  getEntries(
    sessionId?: string,
    eventType?: AgentLogEventType,
    limit?: number,
  ): AgentLogEntry[] {
    let results = [...this.entries];

    if (sessionId) {
      results = results.filter((e) => e.sessionId === sessionId);
    }

    if (eventType) {
      results = results.filter((e) => e.event === eventType);
    }

    if (limit && limit > 0) {
      results = results.slice(-limit);
    }

    return results;
  }

  /** Delete the log file and clear in-memory entries. */
  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch {
      // File may not exist — that's fine
    }
    this.entries = [];
  }

  /** Number of entries currently loaded. */
  get count(): number {
    return this.entries.length;
  }

  /** The filesystem path of the log file. */
  get logPath(): string {
    return this.filePath;
  }
}
