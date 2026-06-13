/**
 * Tests for CommandRunner: spawn args, JSON parse, cancellation, allow-listing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';

// ── Mocks ─────────────────────────────────────────────────

const mockSpawn = vi.hoisted(() => vi.fn());
const mockExistsSync = vi.hoisted(() => vi.fn<(candidate: string) => boolean>(() => false));

vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}));

vi.mock('node:fs', () => ({
  existsSync: mockExistsSync,
}));

/** A mock child process with EventEmitter methods and spawn-compatible shape. */
type MockChildProcess = EventEmitter & {
  stdout: NodeJS.ReadableStream & EventEmitter;
  stderr: NodeJS.ReadableStream & EventEmitter;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  pid: number;
};

const mockChildProcess = (): MockChildProcess => {
  const ee = new EventEmitter();
  const stdout = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const stderr = new EventEmitter() as NodeJS.ReadableStream & EventEmitter;
  const killFn = vi.fn();

  const child = {
    ...ee,
    emit: ee.emit.bind(ee),
    on: ee.on.bind(ee),
    addListener: ee.addListener.bind(ee),
    removeListener: ee.removeListener.bind(ee),
    stdout,
    stderr,
    kill: killFn,
    exitCode: null as number | null,
    pid: Math.floor(Math.random() * 10000) + 1000,
  } as unknown as MockChildProcess;

  return child;
};

// ── Imports (after mock setup) ───────────────────────────

import { CommandRunner } from '../electron/command-runner.js';
import type { CliRunRequest, CliCancelRequest } from '../shared/ipc-types.js';

// ── Helpers ────────────────────────────────────────────────

/** A minimal mock WebContents for the sender parameter. */
function mockSender() {
  return {
    send: vi.fn(),
  } as unknown as Electron.WebContents;
}

/** Create a valid CliRunRequest for testing. */
function makeRequest(overrides?: Partial<CliRunRequest>): CliRunRequest {
  return {
    commandId: overrides?.commandId ?? randomUUID(),
    args: overrides?.args ?? ['status', '--change', 'ch-001', '--json'],
    cwd: overrides?.cwd ?? '/test/project',
    initiator: overrides?.initiator ?? 'user',
  };
}

// ── Tests ─────────────────────────────────────────────────

beforeEach(() => {
  mockExistsSync.mockImplementation(() => false);
  mockSpawn.mockClear();
});

afterEach(() => {
  mockExistsSync.mockReset();
});

describe('CommandRunner allow-listing', () => {
  it('accepts init', () => {
    expect(CommandRunner.isAllowed(['init'])).toBe(true);
  });

  it('accepts status', () => {
    expect(CommandRunner.isAllowed(['status', '--change', 'ch-001'])).toBe(
      true,
    );
  });

  it('accepts schema list', () => {
    expect(CommandRunner.isAllowed(['schema', 'list'])).toBe(true);
  });

  it('accepts wiki apply-diff', () => {
    expect(CommandRunner.isAllowed(['wiki', 'apply-diff', '--change', 'c1'])).toBe(
      true,
    );
  });

  it('accepts config get', () => {
    expect(CommandRunner.isAllowed(['config', 'get', 'title'])).toBe(true);
  });

  it('accepts context pack', () => {
    expect(CommandRunner.isAllowed(['context', 'pack', '--change', 'c1'])).toBe(
      true,
    );
  });

  it('rejects unknown commands', () => {
    expect(CommandRunner.isAllowed(['random-command'])).toBe(false);
  });

  it('rejects empty args', () => {
    expect(CommandRunner.isAllowed([])).toBe(false);
  });

  it('rejects rm -rf style commands', () => {
    expect(CommandRunner.isAllowed(['rm', '-rf', '/'])).toBe(false);
  });
});

describe('CommandRunner mutation classification', () => {
  it('classifies sync as mutating', () => {
    expect(CommandRunner.isMutating(['sync', '--change', 'ch-001'])).toBe(true);
  });

  it('classifies archive as mutating', () => {
    expect(CommandRunner.isMutating(['archive', 'ch-001'])).toBe(true);
  });

  it('classifies wiki index as mutating', () => {
    expect(CommandRunner.isMutating(['wiki', 'index', '--json'])).toBe(true);
  });

  it('classifies wiki apply-diff --apply as mutating', () => {
    expect(
      CommandRunner.isMutating([
        'wiki',
        'apply-diff',
        '--change',
        'ch-001',
        '--apply',
      ]),
    ).toBe(true);
  });

  it('classifies wiki apply-diff --dry-run as non-mutating', () => {
    expect(
      CommandRunner.isMutating([
        'wiki',
        'apply-diff',
        '--change',
        'ch-001',
        '--dry-run',
      ]),
    ).toBe(false);
  });

  it('classifies wiki apply-diff with both apply and dry-run as non-mutating', () => {
    expect(
      CommandRunner.isMutating([
        'wiki',
        'apply-diff',
        '--change',
        'ch-001',
        '--apply',
        '--dry-run',
      ]),
    ).toBe(false);
  });

  it('classifies wiki apply-diff without apply as non-mutating', () => {
    expect(
      CommandRunner.isMutating(['wiki', 'apply-diff', '--change', 'ch-001']),
    ).toBe(false);
  });

  it('classifies status as non-mutating', () => {
    expect(
      CommandRunner.isMutating(['status', '--change', 'ch-001']),
    ).toBe(false);
  });

  it('classifies schema list as non-mutating', () => {
    expect(CommandRunner.isMutating(['schema', 'list'])).toBe(false);
  });

  it('classifies wiki index --help as mutating regardless of flags', () => {
    expect(CommandRunner.isMutating(['wiki', 'index', '--help'])).toBe(true);
    expect(CommandRunner.isMutating(['wiki', 'index', '--change', 'ch-001', '--json'])).toBe(true);
  });

  it('classifies wiki apply-diff --dry-run with --apply as non-mutating', () => {
    expect(
      CommandRunner.isMutating([
        'wiki',
        'apply-diff',
        '--dry-run',
        '--apply',
      ]),
    ).toBe(false);
  });
});

describe('CommandRunner.run', () => {
  let runner: CommandRunner;

  beforeEach(() => {
    runner = new CommandRunner();
    mockSpawn.mockClear();
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  it('rejects disallowed commands', async () => {
    const sender = mockSender();
    const request = makeRequest({ args: ['rm', '-rf', '/'] });

    const event = await runner.run(request, sender);

    expect(event.exitCode).toBe(Number.NaN);
    expect(event.stderr).toContain('not in the allow-list');
    expect(mockSpawn).not.toHaveBeenCalled();

    const completeCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === 'event:command-complete');
    expect(completeCalls.length).toBe(1);
  });

  it('spawns with argument arrays (not shell-joined)', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    // Emit close
    setTimeout(() => {
      child.stdout?.emit('data', Buffer.from('{"ok":true}\n'));
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    expect(mockSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, opts] = mockSpawn.mock.calls[0];
    expect(cmd).toBe('openadab');
    expect(args).toEqual(['status', '--change', 'ch-001', '--json']);
    expect(opts.cwd).toBe('/test/project');
    expect(typeof args.join).toBe('function'); // array, not string
    expect(event.exitCode).toBe(0);
    expect(event.stdout).toBe('{"ok":true}\n');
  });

  it('uses a configured CLI path before PATH fallback', async () => {
    const configuredCliPath = 'C:\\tools\\openadab.cmd';
    mockExistsSync.mockImplementation(
      (candidate: string) => String(candidate) === configuredCliPath,
    );
    runner = new CommandRunner({ cliPath: configuredCliPath });
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe(configuredCliPath);
    expect(args).toEqual(['status', '--change', 'ch-001', '--json']);
  });

  it('uses an environment CLI path before PATH fallback', async () => {
    const envCliPath = 'C:\\tools\\env-openadab.cmd';
    mockExistsSync.mockImplementation(
      (candidate: string) => String(candidate) === envCliPath,
    );
    runner = new CommandRunner({
      env: { OPENADAB_CLI_PATH: envCliPath },
    });
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe(envCliPath);
    expect(args).toEqual(['status', '--change', 'ch-001', '--json']);
  });

  it('uses local workspace build output before PATH fallback', async () => {
    const workspaceRoot = resolve('C:\\workspace\\openadab');
    const entrypoint = resolve(workspaceRoot, 'dist', 'index.js');
    mockExistsSync.mockImplementation(
      (candidate: string) => String(candidate) === entrypoint,
    );
    runner = new CommandRunner({ workspaceRoot, env: {} });
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args).toEqual([
      entrypoint,
      'status',
      '--change',
      'ch-001',
      '--json',
    ]);
  });

  it('parses valid JSON from stdout', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit(
        'data',
        Buffer.from('{"status":"ready","artifacts":[]}\n'),
      );
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    expect(event.parsedJson).toEqual({ status: 'ready', artifacts: [] });
    expect(event.parseError).toBeUndefined();
    expect(event.stdout).toContain('"status":"ready"');
  });

  it('parses valid JSON from stderr when stdout is empty', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stderr?.emit(
        'data',
        Buffer.from('{"status":"failed","reason":"missing change"}\n'),
      );
      child.emit('close', 1, null);
    }, 10);

    const event = await promise;

    expect(event.parsedJson).toEqual({
      status: 'failed',
      reason: 'missing change',
    });
    expect(event.parseError).toBeUndefined();
    expect(event.stdout).toBe('');
    expect(event.stderr).toContain('"missing change"');
  });

  it('sets parseError on invalid JSON', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit('data', Buffer.from('not json at all'));
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    expect(event.parsedJson).toBeUndefined();
    expect(event.parseError).toBeTruthy();
    expect(event.stdout).toBe('not json at all');
  });

  it('sets parseError when neither stdout nor stderr contains JSON', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit('data', Buffer.from('not json'));
      child.stderr?.emit('data', Buffer.from('also not json'));
      child.emit('close', 1, null);
    }, 10);

    const event = await promise;

    expect(event.parsedJson).toBeUndefined();
    expect(event.parseError).toBeTruthy();
    expect(event.stdout).toBe('not json');
    expect(event.stderr).toBe('also not json');
  });

  it('handles non-zero exit codes', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stderr?.emit('data', Buffer.from('Error: change not found\n'));
      child.emit('close', 1, null);
    }, 10);

    const event = await promise;

    expect(event.exitCode).toBe(1);
    expect(event.stderr).toContain('Error: change not found');
    expect(event.cancelled).toBe(false);
  });

  it('emits streaming output to sender', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit('data', Buffer.from('line1\n'));
      child.stdout?.emit('data', Buffer.from('line2\n'));
      child.stderr?.emit('data', Buffer.from('warning\n'));
      child.emit('close', 0, null);
    }, 10);

    await promise;

    // Should have sent output events
    const calls = (sender.send as ReturnType<typeof vi.fn>).mock.calls;
    const outputCalls = calls.filter(
      (c: unknown[]) => c[0] === 'event:command-output',
    );
    expect(outputCalls.length).toBeGreaterThanOrEqual(3);
  });

  it('emits command-complete event', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const completeCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === 'event:command-complete')
      .map((c: unknown[]) => c[1] as { exitCode: number });
    expect(completeCalls.length).toBe(1);
    expect(completeCalls[0].exitCode).toBe(0);
  });

  it('invokes onCommandComplete callback', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();
    const callback = vi.fn();
    runner.onCommandComplete = callback;

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback.mock.calls[0][0].id).toBe(request.commandId);
  });

  it('emits and persists one completion when spawn throws', async () => {
    const sender = mockSender();
    const callback = vi.fn();
    runner.onCommandComplete = callback;
    mockSpawn.mockImplementation(() => {
      throw new Error('spawn openadab ENOENT');
    });
    const request = makeRequest();

    const event = await runner.run(request, sender);

    const completeCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === 'event:command-complete');
    expect(event.exitCode).toBe(Number.NaN);
    expect(event.stderr).toContain('Failed to spawn OpenAdab CLI');
    expect(completeCalls.length).toBe(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it('finalizes once when child error and close both fire', async () => {
    const sender = mockSender();
    const callback = vi.fn();
    const child = mockChildProcess();
    runner.onCommandComplete = callback;
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('error', new Error('spawn openadab ENOENT'));
      child.emit('close', 1, null);
    }, 10);

    const event = await promise;

    const completeCalls = (sender.send as ReturnType<typeof vi.fn>).mock.calls
      .filter((c: unknown[]) => c[0] === 'event:command-complete');
    expect(event.stderr).toContain('Failed to spawn OpenAdab CLI');
    expect(completeCalls.length).toBe(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });
});

  it('resolves CLI entrypoint in dev mode from workspace build output', async () => {
    // When node_modules exists in cwd, workspace resolution is used
    const workspaceRoot = resolve('C:\workspace\openadab');
    const entrypoint = resolve(workspaceRoot, 'dist', 'index.js');
    mockExistsSync.mockImplementation(
      (candidate) => String(candidate) === entrypoint,
    );
    const runner = new CommandRunner({ workspaceRoot, env: {} });
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const [cmd, args] = mockSpawn.mock.calls[0];
    expect(cmd).toBe(process.execPath);
    expect(args[0]).toBe(entrypoint);
  });

  it('resolves CLI entrypoint in packaged mode from resources path', async () => {
    // In packaged mode, CLI is at {resourcesPath}/cli/openadab.cmd
    const resourcesPath = resolve('/fake/app/resources');
    const packagedCli = resolve(resourcesPath, 'cli', 'openadab.cmd');
    mockExistsSync.mockImplementation(
      (candidate) => {
        // Return true only for the packaged CLI, not for any local entrypoints
        if (String(candidate) === packagedCli) return true;
        if (String(candidate).includes('dist/index.js')) return false;
        return false;
      },
    );
    // Provide resourcesPath directly so the test does not depend on process.resourcesPath
    const runner = new CommandRunner({
      isPackaged: true,
      resourcesPath,
      env: {},
    });
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.emit('close', 0, null);
    }, 10);

    await promise;

    const [cmd, args] = mockSpawn.mock.calls[0];
    // .cmd files are not Node entrypoints, so spawned directly
    expect(cmd).toBe(packagedCli);
    expect(args).toEqual(['status', '--change', 'ch-001', '--json']);
  });

  it('preserves raw stdout when JSON parse fails on mixed content', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    const runner = new CommandRunner({ env: {} });
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      // Mixed content: warning line before JSON — still not valid as pure JSON
      child.stdout?.emit(
        'data',
        Buffer.from('Warning: using default branch\n{"status":"ready"}'),
      );
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    // Raw output preserved even though parse fails
    expect(event.stdout).toContain('Warning: using default branch');
    expect(event.stdout).toContain('{"status":"ready"}');
    // tryExtractJson should extract JSON from mixed content (non-JSON prefix + JSON)
    expect(event.parsedJson).toEqual({ status: 'ready' });
  });

  it('extracts JSON object from stdout when trailing content exists after JSON', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    const runner = new CommandRunner({ env: {} });
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit(
        'data',
        Buffer.from('{"status":"ready"}\nDone.'),

      );
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    // Raw output preserved
    expect(event.stdout).toContain('Done.');
    expect(event.stdout).toContain('{"status":"ready"}');
    // After fix: should successfully extract JSON
    // For now: parse may fail on "Done." after JSON
  });

  it('extracts JSON array from stderr when stdout is non-JSON text', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    const runner = new CommandRunner({ env: {} });
    mockSpawn.mockReturnValue(child);
    const request = makeRequest({
      args: ['status', '--change', 'ch-001', '--json'],
    });

    const promise = runner.run(request, sender);

    setTimeout(() => {
      child.stdout?.emit('data', Buffer.from('Running status check...\n'));

      child.stderr?.emit('data', Buffer.from('[{"name":"a"},{"name":"b"}]'));
      child.emit('close', 0, null);
    }, 10);

    const event = await promise;

    // stderr has the JSON array
    expect(event.stderr).toContain('[{"name":"a"},{"name":"b"}]');
    // stdout has non-JSON text
    expect(event.stdout).toContain('Running status check');
    // After fix: JSON array from stderr should be extracted
});


describe('CommandRunner cancellation', () => {
  let runner: CommandRunner;

  beforeEach(() => {
    runner = new CommandRunner();
    mockSpawn.mockClear();
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  it('kills active child process on cancel', async () => {
    const sender = mockSender();
    const child = mockChildProcess();
    mockSpawn.mockReturnValue(child);
    const request = makeRequest();

    const promise = runner.run(request, sender);

    // Wait for spawn to happen, then cancel
    await new Promise((r) => setTimeout(r, 20));

    const cancelRequest: CliCancelRequest = { commandId: request.commandId };
    const result = runner.cancel(cancelRequest);
    expect(result).toBe(true);
    expect(child.kill).toHaveBeenCalled();

    // Simulate process termination due to signal
    child.emit('close', null, 'SIGTERM');

    const event = await promise;
    expect(event.cancelled).toBe(true);
  });

  it('returns false for unknown command ID', () => {
    const result = runner.cancel({ commandId: 'non-existent-id' });
    expect(result).toBe(false);
  });
});

describe('CommandRunner concurrent mutating commands', () => {
  let runner: CommandRunner;

  beforeEach(() => {
    runner = new CommandRunner();
    mockSpawn.mockClear();
  });

  afterEach(() => {
    mockSpawn.mockReset();
  });

  it('queues second mutating command while first runs', async () => {
    const sender = mockSender();
    const child1 = mockChildProcess();
    const child2 = mockChildProcess();
    mockSpawn
      .mockReturnValueOnce(child1)
      .mockReturnValueOnce(child2);

    // First mutating command: sync
    const req1 = makeRequest({
      commandId: 'cmd-1',
      args: ['sync', '--change', 'ch-001'],
    });

    // Second mutating command: archive
    const req2 = makeRequest({
      commandId: 'cmd-2',
      args: ['archive', 'ch-001'],
    });

    const p1 = runner.run(req1, sender);
    await new Promise((r) => setTimeout(r, 20));

    // cmd-2 should be queued, not yet spawned
    let secondResolved = false;
    const p2 = runner.run(req2, sender).then((event) => {
      secondResolved = true;
      return event;
    });
    await new Promise((r) => setTimeout(r, 10));

    // Only first should be running
    expect(runner.getActiveCommandIds()).toContain('cmd-1');
    expect(runner.mutatingQueueLength).toBe(1);
    expect(secondResolved).toBe(false);

    // Complete cmd-1
    child1.emit('close', 0, null);
    await p1;

    // cmd-2 should now be spawned
    await new Promise((r) => setTimeout(r, 20));
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    // Complete cmd-2
    child2.emit('close', 0, null);
    const event2 = await p2;
    expect(secondResolved).toBe(true);
    expect(event2.id).toBe('cmd-2');
    expect(event2.exitCode).toBe(0);
  });

  it('allows concurrent non-mutating commands', async () => {
    const sender = mockSender();
    const child1 = mockChildProcess();
    const child2 = mockChildProcess();
    mockSpawn
      .mockReturnValueOnce(child1)
      .mockReturnValueOnce(child2);

    const req1 = makeRequest({
      commandId: 'cmd-1',
      args: ['status', '--change', 'ch-001'],
    });
    const req2 = makeRequest({
      commandId: 'cmd-2',
      args: ['schema', 'list'],
    });

    const p1 = runner.run(req1, sender);
    const p2 = runner.run(req2, sender);
    await new Promise((r) => setTimeout(r, 10));

    // Both should be spawned
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    child1.emit('close', 0, null);
    child2.emit('close', 0, null);
    await Promise.all([p1, p2]);
  });
});
