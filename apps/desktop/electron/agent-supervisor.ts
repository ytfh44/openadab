/**
 * Agent process/session supervisor for the Electron main process.
 *
 * Spawns agent processes via `child_process.spawn()` using ACP (Agent Communication
 * Protocol) — simple JSON-based messaging over stdin/stdout. Manages session
 * lifecycle, permission routing between agent and renderer, and graceful degradation
 * when no agent is configured or the agent process fails.
 *
 * Permission rules:
 * - Low-risk capabilities (`read_project_file`, `write_artifact_draft`) can be
 *   auto-approved after one explicit approval per session.
 * - Canon-mutating capabilities (`modify_wiki`, `modify_manuscript`,
 *   `apply_wiki_diff`, `sync_change`, `archive_change`) require explicit user
 *   approval each time.
 * - `run_cli` requires explicit approval each time.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createInterface, type Interface } from 'node:readline';
import type { WebContents } from 'electron';
import type {
  AgentStartSessionRequest,
  AgentSendMessageRequest,
  AgentMessageEvent,
  PermissionRequest,
  PermissionResponse,
  AgentCapability,
} from '../shared/ipc-types.js';
import { AgentLogger } from './agent-logger.js';

// ─── Permission Classification ─────────────────────────────

/** Capabilities that can be auto-approved after one per-session approval. */
const LOW_RISK_CAPABILITIES: ReadonlySet<AgentCapability> = new Set([
  'read_project_file',
  'write_artifact_draft',
]);

/** Capabilities that mutate canon and ALWAYS require explicit user approval. */
const CANON_MUTATION_CAPABILITIES: ReadonlySet<AgentCapability> = new Set([
  'modify_wiki',
  'modify_manuscript',
  'apply_wiki_diff',
  'sync_change',
  'archive_change',
]);

/** Capabilities that always require explicit user approval each time. */
const ALWAYS_REQUIRE_APPROVAL: ReadonlySet<AgentCapability> = new Set([
  'run_cli',
  ...CANON_MUTATION_CAPABILITIES,
]);

/**
 * Check whether a capability is a forbidden canon mutation.
 */
export function isCanonMutation(capability: AgentCapability): boolean {
  return CANON_MUTATION_CAPABILITIES.has(capability);
}

/**
 * Check whether a capability can be auto-approved after initial approval.
 */
export function isLowRisk(capability: AgentCapability): boolean {
  return LOW_RISK_CAPABILITIES.has(capability);
}

/**
 * Check whether a capability always requires explicit approval.
 */
export function alwaysRequiresApproval(capability: AgentCapability): boolean {
  return ALWAYS_REQUIRE_APPROVAL.has(capability);
}

// ─── Session Model ─────────────────────────────────────────

/** Possible states of an agent session. */
export type AgentSessionStatus = 'starting' | 'running' | 'stopped' | 'error';

/** A pending permission request waiting for user response. */
interface PendingPermission {
  request: PermissionRequest;
  resolve: (approved: boolean) => void;
}

/** A single agent session tracked by the supervisor. */
interface AgentSession {
  sessionId: string;
  status: AgentSessionStatus;
  child: ChildProcess | null;
  lineReader: Interface | null;
  config: AgentStartSessionRequest;
  startedAt: string;
  errorMessage?: string;
  /** Capabilities that have been explicitly approved this session. */
  approvedCapabilities: Set<AgentCapability>;
  /** Pending permission requests awaiting user response. */
  pendingPermissions: Map<string, PendingPermission>;
}

// ─── Agent Config Persistence ──────────────────────────────

/** Agent configuration persisted to disk. */
export interface AgentConfig {
  agentCommand: string;
  args: string[];
  cwd: string;
  apiKey?: string;
  mode: 'opencode-default' | 'custom-command' | 'none';
}

const DEFAULT_CONFIG: AgentConfig = {
  agentCommand: 'opencode',
  args: ['agent', '--acp'],
  cwd: '',
  mode: 'opencode-default',
};

// ─── Supervisor ────────────────────────────────────────────

/**
 * Manages agent child processes, sessions, and permission routing.
 *
 * Only one session can be active at a time. The supervisor communicates
 * with the renderer via `WebContents.send()` for events and coordinates
 * permission requests through a resolve/reject promise pattern.
 */
export class AgentSupervisor {
  /** Currently active session, if any. */
  private session: AgentSession | null = null;

  /** Agent configuration. */
  private config: AgentConfig = { ...DEFAULT_CONFIG };

  /** Logger for agent events. */
  private logger: AgentLogger | null = null;

  /** Reference to the main window's WebContents for sending events. */
  private sender: WebContents | null = null;

  // ── Public API ──────────────────────────────────────────

  /** Set the agent configuration. */
  setConfig(config: AgentConfig): void {
    this.config = config;
  }

  /** Get the current agent configuration. */
  getConfig(): AgentConfig {
    return { ...this.config };
  }

  /** Set the logger instance (called when project is opened). */
  setLogger(logger: AgentLogger | null): void {
    this.logger = logger;
  }

  /** Set the sender for IPC events. */
  setSender(sender: WebContents): void {
    this.sender = sender;
  }

  /** Whether the agent is configured (mode is not 'none' and command is set). */
  isConfigured(): boolean {
    return (
      this.config.mode !== 'none' &&
      this.config.agentCommand.trim().length > 0
    );
  }

  /** Get current session status for the UI. */
  getSessionStatus(): {
    sessionId: string | null;
    status: AgentSessionStatus | 'none';
    startedAt: string | null;
    errorMessage?: string;
  } {
    if (!this.session) {
      return { sessionId: null, status: 'none', startedAt: null };
    }
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      startedAt: this.session.startedAt,
      errorMessage: this.session.errorMessage,
    };
  }

  /**
   * Start a new agent session.
   *
   * Spawns the configured agent command as a child process, sets up
   * stdin/stdout JSON line protocol, and begins reading agent messages.
   */
  async startSession(
    request: AgentStartSessionRequest,
  ): Promise<{ sessionId: string }> {
    if (this.session && this.session.status !== 'stopped' && this.session.status !== 'error') {
      throw new Error('An agent session is already active. Stop it first.');
    }

    const sessionId = randomUUID();
    const effectiveConfig = {
      ...request,
      agentCommand: request.agentCommand || this.config.agentCommand,
      args: request.args.length > 0 ? request.args : this.config.args,
      cwd: request.cwd || this.config.cwd,
    };

    const session: AgentSession = {
      sessionId,
      status: 'starting',
      child: null,
      lineReader: null,
      config: effectiveConfig,
      startedAt: new Date().toISOString(),
      approvedCapabilities: new Set(),
      pendingPermissions: new Map(),
    };

    this.session = session;
    await this.logger?.logSessionEvent('session_start', sessionId, `Starting agent: ${effectiveConfig.agentCommand} ${effectiveConfig.args.join(' ')}`);

    try {
      const child = spawn(effectiveConfig.agentCommand, effectiveConfig.args, {
        cwd: effectiveConfig.cwd || process.cwd(),
        env: { ...process.env },
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      });

      session.child = child;
      session.status = 'running';

      // Set up line reader for stdout (ACP messages)
      const lineReader = createInterface({ input: child.stdout!, crlfDelay: Infinity });
      session.lineReader = lineReader;

      lineReader.on('line', (line: string) => {
        this.handleAgentLine(sessionId, line);
      });

      // Handle stderr as system messages
      if (child.stderr) {
        const stderrReader = createInterface({ input: child.stderr, crlfDelay: Infinity });
        stderrReader.on('line', (line: string) => {
          this.emitAgentMessage(sessionId, 'system', line);
        });
      }

      child.on('close', (code, signal) => {
        const reason = signal
          ? `Process terminated by signal ${signal}`
          : `Process exited with code ${code}`;
        this.emitAgentMessage(sessionId, 'system', reason);
        if (session.status === 'running') {
          session.status = 'stopped';
          session.child = null;
          session.lineReader = null;
        }
        this.logger?.logSessionEvent('session_stop', sessionId, reason).catch(() => {});
      });

      child.on('error', (err) => {
        session.status = 'error';
        session.errorMessage = err.message;
        session.child = null;
        session.lineReader = null;
        this.emitAgentMessage(sessionId, 'system', `Agent error: ${err.message}`);
        this.logger?.logSessionEvent('session_error', sessionId, err.message).catch(() => {});
      });

      this.emitAgentMessage(sessionId, 'system', `Agent session started: ${effectiveConfig.agentCommand}`);

      return { sessionId };
    } catch (err) {
      session.status = 'error';
      session.errorMessage = err instanceof Error ? err.message : String(err);
      this.emitAgentMessage(sessionId, 'system', `Failed to start agent: ${session.errorMessage}`);
      await this.logger?.logSessionEvent('session_error', sessionId, session.errorMessage);
      this.session = null;
      throw err;
    }
  }

  /**
   * Send a message to the active agent session.
   */
  async sendMessage(request: AgentSendMessageRequest): Promise<void> {
    const session = this.session;
    if (!session || session.sessionId !== request.sessionId) {
      throw new Error(`No active session with ID ${request.sessionId}`);
    }
    if (!session.child || session.status !== 'running') {
      throw new Error('Agent session is not running');
    }

    const acpMessage = JSON.stringify({ type: 'message', content: request.message }) + '\n';
    session.child.stdin!.write(acpMessage);
  }

  /**
   * Stop the active agent session.
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.session;
    if (!session || session.sessionId !== sessionId) {
      return;
    }

    if (session.child) {
      try {
        // Send graceful shutdown message
        session.child.stdin!.write(JSON.stringify({ type: 'shutdown' }) + '\n');
        // Give the process a moment, then kill
        setTimeout(() => {
          try {
            session.child?.kill('SIGTERM');
          } catch {
            // Process already gone
          }
        }, 2000);
      } catch {
        try {
          session.child.kill('SIGTERM');
        } catch {
          // Process already gone
        }
      }
    }

    session.status = 'stopped';
    session.child = null;
    if (session.lineReader) {
      session.lineReader.close();
      session.lineReader = null;
    }

    // Reject all pending permissions
    for (const [id, pending] of session.pendingPermissions) {
      pending.resolve(false);
      session.pendingPermissions.delete(id);
    }

    await this.logger?.logSessionEvent('session_stop', sessionId, 'User stopped session');
  }

  /**
   * Approve a pending permission request.
   */
  async approvePermission(response: PermissionResponse): Promise<void> {
    const session = this.session;
    if (!session) return;

    const pending = session.pendingPermissions.get(response.requestId);
    if (pending) {
      // Track the approved capability for auto-approval
      session.approvedCapabilities.add(pending.request.capability);
      pending.resolve(true);
      session.pendingPermissions.delete(response.requestId);
      await this.logger?.logPermissionResponse(response, session.sessionId);
    }
  }

  /**
   * Deny a pending permission request.
   */
  async denyPermission(response: PermissionResponse): Promise<void> {
    const session = this.session;
    if (!session) return;

    const pending = session.pendingPermissions.get(response.requestId);
    if (pending) {
      pending.resolve(false);
      session.pendingPermissions.delete(response.requestId);
      await this.logger?.logPermissionResponse(response, session.sessionId);
    }
  }

  // ── Private: ACP Message Handling ───────────────────────

  /** Parse and route an incoming line from the agent process. */
  private handleAgentLine(sessionId: string, line: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line.trim()) as Record<string, unknown>;
    } catch {
      // Non-JSON line — emit as raw system message
      this.emitAgentMessage(sessionId, 'system', line);
      return;
    }

    const msgType = parsed.type as string | undefined;

    switch (msgType) {
      case 'message':
        this.emitAgentMessage(sessionId, 'agent', (parsed.content as string) ?? line);
        break;
      case 'tool_call':
        this.handleToolCall(sessionId, parsed);
        break;
      case 'permission_request':
        this.handlePermissionRequest(sessionId, parsed);
        break;
      case 'status':
        // Agent status update — forward as system message
        this.emitAgentMessage(sessionId, 'system', `Status: ${JSON.stringify(parsed.status)}`);
        break;
      default:
        this.emitAgentMessage(sessionId, 'system', line);
    }
  }

  /** Handle a tool_call message from the agent. */
  private async handleToolCall(
    sessionId: string,
    parsed: Record<string, unknown>,
  ): Promise<void> {
    const toolName = (parsed.tool as string) ?? 'unknown';
    const args = parsed.args;
    const success = (parsed.success as boolean) ?? true;
    const error = parsed.error as string | undefined;
    await this.logger?.logToolCall(toolName, args, sessionId, success, error);
    this.emitAgentMessage(sessionId, 'system', `Tool call: ${toolName} ${success ? '✓' : '✗'}`);
  }

  /** Handle a permission_request message from the agent. */
  private handlePermissionRequest(
    sessionId: string,
    parsed: Record<string, unknown>,
  ): void {
    const session = this.session;
    if (!session || session.sessionId !== sessionId) return;

    const capability = (parsed.capability as AgentCapability) ?? 'read_project_file';
    const scope = (Array.isArray(parsed.scope) ? parsed.scope : []) as string[];

    const requestId = randomUUID();
    const request: PermissionRequest = {
      id: requestId,
      requestedBy: 'agent',
      capability,
      scope,
      commandPreview: parsed.commandPreview as string | undefined,
      diffPreview: parsed.diffPreview as unknown,
    };

    // Check auto-approval rules
    if (this.canAutoApprove(capability, session)) {
      this.emitAgentMessage(
        sessionId,
        'system',
        `Auto-approved: ${capability}`,
      );
      // Send approval back to agent process
      this.sendApprovalToAgent(requestId, true);
      this.logger?.logPermissionResponse(
        { requestId, approved: true },
        sessionId,
      ).catch(() => {});
      return;
    }

    // Store pending and emit event to renderer
    const promise = new Promise<boolean>((resolve) => {
      session.pendingPermissions.set(requestId, { request, resolve });
    });

    this.logger?.logPermissionRequest(request, sessionId).catch(() => {});

    // Emit to renderer for user decision
    this.sender?.send('event:permission-request', request);

    // Wait for user response asynchronously
    promise.then((approved) => {
      this.sendApprovalToAgent(requestId, approved);
    }).catch(() => {
      this.sendApprovalToAgent(requestId, false);
    });
  }

  /**
   * Determine whether a capability can be auto-approved for this session.
   */
  private canAutoApprove(
    capability: AgentCapability,
    session: AgentSession,
  ): boolean {
    if (alwaysRequiresApproval(capability)) return false;
    if (isLowRisk(capability) && session.approvedCapabilities.has(capability)) {
      return true;
    }
    return false;
  }

  /**
   * Send approval/denial back to the agent process over stdin.
   */
  private sendApprovalToAgent(requestId: string, approved: boolean): void {
    const session = this.session;
    if (!session?.child || session.status !== 'running') return;

    const msg = JSON.stringify({
      type: 'permission_response',
      requestId,
      approved,
    }) + '\n';

    try {
      session.child.stdin!.write(msg);
    } catch {
      // Agent process may have exited
    }
  }

  // ── Private: Event Emission ─────────────────────────────

  /** Emit an agent message event to the renderer. */
  private emitAgentMessage(
    sessionId: string,
    role: 'agent' | 'system',
    content: string,
  ): void {
    const event: AgentMessageEvent = {
      sessionId,
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    this.logger?.log({
      timestamp: Date.now(),
      iso: event.timestamp,
      event: 'message',
      description: `[${role}] ${content.slice(0, 200)}`,
      sessionId,
      payload: event,
    }).catch(() => {});
    this.sender?.send('event:agent-message', event);
  }
}
