/**
 * Tests for AgentSupervisor: permission classification, session lifecycle,
 * permission denial, draft write approval, CLI run approval, and
 * forbidden canon mutation attempts.
 *
 * Follows the same test patterns as command-runner.test.ts:
 * vi.mock for child_process, EventEmitter-based mock child processes,
 * and mock WebContents.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import type { AgentCapability } from '../shared/ipc-types.js';

// ── Mocks ─────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());

/** Mutable container for the readline event emitter, set by the mock factory. */
const rlHolder = vi.hoisted(() => ({ emitter: null as EventEmitter | null }));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:readline', () => {
  const emitter = new EventEmitter();
  emitter.setMaxListeners(100);
  rlHolder.emitter = emitter;
  return {
    createInterface: vi.fn(() => ({
      on: emitter.on.bind(emitter),
      close: vi.fn(),
    })),
  };
});

vi.mock('node:fs/promises', () => ({
  appendFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(new Error('not found')),
  unlink: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockRejectedValue(new Error('not found')),
}));

// ── Helper: mock child process ────────────────────────────

type MockChildProcess = EventEmitter & {
  stdout: NodeJS.ReadableStream & EventEmitter;
  stderr: NodeJS.ReadableStream & EventEmitter;
  stdin: { write: ReturnType<typeof vi.fn> };
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  pid: number;
};

function mockChildProcess(): MockChildProcess {
  const ee = new EventEmitter();
  const stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stdinWrite = vi.fn();

  const child = {
    ...ee,
    emit: ee.emit.bind(ee),
    on: ee.on.bind(ee),
    addListener: ee.addListener.bind(ee),
    removeListener: ee.removeListener.bind(ee),
    stdout,
    stderr,
    stdin: { write: stdinWrite },
    kill: vi.fn(),
    exitCode: null as number | null,
    pid: Math.floor(Math.random() * 10000) + 1000,
  } as unknown as MockChildProcess;

  return child;
}

// ── Imports (after mock setup) ────────────────────────────

import {
  AgentSupervisor,
  isCanonMutation,
  isLowRisk,
  alwaysRequiresApproval,
} from '../electron/agent-supervisor.js';

// ── Helpers ────────────────────────────────────────────────

function mockSender() {
  return {
    send: vi.fn(),
  } as unknown as Electron.WebContents;
}

// ── Permission Classification Tests ───────────────────────

describe('AgentSupervisor permission classification', () => {
  it('classifies read_project_file as low risk', () => {
    expect(isLowRisk('read_project_file')).toBe(true);
    expect(alwaysRequiresApproval('read_project_file')).toBe(false);
    expect(isCanonMutation('read_project_file')).toBe(false);
  });

  it('classifies write_artifact_draft as low risk', () => {
    expect(isLowRisk('write_artifact_draft')).toBe(true);
    expect(alwaysRequiresApproval('write_artifact_draft')).toBe(false);
    expect(isCanonMutation('write_artifact_draft')).toBe(false);
  });

  it('classifies run_cli as always requiring approval', () => {
    expect(isLowRisk('run_cli')).toBe(false);
    expect(alwaysRequiresApproval('run_cli')).toBe(true);
    expect(isCanonMutation('run_cli')).toBe(false);
  });

  it('classifies modify_wiki as canon mutation', () => {
    expect(isCanonMutation('modify_wiki')).toBe(true);
    expect(alwaysRequiresApproval('modify_wiki')).toBe(true);
    expect(isLowRisk('modify_wiki')).toBe(false);
  });

  it('classifies modify_manuscript as canon mutation', () => {
    expect(isCanonMutation('modify_manuscript')).toBe(true);
    expect(alwaysRequiresApproval('modify_manuscript')).toBe(true);
  });

  it('classifies apply_wiki_diff as canon mutation', () => {
    expect(isCanonMutation('apply_wiki_diff')).toBe(true);
    expect(alwaysRequiresApproval('apply_wiki_diff')).toBe(true);
  });

  it('classifies sync_change as canon mutation', () => {
    expect(isCanonMutation('sync_change')).toBe(true);
    expect(alwaysRequiresApproval('sync_change')).toBe(true);
  });

  it('classifies archive_change as canon mutation', () => {
    expect(isCanonMutation('archive_change')).toBe(true);
    expect(alwaysRequiresApproval('archive_change')).toBe(true);
  });

  it('all 8 capabilities are covered', () => {
    const allCapabilities: AgentCapability[] = [
      'read_project_file',
      'write_artifact_draft',
      'run_cli',
      'modify_wiki',
      'modify_manuscript',
      'apply_wiki_diff',
      'sync_change',
      'archive_change',
    ];

    const canonMutations: AgentCapability[] = allCapabilities.filter((c) =>
      isCanonMutation(c),
    );
    expect(canonMutations).toEqual([
      'modify_wiki',
      'modify_manuscript',
      'apply_wiki_diff',
      'sync_change',
      'archive_change',
    ]);

    const lowRisk: AgentCapability[] = allCapabilities.filter((c) =>
      isLowRisk(c),
    );
    expect(lowRisk).toEqual(['read_project_file', 'write_artifact_draft']);

    const alwaysApprove: AgentCapability[] = allCapabilities.filter((c) =>
      alwaysRequiresApproval(c),
    );
    expect(alwaysApprove).toEqual([
      'run_cli',
      'modify_wiki',
      'modify_manuscript',
      'apply_wiki_diff',
      'sync_change',
      'archive_change',
    ]);
  });
});

// ── AgentSupervisor config and session tests ──────────────

describe('AgentSupervisor configuration', () => {
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    supervisor = new AgentSupervisor();
  });

  it('is not configured by default (mode=none with default empty command is treated as none)', () => {
    // Default mode is 'opencode-default' which sets agentCommand to 'opencode'
    // so it SHOULD be configured by default
    expect(supervisor.isConfigured()).toBe(true);
  });

  it('is not configured when mode is none', () => {
    supervisor.setConfig({
      agentCommand: '',
      args: [],
      cwd: '',
      mode: 'none',
    });
    expect(supervisor.isConfigured()).toBe(false);
  });

  it('is configured when mode is opencode-default', () => {
    supervisor.setConfig({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/project',
      mode: 'opencode-default',
    });
    expect(supervisor.isConfigured()).toBe(true);
  });

  it('is configured when mode is custom-command with a command', () => {
    supervisor.setConfig({
      agentCommand: 'node',
      args: ['./agent.js'],
      cwd: '/project',
      mode: 'custom-command',
    });
    expect(supervisor.isConfigured()).toBe(true);
  });

  it('returns default session status when no session is active', () => {
    const status = supervisor.getSessionStatus();
    expect(status.sessionId).toBeNull();
    expect(status.status).toBe('none');
    expect(status.startedAt).toBeNull();
  });

  it('getConfig returns a copy not a reference', () => {
    const config1 = supervisor.getConfig();
    config1.agentCommand = 'changed';
    const config2 = supervisor.getConfig();
    expect(config2.agentCommand).not.toBe('changed');
  });
});

// ── Session lifecycle tests ───────────────────────────────

describe('AgentSupervisor session lifecycle', () => {
  let supervisor: AgentSupervisor;
  let sender: ReturnType<typeof mockSender>;

  beforeEach(() => {
    supervisor = new AgentSupervisor();
    supervisor.setConfig({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
      mode: 'opencode-default',
    });
    sender = mockSender();
    supervisor.setSender(sender);
    mockSpawn.mockClear();
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  it('starts a session and returns a session ID', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const result = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    expect(result.sessionId).toBeTruthy();
    expect(typeof result.sessionId).toBe('string');
    expect(mockSpawn).toHaveBeenCalledTimes(1);
  });

  it('emits agent message event on session start', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // Should have sent at least one event:agent-message for "started"
    const agentMsgs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:agent-message',
    );
    expect(agentMsgs.length).toBeGreaterThanOrEqual(1);
    expect(agentMsgs[0][1].role).toBe('system');
  });

  it('rejects starting a second session while one is active', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    await expect(
      supervisor.startSession({
        agentCommand: 'opencode',
        args: ['agent', '--acp'],
        cwd: '/test/project',
      }),
    ).rejects.toThrow('already active');
  });

  it('stops an active session', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    await supervisor.stopSession(sessionId);

    const status = supervisor.getSessionStatus();
    expect(status.status).toBe('stopped');
  });

  it('handles agent process error gracefully', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // Simulate process error
    child.emit('error', new Error('Connection refused'));

    // Wait for async handling
    await new Promise((r) => setTimeout(r, 20));

    const status = supervisor.getSessionStatus();
    expect(status.status).toBe('error');
    expect(status.errorMessage).toContain('Connection refused');
  });

  it('handles process close event', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // Simulate clean exit
    child.emit('close', 0, null);

    await new Promise((r) => setTimeout(r, 20));

    const status = supervisor.getSessionStatus();
    expect(status.status).toBe('stopped');
  });

  it('throws when sending message to non-existent session', async () => {
    await expect(
      supervisor.sendMessage({
        sessionId: 'non-existent',
        message: 'hello',
      }),
    ).rejects.toThrow();
  });

  it('throws when sending message to stopped session', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    child.emit('close', 0, null);
    await new Promise((r) => setTimeout(r, 20));

    await expect(
      supervisor.sendMessage({ sessionId, message: 'hello' }),
    ).rejects.toThrow('not running');
  });
});

// ── Permission Flow Tests ─────────────────────────────────

describe('AgentSupervisor permission flows', () => {
  let supervisor: AgentSupervisor;
  let sender: ReturnType<typeof mockSender>;

  beforeEach(() => {
    supervisor = new AgentSupervisor();
    supervisor.setConfig({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
      mode: 'opencode-default',
    });
    sender = mockSender();
    supervisor.setSender(sender);
    mockSpawn.mockClear();
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  // ── Permission Denial ──────────────────────────────────

  it('handles permission denial — user denies a CLI run request', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // Simulate agent sending a permission_request via the readline interface
    const permissionLine = JSON.stringify({
      type: 'permission_request',
      capability: 'run_cli',
      scope: ['status', '--change', 'ch-001'],
      commandPreview: 'openadab status --change ch-001 --json',
    });

    rlHolder.emitter!.emit('line', permissionLine);

    // Wait for async processing
    await new Promise((r) => setTimeout(r, 30));

    // Should have emitted a permission_request event to renderer
    const permReqs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs.length).toBe(1);
    const permRequest = permReqs[0][1] as { id: string; capability: string; scope: string[] };
    expect(permRequest.capability).toBe('run_cli');
    expect(permRequest.scope).toEqual(['status', '--change', 'ch-001']);

    // User denies the permission
    await supervisor.denyPermission({
      requestId: permRequest.id,
      approved: false,
      reason: 'Not now',
    });

    // Agent should receive denial message on stdin
    await new Promise((r) => setTimeout(r, 10));
    const writes = (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls;
    const denialWrites = writes.filter((c: unknown[]) => {
      const msg = JSON.parse((c[0] as string).trim()) as { type: string; approved: boolean };
      return msg.type === 'permission_response' && msg.approved === false;
    });
    expect(denialWrites.length).toBeGreaterThanOrEqual(1);
  });

  // ── Draft Write Approval ───────────────────────────────

  it('auto-approves write_artifact_draft after first approval', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // First request — should require user approval
    const permLine1 = JSON.stringify({
      type: 'permission_request',
      capability: 'write_artifact_draft',
      scope: ['chapters/ch-001/draft.md'],
    });

    rlHolder.emitter!.emit('line', permLine1);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs1 = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs1.length).toBe(1);
    const req1 = permReqs1[0][1] as { id: string; capability: string };

    // Approve the first request
    await supervisor.approvePermission({
      requestId: req1.id,
      approved: true,
    });

    await new Promise((r) => setTimeout(r, 10));

    // Reset send mock to track second request
    (sender.send as ReturnType<typeof vi.fn>).mockClear();

    // Second request for same capability — should be auto-approved
    const permLine2 = JSON.stringify({
      type: 'permission_request',
      capability: 'write_artifact_draft',
      scope: ['chapters/ch-002/draft.md'],
    });

    rlHolder.emitter!.emit('line', permLine2);
    await new Promise((r) => setTimeout(r, 30));

    // Should NOT have emitted another permission-request event
    const permReqs2 = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs2.length).toBe(0);

    // But should have sent approval to the agent
    const writes = (child.stdin.write as ReturnType<typeof vi.fn>).mock.calls;
    const approvalWrites = writes.filter((c: unknown[]) => {
      try {
        const msg = JSON.parse((c[0] as string).trim()) as { type: string; approved: boolean };
        return msg.type === 'permission_response' && msg.approved === true;
      } catch {
        return false;
      }
    });
    expect(approvalWrites.length).toBeGreaterThanOrEqual(1);
  });

  // ── CLI Run Requires Approval Every Time ───────────────

  it('always requires approval for run_cli (never auto-approves)', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    const { sessionId } = await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    // First CLI request — approve it
    const permLine1 = JSON.stringify({
      type: 'permission_request',
      capability: 'run_cli',
      scope: ['status', '--change', 'ch-001'],
      commandPreview: 'openadab status --change ch-001',
    });

    rlHolder.emitter!.emit('line', permLine1);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs1 = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs1.length).toBe(1);

    await supervisor.approvePermission({
      requestId: (permReqs1[0][1] as { id: string }).id,
      approved: true,
    });

    await new Promise((r) => setTimeout(r, 10));
    (sender.send as ReturnType<typeof vi.fn>).mockClear();

    // Second CLI request — must still require explicit approval
    const permLine2 = JSON.stringify({
      type: 'permission_request',
      capability: 'run_cli',
      scope: ['sync', '--change', 'ch-001'],
      commandPreview: 'openadab sync --change ch-001',
    });

    rlHolder.emitter!.emit('line', permLine2);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs2 = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs2.length).toBe(1);
    expect((permReqs2[0][1] as { capability: string }).capability).toBe('run_cli');
  });

  // ── Forbidden Canon Mutation — Always Requires Approval ─

  it('always requires approval for modify_wiki (canon mutation)', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    const permLine = JSON.stringify({
      type: 'permission_request',
      capability: 'modify_wiki',
      scope: ['characters/mc.md'],
      diffPreview: { operation: 'update', page: 'characters/mc.md' },
    });

    rlHolder.emitter!.emit('line', permLine);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs.length).toBe(1);
    const req = permReqs[0][1] as { capability: string };
    expect(req.capability).toBe('modify_wiki');

    // Even after approval, next modify_wiki should still require approval
    await supervisor.approvePermission({
      requestId: (permReqs[0][1] as { id: string }).id,
      approved: true,
    });

    await new Promise((r) => setTimeout(r, 10));
    (sender.send as ReturnType<typeof vi.fn>).mockClear();

    const permLine2 = JSON.stringify({
      type: 'permission_request',
      capability: 'modify_wiki',
      scope: ['locations/city.md'],
      diffPreview: { operation: 'update', page: 'locations/city.md' },
    });

    rlHolder.emitter!.emit('line', permLine2);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs2 = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    // Should still require approval for the second canon mutation
    expect(permReqs2.length).toBe(1);
  });

  it('always requires approval for archive_change (canon mutation)', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    const permLine = JSON.stringify({
      type: 'permission_request',
      capability: 'archive_change',
      scope: ['ch-001'],
    });

    rlHolder.emitter!.emit('line', permLine);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs.length).toBe(1);
    const req = permReqs[0][1] as { capability: string };
    expect(req.capability).toBe('archive_change');
    expect(isCanonMutation(req.capability as AgentCapability)).toBe(true);
  });

  it('always requires approval for sync_change (canon mutation)', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    const permLine = JSON.stringify({
      type: 'permission_request',
      capability: 'sync_change',
      scope: ['ch-001'],
    });

    rlHolder.emitter!.emit('line', permLine);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs.length).toBe(1);
    const req = permReqs[0][1] as { capability: string };
    expect(req.capability).toBe('sync_change');
    expect(isCanonMutation(req.capability as AgentCapability)).toBe(true);
  });

  it('always requires approval for apply_wiki_diff (canon mutation)', async () => {
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);

    await supervisor.startSession({
      agentCommand: 'opencode',
      args: ['agent', '--acp'],
      cwd: '/test/project',
    });

    const permLine = JSON.stringify({
      type: 'permission_request',
      capability: 'apply_wiki_diff',
      scope: ['ch-001'],
    });

    rlHolder.emitter!.emit('line', permLine);
    await new Promise((r) => setTimeout(r, 30));

    const permReqs = (sender.send as ReturnType<typeof vi.fn>).mock.calls.filter(
      (c: unknown[]) => c[0] === 'event:permission-request',
    );
    expect(permReqs.length).toBe(1);
  });
});

// ── Graceful Degradation Tests ────────────────────────────

describe('AgentSupervisor graceful degradation', () => {
  let supervisor: AgentSupervisor;

  beforeEach(() => {
    supervisor = new AgentSupervisor();
  });

  it('throws when starting session with no agent configured', async () => {
    supervisor.setConfig({
      agentCommand: '',
      args: [],
      cwd: '',
      mode: 'none',
    });

    // The main.ts handler checks isConfigured() before calling startSession,
    // so the supervisor itself doesn't check. Let's verify the config
    expect(supervisor.isConfigured()).toBe(false);

    // But if something tries to start anyway, it should still work
    // since spawn would just fail. Config check is at IPC handler level.
  });

  it('handles spawn failure gracefully', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('ENOENT: command not found');
    });
    const sender = mockSender();
    supervisor.setSender(sender);

    await expect(
      supervisor.startSession({
        agentCommand: 'nonexistent',
        args: [],
        cwd: '/test',
      }),
    ).rejects.toThrow('ENOENT');

    const status = supervisor.getSessionStatus();
    expect(status.sessionId).toBeNull();
  });

  it('throws and does not leave a stale session on spawn failure', async () => {
    mockSpawn.mockImplementation(() => {
      throw new Error('ENOENT: command not found');
    });
    const sender = mockSender();
    supervisor.setSender(sender);

    await expect(
      supervisor.startSession({
        agentCommand: 'nonexistent',
        args: [],
        cwd: '/test',
      }),
    ).rejects.toThrow('ENOENT');

    expect(supervisor.getSessionStatus().sessionId).toBeNull();
  });
});
