/**
 * CLI command runner for the Electron main process.
 *
 * Spawns `openadab` as a child process using `child_process.spawn()`
 * with argument arrays (never shell-joined), captures stdout/stderr,
 * parses JSON output, enforces an allow-list, and supports cancellation.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WebContents } from 'electron';
import type {
  CliRunRequest,
  CliCancelRequest,
  CommandEvent,
  CommandOutputEvent,
  TranscriptGetEventsRequest,
} from '../shared/ipc-types.js';

/** Allowed CLI subcommands (first-level argument). */
const ALLOWED_COMMANDS = [
  ['init'],
  ['update'],
  ['new'],
  ['status'],
  ['instructions'],
  ['context', 'pack'],
  ['validate'],
  ['sync'],
  ['archive'],
  ['schema', 'list'],
  ['schema', 'show'],
  ['schema', 'validate'],
  ['schema', 'fork'],
  ['wiki', 'lint'],
  ['wiki', 'index'],
  ['wiki', 'diff'],
  ['wiki', 'apply-diff'],
  ['config', 'get'],
  ['config', 'set'],
  ['log'],
] as const;

/** Mutating subcommands (subject to queue restrictions). */
const MUTATING_COMMANDS = new Set<string>([
  'init',
  'update',
  'new',
  'sync',
  'archive',
  'schema fork',
  'wiki index',
  'config set',
]);

/** Subcommands that support `--json` flag. */
const JSON_COMMANDS = new Set<string>([
  'init',
  'update',
  'new',
  'status',
  'instructions',
  'context pack',
  'validate',
  'sync',
  'archive',
  'schema list',
  'schema show',
  'schema validate',
  'schema fork',
  'wiki lint',
  'wiki index',
  'wiki diff',
  'wiki apply-diff',
  'config get',
  'config set',
  'log',
]);

/**
 * Configures how the command runner resolves the OpenAdab CLI entrypoint.
 *
 * `cliPath` represents an explicit application setting and takes precedence
 * over environment discovery. `env` lets tests or embedders provide a stable
 * environment snapshot without mutating `process.env`. `workspaceRoot` points
 * at a local OpenAdab workspace whose compiled `dist/index.js` can be spawned
 * before falling back to a globally installed `openadab` command.
 */
export interface CommandRunnerOptions {
  cliPath?: string;
  env?: NodeJS.ProcessEnv;
  workspaceRoot?: string;
}

/**
 * Describes a resolved CLI process invocation before request args are appended.
 *
 * `command` is the executable passed to `spawn`. `argsPrefix` contains any
 * fixed leading arguments needed to reach the CLI entrypoint, such as a local
 * JavaScript file executed via `process.execPath`. `source` records the
 * resolution tier for diagnostics while `displayPath` preserves the human
 * readable entrypoint that was selected.
 */
interface ResolvedCliCommand {
  command: string;
  argsPrefix: string[];
  source: 'configured' | 'environment' | 'workspace' | 'path';
  displayPath: string;
}

/**
 * Collects structured JSON parse output for a completed command.
 *
 * A defined `parsedJson` means either stdout or stderr contained a complete
 * JSON document. A defined `parseError` means the command requested JSON but
 * neither stream could be parsed as a complete JSON document.
 */
interface ParsedCommandJson {
  parsedJson?: unknown;
  parseError?: string;
}

const CURRENT_MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const CLI_PATH_ENV_NAMES = ['OPENADAB_CLI_PATH', 'OPENADAB_CLI'] as const;
const PATH_FALLBACK_COMMAND = 'openadab';

/**
 * Resolves the OpenAdab CLI command using explicit configuration, local build
 * output, then PATH fallback.
 */
function resolveOpenAdabCli(options: CommandRunnerOptions): ResolvedCliCommand {
  const configuredCliPath = options.cliPath?.trim();
  if (configuredCliPath) {
    return toResolvedCliCommand(configuredCliPath, 'configured');
  }

  const environmentCliPath = CLI_PATH_ENV_NAMES
    .map((name) => options.env?.[name]?.trim())
    .find((candidate): candidate is string => Boolean(candidate));
  if (environmentCliPath) {
    return toResolvedCliCommand(environmentCliPath, 'environment');
  }

  const localEntrypoint = findLocalCliEntrypoint(options.workspaceRoot);
  if (localEntrypoint) {
    return toResolvedCliCommand(localEntrypoint, 'workspace');
  }

  return {
    command: PATH_FALLBACK_COMMAND,
    argsPrefix: [],
    source: 'path',
    displayPath: PATH_FALLBACK_COMMAND,
  };
}

/**
 * Builds a spawn-safe command and argument array for a resolved CLI command.
 */
function buildSpawnInvocation(
  resolved: ResolvedCliCommand,
  requestArgs: readonly string[],
): { command: string; args: string[] } {
  return {
    command: resolved.command,
    args: [...resolved.argsPrefix, ...requestArgs],
  };
}

/**
 * Parses command JSON from stdout or stderr when the request asked for JSON.
 */
function parseCommandJson(
  args: readonly string[],
  stdout: string,
  stderr: string,
): ParsedCommandJson {
  if (!JSON_COMMANDS.has(extractSubcommand(args)) || !hasFlag(args, '--json')) {
    return {};
  }

  const attempts = [
    { stream: 'stdout' as const, value: stdout },
    { stream: 'stderr' as const, value: stderr },
  ].filter((candidate) => candidate.value.trim().length > 0);

  for (const attempt of attempts) {
    try {
      return { parsedJson: JSON.parse(attempt.value.trim()) as unknown };
    } catch {
      continue;
    }
  }

  if (attempts.length === 0) {
    return {
      parseError:
        'Command requested JSON, but stdout and stderr were both empty.',
    };
  }

  const errors = attempts.map((attempt) => {
    try {
      JSON.parse(attempt.value.trim()) as unknown;
      return `${attempt.stream}: parsed successfully`;
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Unknown JSON parse error';
      return `${attempt.stream}: ${message}`;
    }
  });

  return {
    parseError: `Command requested JSON, but no stream contained valid JSON. ${errors.join('; ')}`,
  };
}

/**
 * Checks whether a CLI flag is present as an exact argument.
 */
function hasFlag(args: readonly string[], flag: string): boolean {
  return args.includes(flag);
}

/**
 * Converts a discovered CLI entrypoint into a concrete spawn invocation.
 *
 * JavaScript entrypoints are executed with the current Node executable so
 * Windows and POSIX builds do not rely on executable bits or shebang handling.
 * Native launchers and PATH command names are spawned directly.
 */
function toResolvedCliCommand(
  entrypoint: string,
  source: ResolvedCliCommand['source'],
): ResolvedCliCommand {
  if (isNodeEntrypoint(entrypoint)) {
    return {
      command: process.execPath,
      argsPrefix: [entrypoint],
      source,
      displayPath: entrypoint,
    };
  }

  return {
    command: entrypoint,
    argsPrefix: [],
    source,
    displayPath: entrypoint,
  };
}

/**
 * Returns whether an entrypoint is a JavaScript file that Node should run.
 */
function isNodeEntrypoint(entrypoint: string): boolean {
  return ['.js', '.mjs', '.cjs'].includes(extname(entrypoint).toLowerCase());
}

/**
 * Finds a compiled OpenAdab CLI entrypoint in likely local workspace roots.
 *
 * The source tree and compiled Electron tree sit at different depths, so the
 * candidate roots include both module-relative forms plus the current process
 * directory. The first existing `dist/index.js` wins.
 */
function findLocalCliEntrypoint(workspaceRoot?: string): string | undefined {
  const candidateRoots = [
    workspaceRoot,
    resolve(CURRENT_MODULE_DIR, '..', '..', '..'),
    resolve(CURRENT_MODULE_DIR, '..', '..', '..', '..'),
    process.cwd(),
    resolve(process.cwd(), '..', '..'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  const seen = new Set<string>();
  for (const root of candidateRoots) {
    const entrypoint = resolve(root, 'dist', 'index.js');
    if (seen.has(entrypoint)) continue;
    seen.add(entrypoint);
    if (existsSync(entrypoint)) {
      return entrypoint;
    }
  }

  return undefined;
}

/**
 * Builds a short diagnostic label for a resolved CLI command.
 */
function describeResolvedCli(resolved: ResolvedCliCommand): string {
  return `${resolved.displayPath} from ${resolved.source}`;
}

/**
 * Appends a diagnostic line to stderr without discarding captured stderr.
 */
function appendStderr(stderr: string, line: string): string {
  return stderr.length > 0 ? `${stderr}\n${line}` : line;
}

/**
 * Returns the normalized subcommand prefix from the args array.
 *
 * "schema list --json" → "schema list"
 * "wiki apply-diff --change ch-001" → "wiki apply-diff"
 */
function extractSubcommand(args: readonly string[]): string {
  if (args.length === 0) return '';
  const first = args[0];
  // Multi-word subcommands where second arg is a sub-subcommand
  if (
    ['context', 'schema', 'wiki', 'config'].includes(first) &&
    args.length >= 2 &&
    !args[1].startsWith('-')
  ) {
    return `${first} ${args[1]}`;
  }
  return first;
}

/**
 * Checks whether the first N args match an allowed command signature.
 */
function isAllowedCommand(args: readonly string[]): boolean {
  const subcommand = extractSubcommand(args);
  if (subcommand === '') return false;
  return ALLOWED_COMMANDS.some((allowed) => allowed.join(' ') === subcommand);
}

/**
 * Checks whether the command is classified as mutating.
 */
function isMutatingCommand(args: readonly string[]): boolean {
  const subcommand = extractSubcommand(args);
  if (subcommand === 'wiki apply-diff') {
    return hasFlag(args, '--apply') && !hasFlag(args, '--dry-run');
  }
  return MUTATING_COMMANDS.has(subcommand);
}

interface QueuedMutatingCommand {
  request: CliRunRequest;
  sender: WebContents;
  resolve: (event: CommandEvent) => void;
}

/**
 * Manages `openadab` child processes for the desktop app.
 *
 * Only one instance per application; tracks active commands in a Map,
 * emits streaming output events to the renderer, and persists results
 * via a transcript store callback.
 */
export class CommandRunner {
  /** Currently running child processes, keyed by command ID. */
  private activeCommands = new Map<string, ChildProcess>();

  /** Explicit CLI path configured by the embedding app. */
  private configuredCliPath?: string;

  /** Environment snapshot used for CLI resolution and spawned processes. */
  private runnerEnv: NodeJS.ProcessEnv = process.env;

  /** Optional local workspace root used to find compiled CLI build output. */
  private workspaceRoot?: string;

  /** Mutating command pending flag — only one mutating command at a time. */
  private mutatingRunning = false;

  /** Queue of pending mutating commands. */
  private mutatingQueue: QueuedMutatingCommand[] = [];

  /**
   * Callback invoked when a command completes, for transcript persistence.
   * Set by main.ts after creating the transcript store.
   */
  public onCommandComplete?: (event: CommandEvent) => void | Promise<void>;

  /**
   * Creates a command runner with optional CLI resolution configuration.
   *
   * The default runner reads `process.env`, checks local compiled CLI output
   * relative to this module and the current process directory, then falls back
   * to spawning `openadab` from PATH. Tests can provide `env`, `cliPath`, or
   * `workspaceRoot` to make resolution deterministic without changing globals.
   */
  constructor(options: CommandRunnerOptions = {}) {
    this.configuredCliPath = options.cliPath;
    this.runnerEnv = options.env ?? process.env;
    this.workspaceRoot = options.workspaceRoot;
  }

  /**
   * Validates and runs a CLI command.
   *
   * @returns Promise<CommandEvent> — never rejects; errors are embedded in the event.
   */
  async run(
    request: CliRunRequest,
    sender: WebContents,
  ): Promise<CommandEvent> {
    if (!isAllowedCommand(request.args)) {
      const rejected: CommandEvent = {
        id: request.commandId,
        command: 'openadab',
        args: [...request.args],
        cwd: request.cwd,
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        exitCode: Number.NaN,
        stdout: '',
        stderr: `Command rejected: "${request.args.join(' ')}" is not in the allow-list.`,
        initiator: request.initiator,
        cancelled: false,
      };
      return this.finalize(rejected, sender);
    }

    // Queue mutating commands if one is already running
    if (isMutatingCommand(request.args)) {
      if (this.mutatingRunning) {
        return new Promise<CommandEvent>((resolve) => {
          this.mutatingQueue.push({ request, sender, resolve });
        });
      }
      this.mutatingRunning = true;
    }

    return this.spawnCommand(request, sender);
  }

  /** Drain the mutating command queue sequentially. */
  private processMutatingQueue(): void {
    if (this.mutatingRunning) return;

    const next = this.mutatingQueue.shift();
    if (!next) return;

    this.mutatingRunning = true;
    this.spawnCommand(next.request, next.sender)
      .then((event) => next.resolve(event))
      .catch((err) => {
        const event: CommandEvent = {
          id: next.request.commandId,
          command: 'openadab',
          args: [...next.request.args],
          cwd: next.request.cwd,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
          exitCode: Number.NaN,
          stdout: '',
          stderr: `Queued command failed: ${String(err)}`,
          initiator: next.request.initiator,
          cancelled: false,
        };
        this.finalize(event, next.sender)
          .then(next.resolve)
          .catch(() => next.resolve(event));
      });
  }

  /** Spawn the child process and stream output to the renderer. */
  private spawnCommand(
    request: CliRunRequest,
    sender: WebContents,
  ): Promise<CommandEvent> {
    const startedAt = new Date().toISOString();
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    let child: ChildProcess;
    let resolvedCli: ResolvedCliCommand | undefined;

    try {
      resolvedCli = resolveOpenAdabCli({
        cliPath: this.configuredCliPath,
        env: this.runnerEnv,
        workspaceRoot: this.workspaceRoot,
      });
      const invocation = buildSpawnInvocation(resolvedCli, request.args);

      child = spawn(invocation.command, invocation.args, {
        cwd: request.cwd,
        env: { ...this.runnerEnv },
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
    } catch (err) {
      const spawnError: CommandEvent = {
        id: request.commandId,
        command: 'openadab',
        args: [...request.args],
        cwd: request.cwd,
        startedAt,
        endedAt: new Date().toISOString(),
        exitCode: Number.NaN,
        stdout: '',
        stderr: `Failed to spawn OpenAdab CLI${
          resolvedCli ? ` (${describeResolvedCli(resolvedCli)})` : ''
        }: ${String(err)}`,
        initiator: request.initiator,
        cancelled: false,
      };
      return this.finalize(spawnError, sender);
    }

    this.activeCommands.set(request.commandId, child);

    return new Promise<CommandEvent>((resolve) => {
      let finalized = false;

      child.stdout?.on('data', (chunk: Buffer) => {
        stdoutChunks.push(chunk);
        const output: CommandOutputEvent = {
          commandId: request.commandId,
          stream: 'stdout',
          chunk: chunk.toString('utf-8'),
        };
        sender.send('event:command-output', output);
      });

      child.stderr?.on('data', (chunk: Buffer) => {
        stderrChunks.push(chunk);
        const output: CommandOutputEvent = {
          commandId: request.commandId,
          stream: 'stderr',
          chunk: chunk.toString('utf-8'),
        };
        sender.send('event:command-output', output);
      });

      const completeOnce = (event: CommandEvent): void => {
        if (finalized) return;
        finalized = true;
        this.finalize(event, sender)
          .then(resolve)
          .catch(() => resolve(event));
      };

      const cleanup = (code: number | null, signal: string | null): void => {
        if (finalized) return;
        this.activeCommands.delete(request.commandId);

        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = Buffer.concat(stderrChunks).toString('utf-8');
        const endedAt = new Date().toISOString();
        const { parsedJson, parseError } = parseCommandJson(
          request.args,
          stdout,
          stderr,
        );

        const event: CommandEvent = {
          id: request.commandId,
          command: 'openadab',
          args: [...request.args],
          cwd: request.cwd,
          startedAt,
          endedAt,
          exitCode: signal !== null && code === null ? Number.NaN : (code ?? Number.NaN),
          stdout,
          stderr,
          parsedJson,
          parseError,
          initiator: request.initiator,
          cancelled: signal !== null,
        };

        completeOnce(event);
      };

      child.on('close', (code, signal) => {
        cleanup(code, signal);
      });

      child.on('error', (err) => {
        if (finalized) return;
        this.activeCommands.delete(request.commandId);
        const endedAt = new Date().toISOString();
        const stdout = Buffer.concat(stdoutChunks).toString('utf-8');
        const stderr = appendStderr(
          Buffer.concat(stderrChunks).toString('utf-8'),
          `Failed to spawn OpenAdab CLI${
            resolvedCli ? ` (${describeResolvedCli(resolvedCli)})` : ''
          }: ${err.message}`,
        );
        const event: CommandEvent = {
          id: request.commandId,
          command: 'openadab',
          args: [...request.args],
          cwd: request.cwd,
          startedAt,
          endedAt,
          exitCode: Number.NaN,
          stdout,
          stderr,
          initiator: request.initiator,
          cancelled: false,
        };
        completeOnce(event);
      });
    });
  }

  /** Send completion event, persist transcript, and release mutating lock. */
  private async finalize(
    event: CommandEvent,
    sender: WebContents,
  ): Promise<CommandEvent> {
    sender.send('event:command-complete', event);
    await this.onCommandComplete?.(event);

    if (isMutatingCommand(event.args)) {
      this.mutatingRunning = false;
      // Drain queue asynchronously
      this.processMutatingQueue();
    }

    return event;
  }

  /**
   * Cancels a running command by sending SIGTERM (SIGKILL fallback on Windows).
   *
   * @returns true if the command was found and killed.
   */
  cancel(request: CliCancelRequest): boolean {
    const child = this.activeCommands.get(request.commandId);
    if (!child || child.exitCode !== null) return false;

    const signal = process.platform === 'win32' ? 'SIGKILL' : 'SIGTERM';
    try {
      child.kill(signal);
    } catch {
      // Process may have already exited
    }
    return true;
  }

  /**
   * Returns active command IDs for status display.
   */
  getActiveCommandIds(): string[] {
    return [...this.activeCommands.keys()];
  }

  /**
   * Whether any mutating command is currently running.
   */
  get isMutatingRunning(): boolean {
    return this.mutatingRunning;
  }

  /**
   * Number of commands waiting in the mutating queue.
   */
  get mutatingQueueLength(): number {
    return this.mutatingQueue.length;
  }

  /**
   * Check if a list of args would be allowed (used by tests).
   */
  static isAllowed(args: string[]): boolean {
    return isAllowedCommand(args);
  }

  /**
   * Classify a command as mutating (used by tests and UI).
   */
  static isMutating(args: string[]): boolean {
    return isMutatingCommand(args);
  }
}
