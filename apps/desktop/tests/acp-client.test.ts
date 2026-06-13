/**
 * Tests for AcpClient: ACP initialize handshake, session creation,
 * prompt sending, cancel, close, timeout handling, and graceful
 * degradation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  InitializeResponse,
  NewSessionResponse,
  PromptResponse,
} from "@agentclientprotocol/sdk";

// ── Mocks ─────────────────────────────────────────────────

const mockSpawnee = vi.hoisted(() => {
  const { EventEmitter } = require("node:events");
  const ee = new EventEmitter();
  const stdout = new EventEmitter() as NodeJS.ReadableStream & typeof EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & typeof EventEmitter;
  return {
    child: {
      ...ee,
      emit: ee.emit.bind(ee),
      on: ee.on.bind(ee),
      addListener: ee.addListener.bind(ee),
      removeListener: ee.removeListener.bind(ee),
      stdout,
      stderr,
      stdin: { write: vi.fn((_data: unknown, cb?: (err?: Error) => void) => cb?.()), destroyed: false },
      kill: vi.fn(),
      exitCode: null as number | null,
      pid: 1234,
    },
    stdout,
    stderr,
  };
});

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => mockSpawnee.child),
}));

// Accumulators for mock resolver state
const mockResolvers = {
  initResolve: null as ((v: InitializeResponse) => void) | null,
  initReject: null as ((e: Error) => void) | null,
  newSessionResolve: null as ((v: NewSessionResponse) => void) | null,
  newSessionReject: null as ((e: Error) => void) | null,
  promptResolve: null as ((v: PromptResponse) => void) | null,
  promptReject: null as ((e: Error) => void) | null,
};

const mockCancelFn = vi.fn().mockResolvedValue(undefined);

const mockConnection = {
  initialize: vi.fn().mockImplementation(
    () =>
      new Promise<InitializeResponse>((resolve, reject) => {
        mockResolvers.initResolve = resolve;
        mockResolvers.initReject = reject;
      }),
  ),
  newSession: vi.fn().mockImplementation(
    () =>
      new Promise<NewSessionResponse>((resolve, reject) => {
        mockResolvers.newSessionResolve = resolve;
        mockResolvers.newSessionReject = reject;
      }),
  ),
  prompt: vi.fn().mockImplementation(
    () =>
      new Promise<PromptResponse>((resolve, reject) => {
        mockResolvers.promptResolve = resolve;
        mockResolvers.promptReject = reject;
      }),
  ),
  cancel: mockCancelFn,
};

vi.mock("@agentclientprotocol/sdk", () => ({
  ClientSideConnection: vi.fn(() => mockConnection),
  ndJsonStream: vi.fn(() => ({
    readable: new ReadableStream(),
    writable: new WritableStream(),
  })),
}));

// ── Subject ──────────────────────────────────────────────

import { AcpClient } from "../electron/acp-client.js";

function makeOptions(overrides: Record<string, unknown> = {}) {
  return {
    command: "opencode",
    args: ["acp"],
    cwd: "/test/project",
    initializeTimeoutMs: 5000,
    ...overrides,
  };
}

function defaultInitResponse(): InitializeResponse {
  return {
    protocolVersion: 1,
    agentCapabilities: {
      promptCapabilities: { image: true, audio: false, embeddedContext: true },
      mcpCapabilities: { http: true, sse: true },
      sessionCapabilities: {},
    },
    agentInfo: { name: "opencode", version: "2.0.0" },
    authMethods: [],
  };
}

function resetResolvers() {
  mockResolvers.initResolve = null;
  mockResolvers.initReject = null;
  mockResolvers.newSessionResolve = null;
  mockResolvers.newSessionReject = null;
  mockResolvers.promptResolve = null;
  mockResolvers.promptReject = null;
}

// ── Tests ─────────────────────────────────────────────────

describe("AcpClient", () => {
  beforeEach(() => {
    resetResolvers();
    mockCancelFn.mockClear();
    mockConnection.initialize.mockClear();
    mockConnection.newSession.mockClear();
    mockConnection.prompt.mockClear();
    mockConnection.cancel.mockClear();
  });

  describe("start()", () => {
    it("performs ACP initialize handshake and returns response", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      const result = await startPromise;
      expect(result.protocolVersion).toBe(1);
      expect(result.agentInfo?.name).toBe("opencode");
      expect(client.initialized).toBe(true);
      client.close();
    });

    it("throws on initialize timeout", async () => {
      const client = new AcpClient(makeOptions({ initializeTimeoutMs: 100 }));
      await expect(client.start()).rejects.toThrow("timed out");
      expect(client.initialized).toBe(false);
      client.close();
    });

    it("throws on protocol version mismatch", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!({
        protocolVersion: 2,
        agentCapabilities: {},
        agentInfo: { name: "test", version: "1.0" },
        authMethods: [],
      });
      await expect(startPromise).rejects.toThrow("not supported");
      client.close();
    });

    it("throws if started twice", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;
      await expect(client.start()).rejects.toThrow("already started");
      client.close();
    });

    it("throws if closed before start", async () => {
      const client = new AcpClient(makeOptions());
      client.close();
      await expect(client.start()).rejects.toThrow("has been closed");
    });
  });

  describe("newSession()", () => {
    it("creates a session and returns sessionId", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;

      const sessionPromise = client.newSession("/test/cwd");
      mockResolvers.newSessionResolve!({ sessionId: "ses-abc-123" });
      const result = await sessionPromise;
      expect(result.sessionId).toBe("ses-abc-123");
      client.close();
    });

    it("throws if not initialized", async () => {
      const client = new AcpClient(makeOptions());
      await expect(client.newSession("/tmp")).rejects.toThrow("not initialized");
      client.close();
    });
  });

  describe("sendPrompt()", () => {
    it("sends a prompt and returns stop reason", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;

      mockResolvers.newSessionResolve!({ sessionId: "s1" });
      await client.newSession("/test");

      const promptPromise = client.sendPrompt("s1", "Hello");
      mockResolvers.promptResolve!({ stopReason: "end_turn" });
      const result = await promptPromise;

      expect(result.stopReason).toBe("end_turn");
      expect(mockConnection.prompt).toHaveBeenCalledWith({
        sessionId: "s1",
        prompt: [{ type: "text", text: "Hello" }],
      });
      client.close();
    });

    it("throws if not initialized", async () => {
      const client = new AcpClient(makeOptions());
      await expect(client.sendPrompt("any", "hi")).rejects.toThrow("not initialized");
      client.close();
    });
  });

  describe("cancel()", () => {
    it("sends cancel notification for a session", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;

      await client.cancel("my-session");
      expect(mockConnection.cancel).toHaveBeenCalledWith({
        sessionId: "my-session",
      });
      client.close();
    });

    it("is a no-op when not initialized", async () => {
      const client = new AcpClient(makeOptions());
      await expect(client.cancel("x")).resolves.toBeUndefined();
      client.close();
    });
  });

  describe("close()", () => {
    it("closes the child process", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;

      client.close();
      expect(client.closed).toBe(true);
      expect(client.initialized).toBe(false);
    });
  });

  describe("getChildProcess()", () => {
    it("returns the child process after start", async () => {
      const client = new AcpClient(makeOptions());
      const startPromise = client.start();
      mockResolvers.initResolve!(defaultInitResponse());
      await startPromise;

      expect(client.getChildProcess()).toBeTruthy();
      client.close();
    });

    it("returns null before start", () => {
      const client = new AcpClient(makeOptions());
      expect(client.getChildProcess()).toBeNull();
      client.close();
    });
  });
});
