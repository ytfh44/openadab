/**
 * ACP (Agent Client Protocol) client for the Electron main process.
 *
 * Wraps the `@agentclientprotocol/sdk` `ClientSideConnection` to provide a
 * simplified typed interface for: `initialize()`, `newSession()`, `sendPrompt()`,
 * `cancel()`, and `close()`. Translates between Node.js child-process streams
 * and the Web Streams API required by the SDK.
 *
 * Notification callbacks (`onSessionUpdate`, `onPermissionRequest`) allow the
 * caller to observe agent output and route permission decisions.
 */

import { spawn, type ChildProcess } from "node:child_process";
import {
  ClientSideConnection,
  ndJsonStream,
} from "@agentclientprotocol/sdk";
import type {
  Client,
  Stream,
} from "@agentclientprotocol/sdk";
import type {
  InitializeRequest,
  InitializeResponse,
  NewSessionRequest,
  NewSessionResponse,
  PromptRequest,
  PromptResponse,
  CancelNotification,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

// ─── Types ────────────────────────────────────────────────

/**
 * Callback invoked for each `session/update` notification from the agent.
 */
export type SessionUpdateHandler = (
  notification: SessionNotification,
) => void | Promise<void>;

/**
 * Callback invoked when the agent requests user permission for a tool call.
 * May return synchronously or asynchronously (for user-prompt flows).
 */
export type PermissionRequestHandler = (
  request: RequestPermissionRequest,
) =>
  | RequestPermissionResponse
  | Promise<RequestPermissionResponse>;

/**
 * Options for creating an AcpClient.
 */
export interface AcpClientOptions {
  /** Agent command to spawn (e.g., "opencode"). */
  command: string;
  /** Arguments passed to the agent command (e.g., ["acp"]). */
  args: string[];
  /** Working directory for the agent process. */
  cwd: string;
  /** Additional environment variables. */
  env?: Record<string, string>;
  /** Handler for session update notifications. */
  onSessionUpdate?: SessionUpdateHandler;
  /** Handler for agent permission requests. */
  onPermissionRequest?: PermissionRequestHandler;
  /** Timeout in milliseconds for the initialize handshake. Default 30_000. */
  initializeTimeoutMs?: number;
}

// ─── AcpClient ────────────────────────────────────────────

/**
 * Manages an ACP agent process and its stdio-based JSON-RPC connection.
 *
 * Lifecycle:
 *   1. `start()` — spawns the agent process, creates Web Streams, initializes
 *      the `ClientSideConnection`, performs the ACP `initialize` handshake.
 *   2. `newSession(cwd)` — creates a session via `session/new`.
 *   3. `sendPrompt(sessionId, message)` — sends a user prompt.
 *   4. `cancel(sessionId)` — sends `session/cancel`.
 *   5. `close()` — terminates the agent process.
 */
export class AcpClient {
  private child: ChildProcess | null = null;
  private connection: ClientSideConnection | null = null;
  private options: AcpClientOptions;
  private _initialized = false;
  private _closed = false;

  constructor(options: AcpClientOptions) {
    this.options = {
      initializeTimeoutMs: 30_000,
      ...options,
    };
  }

  /** Whether the ACP initialize handshake has completed. */
  get initialized(): boolean {
    return this._initialized;
  }

  /** Whether the client has been closed. */
  get closed(): boolean {
    return this._closed;
  }

  /**
   * Spawns the agent process, creates the ACP stream, and performs the
   * `initialize` handshake.
   *
   * @returns The agent's initialize response (capabilities, protocol version).
   * @throws If the handshake fails or times out.
   */
  async start(): Promise<InitializeResponse> {
    if (this._closed) {
      throw new Error("AcpClient has been closed");
    }
    if (this.child) {
      throw new Error("AcpClient already started");
    }

    // Spawn agent process
    const child = spawn(this.options.command, this.options.args, {
      cwd: this.options.cwd,
      env: { ...process.env, ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    this.child = child;

    // Convert Node.js streams to Web Streams
    const input = new WritableStream<Uint8Array>({
      write(chunk) {
        return new Promise<void>((resolve, reject) => {
          if (!child.stdin || child.stdin.destroyed) {
            reject(new Error("stdin closed"));
            return;
          }
          child.stdin.write(chunk, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
      },
    });

    const output = new ReadableStream<Uint8Array>({
      start(controller) {
        if (!child.stdout) {
          controller.error(new Error("stdout not available"));
          return;
        }
        child.stdout.on("data", (chunk: Buffer) => {
          controller.enqueue(new Uint8Array(chunk));
        });
        child.stdout.on("end", () => controller.close());
        child.stdout.on("error", (err) => controller.error(err));
      },
      cancel() {
        // Stream cancelled — cleanup in close()
      },
    });

    const stream: Stream = ndJsonStream(input, output);

    // Build the Client handler
    const client: Client = {
      sessionUpdate: (notification: SessionNotification) => {
        if (this.options.onSessionUpdate) {
          const result = this.options.onSessionUpdate(notification);
          return result instanceof Promise ? result : Promise.resolve();
        }
        return Promise.resolve();
      },
      requestPermission: (
        request: RequestPermissionRequest,
      ): Promise<RequestPermissionResponse> => {
        if (this.options.onPermissionRequest) {
          const result = this.options.onPermissionRequest(request);
          return result instanceof Promise
            ? result
            : Promise.resolve(result);
        }
        // Default: pick the first reject option
        const rejectOpt = request.options.find(
          (o) => o.kind === "reject_once" || o.kind === "reject_always",
        );
        return Promise.resolve({
          outcome: rejectOpt
            ? { outcome: "selected" as const, optionId: rejectOpt.optionId }
            : { outcome: "cancelled" as const },
        });
      },
    };

    // Create the connection
    const connection = new ClientSideConnection(
      () => client,
      stream,
    );
    this.connection = connection;

    // Perform initialize handshake with timeout
    const timeoutMs = this.options.initializeTimeoutMs ?? 30_000;
    const initRequest: InitializeRequest = {
      protocolVersion: 1,
      clientCapabilities: {
        fs: { readTextFile: false, writeTextFile: false },
        terminal: false,
      },
      clientInfo: {
        name: "openadab-desktop",
        version: "0.1.0",
      },
    };

    const initPromise = connection.initialize(initRequest);
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(
        () =>
          reject(
            new Error(`ACP initialize timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      );
    });

    try {
      const response = await Promise.race([initPromise, timeoutPromise]);
      if (response.protocolVersion !== 1) {
        throw new Error(
          `Agent protocol version ${response.protocolVersion} is not supported (expected 1)`,
        );
      }
      this._initialized = true;
      return response;
    } catch (err) {
      // On failure, clean up
      this.close();
      throw err;
    }
  }

  /**
   * Creates a new ACP session via `session/new`.
   *
   * @param cwd - Working directory for the session.
   * @returns The session creation response including `sessionId`.
   */
  async newSession(cwd: string): Promise<NewSessionResponse> {
    this.ensureReady();
    const request: NewSessionRequest = {
      cwd,
      mcpServers: [],
    };
    return this.connection!.newSession(request);
  }

  /**
   * Sends a user text prompt to the agent via `session/prompt`.
   *
   * Returns when the turn completes. During the turn, `onSessionUpdate` is
   * called for each `session/update` notification.
   *
   * @param sessionId - The session ID from `newSession()`.
   * @param message - The user's text message.
   * @returns The prompt response including `stopReason`.
   */
  async sendPrompt(
    sessionId: string,
    message: string,
  ): Promise<PromptResponse> {
    this.ensureReady();
    const request: PromptRequest = {
      sessionId,
      prompt: [{ type: "text", text: message }],
    };
    return this.connection!.prompt(request);
  }

  /**
   * Cancels an in-progress prompt turn via `session/cancel` notification.
   *
   * @param sessionId - The session ID to cancel.
   */
  async cancel(sessionId: string): Promise<void> {
    if (!this._initialized || !this.connection) return;
    const notification: CancelNotification = { sessionId };
    await this.connection.cancel(notification);
  }

  /**
   * Terminates the agent process and cleans up all resources.
   */
  close(): void {
    this._closed = true;
    this._initialized = false;
    this.connection = null;

    if (this.child) {
      const child = this.child;
      this.child = null;

      if (child.stdin && !child.stdin.destroyed) {
        try { child.stdin.end(); } catch { /* ignore */ }
      }

      setTimeout(() => {
        if (child.exitCode === null) {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
        }
      }, 2000);
    }
  }

  /**
   * Returns the underlying child process, for lifecycle event binding.
   */
  getChildProcess(): ChildProcess | null {
    return this.child;
  }

  // ── Private ────────────────────────────────────────────

  private ensureReady(): void {
    if (this._closed) {
      throw new Error("AcpClient has been closed");
    }
    if (!this._initialized || !this.connection) {
      throw new Error("AcpClient not initialized — call start() first");
    }
  }
}
