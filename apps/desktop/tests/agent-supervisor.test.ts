/**
 * Tests for AgentSupervisor with mocked AcpClient.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "node:events";
import type { AgentCapability } from "../shared/ipc-types.js";
import type {
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
  SessionNotification,
  RequestPermissionRequest,
  RequestPermissionResponse,
} from "@agentclientprotocol/sdk";

// ── Mutable state (not vi.hoisted — avoids ordering issues) ──

let startResolve: ((v: InitializeResponse) => void) | null = null;
let startReject: ((e: Error) => void) | null = null;
let newSessionResolve: ((v: NewSessionResponse) => void) | null = null;
let newSessionReject: ((e: Error) => void) | null = null;
let sendPromptResolve: ((v: PromptResponse) => void) | null = null;
let sendPromptReject: ((e: Error) => void) | null = null;
let mockChildEmitter: ReturnType<typeof createMockChildEmitter> | null = null;

let capturedCallbacks: {
  onSessionUpdate?: (n: SessionNotification) => void;
  onPermissionRequest?: (
    req: RequestPermissionRequest,
  ) => RequestPermissionResponse | Promise<RequestPermissionResponse>;
} = {};

function resetMutable() {
  startResolve = null;
  startReject = null;
  newSessionResolve = null;
  newSessionReject = null;
  sendPromptResolve = null;
  sendPromptReject = null;
  mockChildEmitter = null;
  capturedCallbacks = {};
}

function createMockAcpClient() {
  const child = createMockChildEmitter();
  mockChildEmitter = child;
  return {
    start: vi.fn().mockImplementation(() => {
      return new Promise<InitializeResponse>((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });
    }),
    newSession: vi.fn().mockImplementation(() => {
      return new Promise<NewSessionResponse>((resolve, reject) => {
        newSessionResolve = resolve;
        newSessionReject = reject;
      });
    }),
    sendPrompt: vi.fn().mockImplementation(() => {
      return new Promise<PromptResponse>((resolve, reject) => {
        sendPromptResolve = resolve;
        sendPromptReject = reject;
      });
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
    getChildProcess: vi.fn().mockReturnValue(child),
    get initialized() {
      return true;
    },
    get closed() {
      return false;
    },
  };
}

function createMockChildEmitter() {
  const ee = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  return {
    emit: ee.emit.bind(ee),
    on: ee.on.bind(ee),
    addListener: ee.addListener.bind(ee),
    removeListener: ee.removeListener.bind(ee),
    stdout,
    stderr,
    stdin: { write: vi.fn(), destroyed: false },
    kill: vi.fn(),
    exitCode: null as number | null,
    pid: 9999,
  };
}

vi.mock("../electron/acp-client.js", () => {
  // Capture options passed to AcpClient constructor
  const orig = vi.fn().mockImplementation(
    (opts: {
      onSessionUpdate?: (n: SessionNotification) => void;
      onPermissionRequest?: (
        req: RequestPermissionRequest,
      ) => RequestPermissionResponse | Promise<RequestPermissionResponse>;
    }) => {
      capturedCallbacks.onSessionUpdate = opts.onSessionUpdate;
      capturedCallbacks.onPermissionRequest = opts.onPermissionRequest;
      return createMockAcpClient();
    },
  );
  return { AcpClient: orig };
});

vi.mock("node:fs/promises", () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error("not found")),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error("not found")),
}));

vi.mock("node:readline", () => ({
  createInterface: vi.fn(() => ({ on: vi.fn(), close: vi.fn() })),
}));

import {
  AgentSupervisor,
  isCanonMutation,
  isLowRisk,
  alwaysRequiresApproval,
} from "../electron/agent-supervisor.js";
import { AcpClient } from "../electron/acp-client.js";

// ── Helpers ───────────────────────────────────────────────

function mockSender() {
  return { send: vi.fn() } as unknown as Electron.WebContents;
}

function makeStartRequest(overrides: Record<string, unknown> = {}) {
  return {
    agentCommand: "opencode",
    args: ["acp"],
    cwd: "/test/project",
    ...overrides,
  };
}

async function waitForResolver<T>(fn: () => T | null | undefined): Promise<T> {
  while (true) {
    const val = fn();
    if (val) return val;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

function defaultInitResponse(): InitializeResponse {
  return {
    protocolVersion: 1,
    agentCapabilities: {
      loadSession: true,
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: true, sse: true },
      sessionCapabilities: {},
    },
    agentInfo: { name: "opencode", version: "1.0.0" },
    authMethods: [],
  };
}

function defaultNewSessionResponse(): NewSessionResponse {
  return { sessionId: "acp-session-123" };
}

// ── Permission Classification Tests ───────────────────────

describe("AgentSupervisor permission classification", () => {
  it("classifies read_project_file as low risk", () => {
    expect(isLowRisk("read_project_file")).toBe(true);
  });

  it("classifies modify_wiki as canon mutation", () => {
    expect(isCanonMutation("modify_wiki")).toBe(true);
  });

  it("classifies run_cli as always requiring approval", () => {
    expect(alwaysRequiresApproval("run_cli")).toBe(true);
  });

  it("all 8 capabilities are covered", () => {
    const all: AgentCapability[] = [
      "read_project_file", "write_artifact_draft", "run_cli",
      "modify_wiki", "modify_manuscript", "apply_wiki_diff",
      "sync_change", "archive_change",
    ];
    for (const cap of all) {
      expect(typeof isLowRisk(cap)).toBe("boolean");
      expect(typeof alwaysRequiresApproval(cap)).toBe("boolean");
      expect(typeof isCanonMutation(cap)).toBe("boolean");
    }
  });
});

// ── Config Tests ─────────────────────────────────────────

describe("AgentSupervisor config", () => {
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    resetMutable();
    supervisor = new AgentSupervisor();
  });

  it("is configured when mode is opencode-default", () => {
    supervisor.updateConfig({
      agentCommand: "opencode", args: ["acp"], cwd: "/test",
      mode: "opencode-default",
    });
    expect(supervisor.isConfigured()).toBe(true);
  });

  it("is not configured when mode is none", () => {
    supervisor.updateConfig({
      agentCommand: "", args: [], cwd: "", mode: "none",
    });
    expect(supervisor.isConfigured()).toBe(false);
  });
});

// ── Session Lifecycle Tests ───────────────────────────────

describe("AgentSupervisor ACP session lifecycle", () => {
  let supervisor: AgentSupervisor;
  let sender: ReturnType<typeof mockSender>;

  beforeEach(() => {
    resetMutable();
    supervisor = new AgentSupervisor();
    sender = mockSender();
    supervisor.attachSender(sender as unknown as Electron.WebContents);
    supervisor.updateConfig({
      agentCommand: "opencode", args: ["acp"], cwd: "/test",
      mode: "opencode-default",
    });
  });

  async function startAndResolve() {
    const p = supervisor.startSession(makeStartRequest());
    const resolveStart = await waitForResolver(() => startResolve);
    resolveStart(defaultInitResponse());
    const resolveNewSession = await waitForResolver(() => newSessionResolve);
    resolveNewSession(defaultNewSessionResponse());
    return await p;
  }

  it("starts session and returns session ID", async () => {
    const result = await startAndResolve();
    expect(result.sessionId).toBeTruthy();
  });

  it("rejects second session while one is active", async () => {
    await startAndResolve();
    await expect(supervisor.startSession(makeStartRequest())).rejects.toThrow("already active");
  });

  it("stops active session", async () => {
    const result = await startAndResolve();
    await supervisor.stopSession(result.sessionId);
    expect(supervisor.getSessionStatus().status).toBe("stopped");
  });

  it("handles initialize timeout", async () => {
    const p = supervisor.startSession(makeStartRequest());
    const rejectStart = await waitForResolver(() => startReject);
    rejectStart(new Error("timed out after 30000ms"));
    await expect(p).rejects.toThrow("timed out");
  });

  it("handles process close event", async () => {
    await startAndResolve();
    const child = mockChildEmitter!;
    child.exitCode = 0;
    child.emit("close", 0, null);
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: expect.stringContaining("exited") }),
    );
  });

  it("handles spawn failure", async () => {
    const p = supervisor.startSession(makeStartRequest());
    const rejectStart = await waitForResolver(() => startReject);
    rejectStart(new Error("Spawn failed: ENOENT"));
    await expect(p).rejects.toThrow("Spawn failed");
    expect(supervisor.getSessionStatus().status).toBe("none");
  });
});

// ── Session Update Tests ─────────────────────────────────

describe("AgentSupervisor session update", () => {
  let supervisor: AgentSupervisor;
  let sender: ReturnType<typeof mockSender>;

  beforeEach(async () => {
    resetMutable();
    supervisor = new AgentSupervisor();
    sender = mockSender();
    supervisor.attachSender(sender as unknown as Electron.WebContents);
    supervisor.updateConfig({
      agentCommand: "opencode", args: ["acp"], cwd: "/test",
      mode: "opencode-default",
    });
    const p = supervisor.startSession(makeStartRequest());
    const resolveStart = await waitForResolver(() => startResolve);
    resolveStart(defaultInitResponse());
    const resolveNewSession = await waitForResolver(() => newSessionResolve);
    resolveNewSession(defaultNewSessionResponse());
    await p;
  });

  it("handles agent_message_chunk with correct ContentBlock shape", () => {
    expect(capturedCallbacks.onSessionUpdate).toBeDefined();
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text: "Hello" },
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ role: "agent", content: "Hello" }),
    );
  });

  it("handles agent_thought_chunk with correct ContentBlock shape", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text: "Let me think..." },
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("[thought] Let me think..."),
      }),
    );
  });

  it("handles image content block with placeholder", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "image" },
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: "[image]" }),
    );
  });

  it("handles user_message_chunk", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text: "User echo" },
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ role: "agent", content: "User echo" }),
    );
  });

  it("handles plan with entries", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "plan",
        entries: [
          { status: "pending", content: "Add login form" },
          { status: "in_progress", content: "Add dashboard" },
        ],
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        content: expect.stringContaining("[plan pending] Add login form"),
      }),
    );
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        content: expect.stringContaining("[plan in_progress] Add dashboard"),
      }),
    );
  });

  it("handles plan_update", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "plan_update",
        entries: [{ status: "completed", content: "Add login form" }],
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        content: expect.stringContaining("[plan completed]"),
      }),
    );
  });

  it("handles plan_removed", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "plan_removed",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: "Plan removed" }),
    );
  });

  it("handles usage_update with context window info", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "usage_update",
        used: 5000,
        size: 200000,
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        content: expect.stringContaining("Context: 5000/200000 tokens"),
      }),
    );
  });

  it("handles current_mode_update", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "current_mode_update",
        modeId: "architect",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        content: expect.stringContaining("Mode switched to: architect"),
      }),
    );
  });

  it("handles available_commands_update", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "available_commands_update",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: "Available commands updated" }),
    );
  });

  it("handles config_option_update", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "config_option_update",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: "Config option updated" }),
    );
  });

  it("handles session_info_update", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "session_info_update",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: "Session info updated" }),
    );
  });

  it("handles tool_call", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "read_file",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: expect.stringContaining("read_file") }),
    );
  });

  it("handles tool_call", () => {
    capturedCallbacks.onSessionUpdate!({
      sessionId: "acp-session-123",
      update: {
        sessionUpdate: "tool_call",
        toolCallId: "tc-1",
        title: "read_file",
      } as unknown as SessionNotification["update"],
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({ content: expect.stringContaining("read_file") }),
    );
  });
});

// ── Permission Tests ─────────────────────────────────────

describe("AgentSupervisor ACP permission", () => {
  let supervisor: AgentSupervisor;
  let sender: ReturnType<typeof mockSender>;

  beforeEach(async () => {
    resetMutable();
    supervisor = new AgentSupervisor();
    sender = mockSender();
    supervisor.attachSender(sender as unknown as Electron.WebContents);
    supervisor.updateConfig({
      agentCommand: "opencode", args: ["acp"], cwd: "/test",
      mode: "opencode-default",
    });
    const p = supervisor.startSession(makeStartRequest());
    const resolveStart = await waitForResolver(() => startResolve);
    resolveStart(defaultInitResponse());
    const resolveNewSession = await waitForResolver(() => newSessionResolve);
    resolveNewSession(defaultNewSessionResponse());
    await p;
  });

  it("auto-approves low-risk read after first approval", () => {
    expect(capturedCallbacks.onPermissionRequest).toBeDefined();

    // First request for read — needs user approval (not auto-approved yet)
    const result1 = capturedCallbacks.onPermissionRequest!({
      sessionId: "acp-session-123",
      toolCall: { toolCallId: "tc-1", title: "read_file", kind: "read" },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow-1" },
        { kind: "reject_once", name: "Deny", optionId: "reject-1" },
      ],
    });
    // First time: should be a Promise (pending user approval)
    expect(result1).toBeInstanceOf(Promise);
    expect(sender.send).toHaveBeenCalledWith(
      "event:permission-request",
      expect.objectContaining({ capability: "read_project_file" }),
    );
  });

  it("emits permission request for execute-kind tool calls", () => {
    const result = capturedCallbacks.onPermissionRequest!({
      sessionId: "acp-session-123",
      toolCall: { toolCallId: "tc-2", title: "bash", kind: "execute" },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow-1" },
        { kind: "reject_once", name: "Deny", optionId: "reject-1" },
      ],
    });
    expect(result).toBeInstanceOf(Promise);
    expect(sender.send).toHaveBeenCalledWith(
      "event:permission-request",
      expect.objectContaining({ capability: "run_cli" }),
    );
  });

  it("automatically rejects direct modifications to adab/wiki/", async () => {
    expect(capturedCallbacks.onPermissionRequest).toBeDefined();

    const result = capturedCallbacks.onPermissionRequest!({
      sessionId: "acp-session-123",
      toolCall: {
        toolCallId: "tc-write-wiki",
        title: "write_file",
        kind: "edit",
        rawInput: { path: "adab/wiki/homepage.md", content: "hello" },
      },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow-1" },
        { kind: "reject_once", name: "Deny", optionId: "reject-1" },
      ],
    });

    // Should resolve synchronously to selected optionId: "reject-1"
    expect(result).not.toBeInstanceOf(Promise);
    expect((result as RequestPermissionResponse).outcome).toEqual({
      outcome: "selected",
      optionId: "reject-1",
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Direct modification of adab/wiki/homepage.md is forbidden"),
      }),
    );
  });

  it("automatically rejects direct modifications to adab/manuscript/", async () => {
    expect(capturedCallbacks.onPermissionRequest).toBeDefined();

    const result = capturedCallbacks.onPermissionRequest!({
      sessionId: "acp-session-123",
      toolCall: {
        toolCallId: "tc-write-ms",
        title: "edit_file",
        kind: "edit",
        rawInput: { filePath: "adab/manuscript/chapters/ch1.md", text: "hello" },
      },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow-1" },
        { kind: "reject_once", name: "Deny", optionId: "reject-1" },
      ],
    });

    expect(result).not.toBeInstanceOf(Promise);
    expect((result as RequestPermissionResponse).outcome).toEqual({
      outcome: "selected",
      optionId: "reject-1",
    });
    expect(sender.send).toHaveBeenCalledWith(
      "event:agent-message",
      expect.objectContaining({
        role: "system",
        content: expect.stringContaining("Direct modification of adab/manuscript/chapters/ch1.md is forbidden"),
      }),
    );
  });

  it("allows modifications to other paths (e.g. adab/changes/)", async () => {
    expect(capturedCallbacks.onPermissionRequest).toBeDefined();

    const result = capturedCallbacks.onPermissionRequest!({
      sessionId: "acp-session-123",
      toolCall: {
        toolCallId: "tc-write-draft",
        title: "write_file",
        kind: "edit",
        rawInput: { path: "adab/changes/draft-123.md", content: "hello" },
      },
      options: [
        { kind: "allow_once", name: "Allow", optionId: "allow-1" },
        { kind: "reject_once", name: "Deny", optionId: "reject-1" },
      ],
    });

    expect(result).toBeInstanceOf(Promise);
    expect(sender.send).toHaveBeenCalledWith(
      "event:permission-request",
      expect.objectContaining({ capability: "write_artifact_draft" }),
    );
  });
});
