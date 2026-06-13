/**
 * Agent process/session supervisor for the Electron main process.
 *
 * Spawns agent processes via `AcpClient` using the ACP (Agent Client Protocol)
 * JSON-RPC 2.0 over stdio. Manages session lifecycle, permission routing
 * between agent and renderer, and graceful degradation when no agent is
 * configured or the agent process fails.
 *
 * Permission rules:
 * - Low-risk capabilities (`read_project_file`, `write_artifact_draft`) can be
 *   auto-approved after one explicit approval per session.
 * - Canon-mutating capabilities (`modify_wiki`, `modify_manuscript`,
 *   `apply_wiki_diff`, `sync_change`, `archive_change`) require explicit user
 *   approval each time.
 * - `run_cli` requires explicit approval each time.
 */

import { randomUUID } from "node:crypto";
import { createInterface } from "node:readline";
import type { WebContents } from "electron";
import type {
  AgentStartSessionRequest,
  AgentSendMessageRequest,
  AgentMessageEvent,
  PermissionRequest,
  PermissionResponse,
  AgentCapability,
  AgentSpawnFailedEvent,
} from "../shared/ipc-types.js";
import type {
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
  SessionUpdate,
  ToolCall,
  ToolCallUpdate,
  ContentBlock,
  PlanEntry,
} from "@agentclientprotocol/sdk";
import { AcpClient } from "./acp-client.js";
import { AgentLogger } from "./agent-logger.js";
import { getInstallRoot, findBinary, getBundledSearchDirs } from "./resolve-bundled-binary.js";

// ─── Permission Classification ─────────────────────────────

/** Capabilities that can be auto-approved after one per-session approval. */
const LOW_RISK_CAPABILITIES: ReadonlySet<AgentCapability> = new Set([
  "read_project_file",
  "write_artifact_draft",
]);

/** Capabilities that mutate canon and ALWAYS require explicit user approval. */
const CANON_MUTATION_CAPABILITIES: ReadonlySet<AgentCapability> = new Set([
  "modify_wiki",
  "modify_manuscript",
  "apply_wiki_diff",
  "sync_change",
  "archive_change",
]);

/** Capabilities that always require explicit user approval each time. */
const ALWAYS_REQUIRE_APPROVAL: ReadonlySet<AgentCapability> = new Set([
  "run_cli",
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
export type AgentSessionStatus =
  | "starting"
  | "running"
  | "stopped"
  | "error";

/** A pending permission request with promise resolvers. */
interface PendingAcpPermission {
  request: RequestPermissionRequest;
  resolveResponse: (response: RequestPermissionResponse) => void;
  rejectResponse: (err: Error) => void;
  /** Our internal capability classification. */
  capability: AgentCapability;
  /** The renderer-facing permission request ID. */
  requestId: string;
}

/** A single agent session tracked by the supervisor. */
interface AgentSession {
  sessionId: string;
  status: AgentSessionStatus;
  acpClient: AcpClient | null;
  /** ACP sessionId returned by `newSession`. */
  acpSessionId: string | null;
  config: AgentStartSessionRequest;
  startedAt: string;
  errorMessage?: string;
  /** Capabilities that have been explicitly approved this session. */
  approvedCapabilities: Set<AgentCapability>;
  /** Pending ACP permission requests awaiting user response. */
  pendingAcpPermissions: Map<string, PendingAcpPermission>;
  /** Whether lifecycle events (close/error) have already been handled. */
  settled: boolean;
}

// ─── Agent Config Persistence ──────────────────────────────

/** Agent configuration persisted to disk. */
export interface AgentConfig {
  agentCommand: string;
  args: string[];
  cwd: string;
  apiKey?: string;
  mode: "opencode-default" | "custom-command" | "none";
}

const DEFAULT_CONFIG: AgentConfig = {
  agentCommand: "opencode",
  args: ["acp"],
  cwd: "",
  mode: "opencode-default",
};

/** Maps a `ToolCallUpdate` to an `AgentCapability` for permission routing. */
function mapToolCallToCapability(tc: ToolCallUpdate): AgentCapability {
  const title = tc.title?.toLowerCase() ?? "";
  const kind = tc.kind;
  if (kind === "execute" || title.includes("bash") || title.includes("terminal")) {
    return "run_cli";
  }
  if (kind === "edit" || kind === "delete" || kind === "move" || title.includes("write")) {
    return "write_artifact_draft";
  }
  if (kind === "read" || kind === "search" || title.includes("read") || title.includes("grep") || title.includes("list")) {
    return "read_project_file";
  }
  return "read_project_file";
}

/** Format a tool call for display in the permission request. */
function formatToolCallPreview(tc: ToolCallUpdate): string {
  const title = tc.title ?? "unknown";
  const input =
    tc.rawInput != null ? JSON.stringify(tc.rawInput) : "";
  return `${title} ${input}`.trim();
}


/**
 * Resolve the bundled opencode CLI binary when running in a packaged app.
 *
 * In a packaged (electron-builder) build, the NSIS installer downloads
 * `opencode.exe` to `$INSTDIR` and the app can also ship one via
 * `extraResources`.  This function searches those locations first.
 *
 * Falls back to the configured command (which itself may be a bare name
 * resolved from PATH) when no bundled binary is found.
 */
function resolveOpencodeCommand(configuredCommand: string): string {
  // Only search for bundled binary when using the default mode
  if (!process.resourcesPath) return configuredCommand;

  const installRoot = getInstallRoot();
  const dirs = getBundledSearchDirs(installRoot);
  const bundled = findBinary("opencode", dirs);
  if (bundled) return bundled;

  return configuredCommand;
}

// ─── Supervisor ────────────────────────────────────────────

/**
 * Manages agent child processes via ACP, sessions, and permission routing.
 *
 * Only one session can be active at a time.
 */
export class AgentSupervisor {
  /** Currently active session, if any. */
  private session: AgentSession | null = null;

  /** Agent configuration. */
  private config: AgentConfig = { ...DEFAULT_CONFIG };

  /** Logger for agent events. */
  private logger: AgentLogger | null = null;

  /** Electron web contents for IPC events to the renderer. */
  private sender: WebContents | null = null;

  /** Mutating-command lock (shared with CommandRunner). */
  private mutatingRunning = false;

  attachLogger(logger: AgentLogger | null): void {
    this.logger = logger;
  }

  attachSender(sender: WebContents): void {
    this.sender = sender;
  }

  updateConfig(config: AgentConfig): void {
    this.config = { ...config };
  }

  getConfig(): AgentConfig {
    return { ...this.config };
  }

  isConfigured(): boolean {
    return (
      this.config.mode !== "none" &&
      this.config.agentCommand.trim().length > 0
    );
  }

  getSessionStatus(): {
    sessionId: string | null;
    status: AgentSessionStatus | "none";
    startedAt: string | null;
    errorMessage?: string;
  } {
    if (!this.session) {
      return { sessionId: null, status: "none", startedAt: null };
    }
    return {
      sessionId: this.session.sessionId,
      status: this.session.status,
      startedAt: this.session.startedAt,
      errorMessage: this.session.errorMessage,
    };
  }

  /**
   * Start a new agent session via ACP.
   */
  async startSession(
    request: AgentStartSessionRequest,
  ): Promise<{ sessionId: string }> {
    if (
      this.session &&
      this.session.status !== "stopped" &&
      this.session.status !== "error"
    ) {
      throw new Error("An agent session is already active. Stop it first.");
    }

    const sessionId = randomUUID();
    const effectiveConfig = {
      ...request,
      agentCommand: resolveOpencodeCommand(request.agentCommand || this.config.agentCommand),
      args: request.args.length > 0 ? request.args : this.config.args,
      cwd: request.cwd || this.config.cwd,
    };

    const session: AgentSession = {
      sessionId,
      status: "starting",
      acpClient: null,
      acpSessionId: null,
      config: effectiveConfig,
      startedAt: new Date().toISOString(),
      approvedCapabilities: new Set(),
      pendingAcpPermissions: new Map(),
      settled: false,
    };

    this.session = session;
    await this.logger?.logSessionEvent(
      "session_start",
      sessionId,
      `Starting agent: ${effectiveConfig.agentCommand} ${effectiveConfig.args.join(" ")}`,
    );

    try {
      const isCustom = this.config.mode === "custom-command";
      const initializeTimeoutMs = isCustom ? 15_000 : 30_000;

      const acpClient = new AcpClient({
        command: effectiveConfig.agentCommand,
        args: effectiveConfig.args,
        cwd: effectiveConfig.cwd || process.cwd(),
        initializeTimeoutMs,
        onSessionUpdate: (notification) => {
          this.handleSessionUpdate(sessionId, notification);
        },
        onPermissionRequest: (req) => {
          return this.handleAcpPermissionRequest(sessionId, req);
        },
      });

      // ACP initialize handshake
      const initResponse = await acpClient.start();
      this.emitAgentMessage(
        sessionId,
        "system",
        `Agent connected: ${initResponse.agentInfo?.name ?? "unknown"} v${initResponse.agentInfo?.version ?? "?"} (protocol v${initResponse.protocolVersion})`,
      );

      // Create ACP session
      const newSessionResponse = await acpClient.newSession(
        effectiveConfig.cwd || process.cwd(),
      );
      const acpSessionId = newSessionResponse.sessionId;

      session.acpClient = acpClient;
      session.acpSessionId = acpSessionId;
      session.status = "running";

      // Child process lifecycle events
      const child = acpClient.getChildProcess();
      if (child) {
        child.on("close", (code, signal) => {
          if (session.settled) return;
          session.settled = true;
          const reason = signal
            ? `Process terminated by signal ${signal}`
            : `Process exited with code ${code}`;
          this.emitAgentMessage(sessionId, "system", reason);
          if (session.status === "running") {
            session.status = "stopped";
            session.acpClient = null;
          }
          this.logger
            ?.logSessionEvent("session_stop", sessionId, reason)
            .catch(() => {});
        });

        child.on("error", (err) => {
          if (session.settled) return;
          session.settled = true;
          session.status = "error";
          session.errorMessage = err.message;
          session.acpClient = null;
          this.emitAgentMessage(
            sessionId,
            "system",
            `Agent error: ${err.message}`,
          );
          this.logger
            ?.logSessionEvent("session_error", sessionId, err.message)
            .catch(() => {});
        });

        // Forward stderr
        if (child.stderr) {
          const stderrReader = createInterface({
            input: child.stderr,
            crlfDelay: Infinity,
          });
          stderrReader.on("line", (line: string) => {
            this.emitAgentMessage(sessionId, "system", line);
          });
        }
      }

      this.emitAgentMessage(
        sessionId,
        "system",
        `Agent session started: ${effectiveConfig.agentCommand} (ACP session: ${acpSessionId})`,
      );

      return { sessionId };
    } catch (err) {
      const spawnFailedEvent: AgentSpawnFailedEvent = {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
        timestamp: new Date().toISOString(),
      };
      this.sender?.send("event:agent-spawn-failed", spawnFailedEvent);

      session.status = "error";
      session.errorMessage =
        err instanceof Error ? err.message : String(err);
      this.emitAgentMessage(
        sessionId,
        "system",
        `Failed to start agent: ${session.errorMessage}`,
      );
      await this.logger?.logSessionEvent(
        "session_error",
        sessionId,
        session.errorMessage,
      );
      this.session = null;
      throw err;
    }
  }

  /**
   * Send a message to the active agent session via ACP `session/prompt`.
   */
  async sendMessage(request: AgentSendMessageRequest): Promise<void> {
    const session = this.session;
    if (!session || session.sessionId !== request.sessionId) {
      throw new Error(`No active session with ID ${request.sessionId}`);
    }
    if (!session.acpClient || session.status !== "running") {
      throw new Error("Agent session is not running");
    }
    if (!session.acpSessionId) {
      throw new Error("No ACP session ID");
    }

    await session.acpClient.sendPrompt(
      session.acpSessionId,
      request.message,
    );
  }

  /**
   * Stop the active agent session via ACP `session/cancel` + close.
   */
  async stopSession(sessionId: string): Promise<void> {
    const session = this.session;
    if (!session || session.sessionId !== sessionId) return;

    const client = session.acpClient;
    if (client && session.acpSessionId) {
      try {
        await client.cancel(session.acpSessionId);
      } catch { /* ignore */ }
      client.close();
    }

    session.status = "stopped";
    session.acpClient = null;
    session.acpSessionId = null;
  }

  /**
   * Handle a user's response to a pending permission request.
   * Called from the IPC handler (formerly approvePermission/denyPermission).
   *
   * @param requestId - The renderer-facing permission request ID.
   * @param approved - Whether the user approved.
   */
  respondToPermission(requestId: string, approved: boolean): void {
    const session = this.session;
    if (!session) return;

    const pending = session.pendingAcpPermissions.get(requestId);
    if (!pending) return;

    session.pendingAcpPermissions.delete(requestId);

    if (approved) {
      session.approvedCapabilities.add(pending.capability);
    }

    // Find the matching option in the original request
    const options = pending.request.options;
    const targetKind = approved ? "allow_once" : "reject_once";
    const fallbackKind = approved ? "allow_always" : "reject_always";
    const chosenOpt =
      options.find((o) => o.kind === targetKind) ??
      options.find((o) => o.kind === fallbackKind);

    if (chosenOpt) {
      pending.resolveResponse({
        outcome: { outcome: "selected" as const, optionId: chosenOpt.optionId },
      });
    } else {
      pending.resolveResponse({
        outcome: { outcome: "cancelled" as const },
      });
    }

    this.logger
      ?.logPermissionResponse({ requestId, approved }, session.sessionId)
      .catch(() => {});
  }

  setMutatingRunning(running: boolean): void {
    this.mutatingRunning = running;
  }

  // ── Private: ACP Notification Handling ──────────────────


  private handleSessionUpdate(
    sessionId: string,
    notification: SessionNotification,
  ): void {
    const update: SessionUpdate = notification.update;
    const updateType = (update as { sessionUpdate?: string }).sessionUpdate;

    switch (updateType) {
      // ── Content chunks ──────────────────────────────
      case "user_message_chunk":
      case "agent_message_chunk": {
        const text = this.extractContentText(update);
        if (text) {
          this.emitAgentMessage(sessionId, "agent", text);
        }
        break;
      }
      case "agent_thought_chunk": {
        const text = this.extractContentText(update);
        if (text) {
          this.emitAgentMessage(sessionId, "system", `[thought] ${text}`);
        }
        break;
      }
      // ── Tool calls ──────────────────────────────────
      case "tool_call": {
        const toolCall = update as unknown as ToolCall;
        const toolName = toolCall.title ?? "unknown";
        this.logger
          ?.logToolCall(toolName, toolCall, sessionId, true, undefined)
          .catch(() => {});
        this.emitAgentMessage(
          sessionId,
          "system",
          `Tool call: ${toolName} (id: ${toolCall.toolCallId})`,
        );
        break;
      }
      case "tool_call_update": {
        const tcu = update as unknown as ToolCallUpdate;
        this.emitAgentMessage(
          sessionId,
          "system",
          `Tool call update: ${tcu.title ?? tcu.toolCallId}`,
        );
        break;
      }
      // ── Plans ───────────────────────────────────────
      case "plan":
      case "plan_update": {
        const plan = update as unknown as { entries?: PlanEntry[] };
        if (plan.entries && plan.entries.length > 0) {
          for (const entry of plan.entries) {
            const truncated = entry.content.length > 200
              ? entry.content.slice(0, 200) + "..."
              : entry.content;
            this.emitAgentMessage(
              sessionId,
              "system",
              `[plan ${entry.status}] ${truncated}`,
            );
          }
        }
        break;
      }
      case "plan_removed": {
        this.emitAgentMessage(sessionId, "system", "Plan removed");
        break;
      }
      // ── Metadata updates ────────────────────────────
      case "available_commands_update": {
        this.emitAgentMessage(sessionId, "system", "Available commands updated");
        break;
      }
      case "current_mode_update": {
        const modeUpdate = update as unknown as { modeId?: string };
        this.emitAgentMessage(
          sessionId,
          "system",
          `Mode switched to: ${modeUpdate.modeId ?? "unknown"}`,
        );
        break;
      }
      case "config_option_update": {
        this.emitAgentMessage(sessionId, "system", "Config option updated");
        break;
      }
      case "session_info_update": {
        this.emitAgentMessage(sessionId, "system", "Session info updated");
        break;
      }
      case "usage_update": {
        const usage = update as unknown as { used?: number; size?: number };
        const used = usage.used ?? 0;
        const size = usage.size ?? 0;
        const pct = size > 0 ? Math.round((used / size) * 100) : 0;
        this.emitAgentMessage(
          sessionId,
          "system",
          `Context: ${used}/${size} tokens (${pct}%)`,
        );
        break;
      }
      default:
        this.emitAgentMessage(
          sessionId,
          "system",
          `[${updateType ?? "unknown"}]`,
        );
    }
  }

  /**
   * Extract text from a ContentBlock within a content-chunk update.
   * Returns the text for `type: "text"` blocks, a placeholder for images/audio,
   * the URI for resource links, or null if no content is present.
   */
  private extractContentText(
    update: SessionUpdate,
  ): string | null {
    const chunk = update as unknown as { content?: ContentBlock };
    const content = chunk.content;
    if (!content) return null;

    switch (content.type) {
      case "text":
        return (content as unknown as { text: string }).text;
      case "image":
        return "[image]";
      case "audio":
        return "[audio]";
      case "resource_link":
        return (content as unknown as { uri: string }).uri;
      case "resource":
        return "[embedded resource]";
      default:
        return null;
    }
  }

  /**
   * Handle an ACP `requestPermission` from the agent.
   * Returns synchronously for auto-approved/auto-denied, or a Promise
   * that resolves when the user responds.
   */
  private handleAcpPermissionRequest(
    sessionId: string,
    req: RequestPermissionRequest,
  ): Promise<RequestPermissionResponse> | RequestPermissionResponse {
    const session = this.session;
    if (!session || session.sessionId !== sessionId) {
      // Default deny: pick first reject option
      const rejectOpt = req.options.find(
        (o) => o.kind === "reject_once" || o.kind === "reject_always",
      );
      return rejectOpt
        ? { outcome: { outcome: "selected", optionId: rejectOpt.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

    const capability = mapToolCallToCapability(req.toolCall);
    const permissionId = randomUUID();

    // Auto-approve check
    if (this.canAutoApprove(capability, session)) {
      this.emitAgentMessage(sessionId, "system", `Auto-approved: ${capability}`);
      const allowOpt = req.options.find(
        (o) => o.kind === "allow_once" || o.kind === "allow_always",
      );
      session.approvedCapabilities.add(capability);
      return allowOpt
        ? { outcome: { outcome: "selected", optionId: allowOpt.optionId } }
        : { outcome: { outcome: "cancelled" } };
    }

    // Requires user approval: emit to renderer and wait asynchronously
    const rendererRequest: PermissionRequest = {
      id: permissionId,
      requestedBy: "agent",
      capability,
      scope: req.toolCall.title ? [req.toolCall.title] : [],
      commandPreview: formatToolCallPreview(req.toolCall),
    };

    this.logger
      ?.logPermissionRequest(rendererRequest, sessionId)
      .catch(() => {});

    return new Promise<RequestPermissionResponse>((resolve, reject) => {
      session.pendingAcpPermissions.set(permissionId, {
        request: req,
        resolveResponse: resolve,
        rejectResponse: reject,
        capability,
        requestId: permissionId,
      });

      // Emit to renderer for user decision
      this.sender?.send("event:permission-request", rendererRequest);
    });
  }

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

  // ── Private: Event Emission ─────────────────────────────

  private emitAgentMessage(
    sessionId: string,
    role: "agent" | "system",
    content: string,
  ): void {
    const event: AgentMessageEvent = {
      sessionId,
      role,
      content,
      timestamp: new Date().toISOString(),
    };
    this.logger
      ?.log({
        timestamp: Date.now(),
        iso: event.timestamp,
        event: "message",
        description: `[${role}] ${content.slice(0, 200)}`,
        sessionId,
        payload: event,
      })
      .catch(() => {});
    this.sender?.send("event:agent-message", event);
  }
}

