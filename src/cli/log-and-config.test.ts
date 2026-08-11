/**
 * Unit tests for `log --limit` parser validation and `config set --json`
 * flag handling.
 *
 * Covers:
 *  - L1: `log --limit` custom parser must reject 0, negative integers, and
 *    non-integer values up front (commander usage error, exitCode !== 0)
 *    instead of silently falling back to "no limit".
 *  - L2: `config set <path> <value>` stores the value as a raw string by
 *    default. The new `--json` flag is the only way to opt into JSON
 *    parsing; invalid JSON under `--json` must surface as an AdabError.
 */
import { mkdtempSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import YAML from 'yaml';

import { createMinimalProject } from '../../tests/integration/fixture.js';
import { LogReader } from '../modules/log/index.js';
import { ConfigLoader } from '../modules/project-config/index.js';


import { createProgram } from './index.js';

interface CapturedRun {
  exitCode: number | null;
  stderrText: string;
  readAllCalled: boolean;
}

async function runCliInDir(
  projectRoot: string,
  args: string[],
  options: { spyLogReader?: boolean } = {},
): Promise<CapturedRun> {
  const originalCwd = process.cwd();
  process.chdir(projectRoot);

  const stderrLines: string[] = [];
  const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
    stderrLines.push(String(msg));
  });
  const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
    stderrLines.push(String(chunk));
    return true;
  }));

  let capturedExitCode: number | null = null;
  const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
    if (typeof code === 'number') {
      capturedExitCode = code;
    } else if (typeof code === 'string') {
      capturedExitCode = Number(code);
    } else {
      capturedExitCode = 1;
    }
    throw new Error(`__test_exit:${String(capturedExitCode)}`);
  }));

  const originalExitCode = process.exitCode;
  process.exitCode = undefined;

  let readAllCalled = false;
  let readAllSpy: ReturnType<typeof vi.spyOn> | null = null;
  if (options.spyLogReader === true) {
    readAllSpy = vi.spyOn(LogReader.prototype, 'readAll');
    readAllSpy.mockImplementation(async function mockReadAll(this: LogReader) {
      readAllCalled = true;
      return [];
    });
  }

  try {
    const program = createProgram();
    try {
      await program.parseAsync(['node', 'openadab', ...args]);
    } catch (err) {
      // `__test_exit:*` is the synthetic error thrown by our `process.exit`
      // mock — it is the normal "commander decided to exit" path.
      // Any OTHER thrown error means commander (or a custom option parser)
      // rejected the input and surfaced an error before exiting; that is
      // also a non-zero exit, so record it as such and append the message
      // to the captured stderr.
      if (!(err instanceof Error) || !err.message.startsWith('__test_exit:')) {
        capturedExitCode = capturedExitCode ?? 1;
        if (err instanceof Error) {
          stderrLines.push(err.message);
        } else {
          stderrLines.push(String(err));
        }
      }
    }
    if (capturedExitCode === null && process.exitCode !== undefined && process.exitCode !== originalExitCode) {
      capturedExitCode = process.exitCode;
    }
  } finally {
    process.chdir(originalCwd);
    logSpy.mockRestore();
    errorSpy.mockRestore();
    stderrWriteSpy.mockRestore();
    exitSpy.mockRestore();
    readAllSpy?.mockRestore();
    process.exitCode = originalExitCode;
  }

  return {
    exitCode: capturedExitCode,
    stderrText: stderrLines.join('\n'),
    readAllCalled,
  };
}

async function readPersistedConfig(projectRoot: string): Promise<Record<string, unknown>> {
  const raw = await readFile(join(projectRoot, 'adab', 'config.yaml'), 'utf-8');
  return YAML.parse(raw) as Record<string, unknown>;
}

describe('log --limit parser (L1: positive integer enforcement)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createMinimalProject(await mkdtemp(join(tmpdir(), 'openadab-log-limit-')));
  });

  it('rejects --limit 0 with a non-zero exit code and a positive-integer message', async () => {
    const { exitCode, stderrText, readAllCalled } = await runCliInDir(
      projectRoot,
      ['log', '--limit', '0'],
      { spyLogReader: true },
    );

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(readAllCalled).toBe(false);
    expect(stderrText.toLowerCase()).toMatch(/limit|positive|integer/);
  });

  it('rejects --limit -5 with a non-zero exit code (no silent fallback)', async () => {
    const { exitCode, stderrText, readAllCalled } = await runCliInDir(
      projectRoot,
      ['log', '--limit', '-5'],
      { spyLogReader: true },
    );

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(readAllCalled).toBe(false);
    expect(stderrText.toLowerCase()).toMatch(/limit|positive|integer/);
  });

  it('rejects --limit abc (regression: non-numeric still rejected)', async () => {
    const { exitCode, stderrText, readAllCalled } = await runCliInDir(
      projectRoot,
      ['log', '--limit', 'abc'],
      { spyLogReader: true },
    );

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(readAllCalled).toBe(false);
    expect(stderrText.toLowerCase()).toMatch(/limit|positive|integer/);
  });
});

describe('config set value handling (L2: raw by default, --json opt-in)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createMinimalProject(await mkdtemp(join(tmpdir(), 'openadab-config-set-')));
  });

  it('stores the value as a raw string when --json is not passed', async () => {
    const { exitCode } = await runCliInDir(projectRoot, [
      'config',
      'set',
      'project.title',
      'My Title',
    ]);

    expect(exitCode === null || exitCode === 0).toBe(true);
    const persisted = await readPersistedConfig(projectRoot);
    const project = persisted.project as Record<string, unknown>;
    expect(project.title).toBe('My Title');
    expect(typeof project.title).toBe('string');
  });

  it('parses value as JSON when --json is passed (strips outer quotes)', async () => {
    const { exitCode } = await runCliInDir(projectRoot, [
      'config',
      'set',
      'project.title',
      '"My Title"',
      '--json',
    ]);

    expect(exitCode === null || exitCode === 0).toBe(true);
    const persisted = await readPersistedConfig(projectRoot);
    const project = persisted.project as Record<string, unknown>;
    expect(project.title).toBe('My Title');
    expect(typeof project.title).toBe('string');
  });

  it('rejects malformed JSON with --json via AdabError (non-zero exit code)', async () => {
    const { exitCode, stderrText } = await runCliInDir(projectRoot, [
      'config',
      'set',
      'project.title',
      'not json {',
      '--json',
    ]);

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText.toLowerCase()).toMatch(/invalid json|config_invalid_value|error/);
  });

  it('parses numeric values as numbers when --json is passed (regression)', async () => {
    const { exitCode } = await runCliInDir(projectRoot, [
      'config',
      'set',
      'context.maxTokens',
      '18000',
      '--json',
    ]);

    expect(exitCode === null || exitCode === 0).toBe(true);
    const persisted = await readPersistedConfig(projectRoot);
    const context = persisted.context as Record<string, unknown>;
    expect(context.maxTokens).toBe(18000);
    expect(typeof context.maxTokens).toBe('number');
  });
});

describe('config get round-trip (L2 integration smoke)', () => {
  let projectRoot: string;
  let loader: ConfigLoader;

  beforeEach(async () => {
    projectRoot = await createMinimalProject(await mkdtemp(join(tmpdir(), 'openadab-config-get-')));
    loader = new ConfigLoader(projectRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('raw-set value reads back unchanged', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'project.title', 'My Title']);
    const config = await loader.load();
    expect(config.project.title).toBe('My Title');
  });

  it('--json set with quoted string reads back with quotes stripped', async () => {
    await runCliInDir(projectRoot, [
      'config',
      'set',
      'project.title',
      '"My Title"',
      '--json',
    ]);
    const config = await loader.load();
    expect(config.project.title).toBe('My Title');
  });
});

describe('config get missing key (regression: no silent `undefined` output)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createMinimalProject(await mkdtemp(join(tmpdir(), 'openadab-config-get-missing-')));
  });

  it('exits non-zero with a usage error in human mode when the key is missing', async () => {
    const { exitCode, stderrText } = await runCliInDir(projectRoot, ['config', 'get', 'project.nonexistent']);

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText).toContain('Invalid config path: project.nonexistent');
  });

  it('exits non-zero with a structured error envelope in --json mode when the key is missing', async () => {
    const { exitCode, stderrText } = await runCliInDir(projectRoot, ['config', 'get', 'project.nonexistent', '--json']);

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText).toContain('"error": true');
    expect(stderrText).toContain('USAGE_ERROR');
    expect(stderrText).toContain('Invalid config path: project.nonexistent');
  });

  it('still prints an existing value successfully (happy-path regression)', async () => {
    const { exitCode } = await runCliInDir(projectRoot, ['config', 'get', 'project.title']);

    expect(exitCode === null || exitCode === 0).toBe(true);
  });
});

// =============================================================================
// S2: `config set` must redact sensitive values before writing to adab/log.md
// =============================================================================
describe('config set redacts secrets in adab/log.md (S2)', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await createMinimalProject(await mkdtemp(join(tmpdir(), 'openadab-config-redact-')));
  });

  async function readLogRaw(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    return readFile(join(projectRoot, 'adab', 'log.md'), 'utf-8');
  }

  it('redacts secrets.apiKey to *** in adab/log.md', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'secrets.apiKey', 'sk-supersecret-xxx']);
    const raw = await readLogRaw();
    expect(raw).toContain('secrets.apiKey');
    expect(raw).toContain('***');
    expect(raw).not.toContain('sk-supersecret-xxx');
  });

  it('redacts api.token to *** in adab/log.md', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'api.token', 'bearer-tok-12345']);
    const raw = await readLogRaw();
    expect(raw).toContain('api.token');
    expect(raw).toContain('***');
    expect(raw).not.toContain('bearer-tok-12345');
  });

  it('does NOT redact a non-sensitive value (project.pov remains visible)', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'project.pov', 'first-person']);
    const raw = await readLogRaw();
    expect(raw).toContain('first-person');
  });

  it('redacts deeply nested secret paths (a.b.secrets.password)', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'a.b.secrets.password', 'p4ssw0rd!']);
    const raw = await readLogRaw();
    expect(raw).toContain('***');
    expect(raw).not.toContain('p4ssw0rd!');
  });

  it('redacts object value stored under a sensitive path (json --json)', async () => {
    await runCliInDir(projectRoot, [
      'config',
      'set',
      'secrets.openai',
      JSON.stringify({ apiKey: 'sk-xyz', token: 'tk-abc' }),
      '--json',
    ]);
    const raw = await readLogRaw();
    expect(raw).toContain('***');
    expect(raw).not.toContain('sk-xyz');
    expect(raw).not.toContain('tk-abc');
  });

  it('redacts case-insensitively (Secrets.AWS_TOKEN)', async () => {
    await runCliInDir(projectRoot, ['config', 'set', 'Secrets.AWS_TOKEN', 'aws-secret-value']);
    const raw = await readLogRaw();
    expect(raw).toContain('***');
    expect(raw).not.toContain('aws-secret-value');
  });
});

// =============================================================================
// E2: actions whose config-loading happens outside a try block (status, etc.)
// must route errors through handleError: non-zero exit, structured error
// envelope on stderr in --json mode, no raw stack trace.
// =============================================================================
describe('status without a project config (E2: uncaught action errors)', () => {
  it('exits non-zero with a structured JSON error envelope in --json mode (no raw stack)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-no-config-'));
    const { exitCode, stderrText } = await runCliInDir(root, ['status', '--change', 'ch-001', '--json']);

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText).toContain('"error": true');
    expect(stderrText).toContain('CONFIG_MISSING');
    // A raw stack trace would break the structured envelope convention.
    expect(stderrText).not.toMatch(/^\s+at /m);
  });

  it('exits 1 with a formatted error in human mode (no raw stack)', async () => {
    const root = mkdtempSync(join(tmpdir(), 'openadab-no-config-'));
    const { exitCode, stderrText } = await runCliInDir(root, ['status', '--change', 'ch-001']);

    expect(exitCode).not.toBeNull();
    expect(exitCode).not.toBe(0);
    expect(stderrText.toLowerCase()).toContain('config_missing');
    expect(stderrText).not.toMatch(/^\s+at /m);
  });
});
