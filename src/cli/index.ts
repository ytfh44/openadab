/**
 * CLI Wrapper — Commander-based command-line interface for OpenAdab.
 *
 * Provides commands for project initialization, change management,
 * context packing, validation, wiki operations, syncing, archiving,
 * configuration, and logging.
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import util from 'node:util';

import chalk from 'chalk';
import { Command, Option } from 'commander';
import ora from 'ora';
import YAML from 'yaml';

// `chalk@5` automatically honours the standard colour-suppression
// environment variables:
//   - `NO_COLOR`      (any non-empty value disables colour)
//   - `FORCE_COLOR=0` disables colour even on a TTY
//   - `FORCE_COLOR=1` forces colour even when stdout is piped
// No explicit `chalk.level = ...` assignment is needed: the library
// reads these on import.  Tests that want a deterministic output can
// temporarily set `process.env.NO_COLOR = '1'` before importing
// this module.

import { ArchiveEngine } from '../modules/archive-engine/index.js';
import { ArtifactGraph } from '../modules/artifact-graph/index.js';
import { ManifestManager } from '../modules/change-manifest/index.js';
import { ContextPacker } from '../modules/context-packer/index.js';
import { ContinuityLinter } from '../modules/continuity-linter/index.js';
import { AdapterFactory } from '../modules/host-adapters/adapter-factory.js';
import { CommandDefLoader, detectHost, writeGeneratedFiles, type AdapterBase, type GeneratedFile } from '../modules/host-adapters/index.js';
import { InstructionLoader } from '../modules/instruction-loader/index.js';
import { LogReader, LogWriter } from '../modules/log/index.js';
import { MechanicalValidator } from '../modules/mechanical-validator/index.js';
import { MentionIndexer } from '../modules/mention-indexer/index.js';
import { ProgressionTracker } from '../modules/progression-tracker/index.js';
import { ConfigLoader, ConfigWriter } from '../modules/project-config/index.js';
import { ProjectInitializer } from '../modules/project-init/index.js';
import { SchemaLoader, SchemaValidator } from '../modules/schema-engine/index.js';
import { SyncEngine } from '../modules/sync-engine/index.js';
import { WikiDiffApplier, WikiDiffParser } from '../modules/wiki-diff-engine/index.js';
import { WikiEngine } from '../modules/wiki-engine/index.js';
import { ProjectConfigSchema } from '../schemas/project-config.js';
import type { ValidationResult } from '../schemas/types.js';
import { AdabError, UsageError } from '../utils/errors.js';
import { fileExists, safeReadFile } from '../utils/fs.js';
import { assertChangeDirSafe } from '../utils/path.js';
import { redactConfigValue } from '../utils/redact.js';
import { resolveCommandsDir } from '../utils/resource-paths.js';
import { extractWikiTargets } from '../utils/wiki-link-regex.js';

/**
 * CLI options shared across multiple commands.
 */
interface GlobalOptions {
  json?: boolean;
}

/**
 * Format output as JSON or human-readable string.
 *
 * @param data    Data to output.
 * @param options Global options (includes `--json` flag).
 */
function output(data: unknown, options?: GlobalOptions): void {
  if (options?.json === true) {
    console.log(JSON.stringify(data, null, 2));
  } else if (typeof data === 'string') {
    console.log(data);
  } else {
    console.log(util.inspect(data, { depth: null, colors: true }));
  }
}

/**
 * Format an error for terminal or JSON consumption.
 *
 * @param err     The error object.
 * @param options Global options.
 * @returns Process exit code (1 for error, 2 for usage error).
 */
function handleError(err: unknown, options?: GlobalOptions): number {
  const code = err instanceof AdabError ? err.code : 'UNKNOWN_ERROR';
  const message = err instanceof Error ? err.message : String(err);
  const exitCode = code === 'USAGE_ERROR' ? 2 : 1;
  if (options?.json === true) {
    console.error(JSON.stringify({ error: true, code, message }, null, 2));
  } else {
    console.error(chalk.red(`Error [${code}]: ${message}`));
  }
  return exitCode;
}

/**
 * Handle an error that escaped the Commander action handlers — the
 * rejection surfaced by the top-level `void run().catch(...)` in the
 * entry point. Routes through the same formatting and exit-code logic
 * as {@link handleError}; `--json` is detected from the raw argv so the
 * structured error envelope is still emitted when the failing command
 * never reached its action handler.
 *
 * @param err The error that escaped.
 * @returns Process exit code (1 for error, 2 for usage error).
 */
export function handleUncaughtError(err: unknown): number {
  return handleError(err, { json: process.argv.includes('--json') });
}

/**
 * Maximum number of parent-directory hops the project-root search
 * will attempt.  Mirrors {@link findPackageRoot}'s cap and is
 * generous enough to handle a CLI invoked from a sub-directory of a
 * typical monorepo checkout.
 */
const PROJECT_ROOT_HOPS = 16;

/**
 * Marker that identifies the OpenAdab project root.
 *
 * A directory is considered a project root when it contains
 * `adab/config.yaml`.  We use the config file (not `package.json`)
 * because the project root is the *user's* project, which may or may
 * not be a Node package.
 */
const PROJECT_ROOT_MARKER = 'adab/config.yaml';

/**
 * Walk up from `start` looking for the directory containing
 * `adab/config.yaml`.  Returns the first match, or `null` if no
 * ancestor (within {@link PROJECT_ROOT_HOPS} hops) contains the
 * marker.
 *
 * @param start Absolute directory to start searching from.
 * @returns The project root directory, or `null` when not found.
 */
function findProjectRoot(start: string): string | null {
  let current = start;
  for (let i = 0; i < PROJECT_ROOT_HOPS; i++) {
    if (existsSync(join(current, PROJECT_ROOT_MARKER))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
  return null;
}

/**
 * Resolve the project root from the current working directory.
 *
 * Walks up from `process.cwd()` looking for the closest directory
 * containing `adab/config.yaml`.  This lets users run the CLI from
 * any sub-directory of the project (e.g. `adab/changes/ch-001`) and
 * still get the correct root.
 *
 * Falls back to `process.cwd()` when no marker is found so commands
 * that do not require an existing project (such as `init`) still
 * operate on a sensible directory.
 */
function resolveProjectRoot(): string {
  const fromWalk = findProjectRoot(process.cwd());
  if (fromWalk !== null) {
    return fromWalk;
  }
  return process.cwd();
}

/**
 * Safely extract a string option value, falling back to a default if the
 * option is not a non-empty string (e.g. it was passed as a boolean via
 * `--no-<flag>` or as an object).
 *
 * @param value    Raw option value from Commander (unknown type).
 * @param fallback Default to use when value is not a valid non-empty string.
 */
function safeStringOption(value: unknown, fallback: string): string {
  if (typeof value === 'string' && value.length > 0) {
    return value;
  }
  return fallback;
}

/**
 * Resolve the dryRun flag for `wiki apply-diff` from the parsed CLI options.
 *
 * `--apply` always wins: if it is explicitly set to true, the wiki-diff
 * must be written to disk and dryRun is false. Otherwise, dry-run is the
 * safe default (dryRun=true), so passing neither flag will not silently
 * mutate project files.
 *
 * This pure helper is exported so the priority rule can be unit-tested
 * independently of Commander and the wiki engines.
 *
 * @param options Parsed options object passed by Commander.
 * @returns true if the operation should be a dry run, false to write changes.
 */
export function resolveApplyDryRun(options: Record<string, unknown>): boolean {
  return options.apply !== true;
}

/**
 * Load and validate project config, throwing on failure.
 *
 * @param projectRoot Absolute path to the project root.
 * @throws {AdabError} If config is missing or invalid.
 */
async function ensureProjectConfig(projectRoot: string): Promise<void> {
  const configPath = join(projectRoot, 'adab', 'config.yaml');
  const raw = await safeReadFile(configPath);
  if (raw === null) {
    throw new AdabError(`Config file not found: ${configPath}`, 'CONFIG_MISSING');
  }
  let parsed: unknown;
  try {
    parsed = YAML.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AdabError(`Failed to parse config YAML: ${msg}`, 'CONFIG_PARSE_ERROR', { cause: err });
  }
  const result = ProjectConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new AdabError(`Config validation failed: ${issues}`, 'CONFIG_VALIDATION_ERROR');
  }
}

/**
 * Build and configure the Commander program with all OpenAdab commands.
 *
 * @returns Configured Commander program.
 */
export function createProgram(): Command {
  const program = new Command();
  program.name('openadab').description('Local-first, host-neutral fiction workflow engine').version('0.1.0');

  program
    .command('init')
    .description('Initialize a new OpenAdab project')
    .option('--schema <name>', 'Active schema name', 'chapter-draft')
    .option('--host <name>', 'Host adapter to generate')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab init --schema chapter-draft --host cursor')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      const isJson = options.json === true;
      const spinner = ora('Scaffolding project...').start();
      try {
        const initializer = new ProjectInitializer(projectRoot);
        await initializer.init({ schema: safeStringOption(options.schema, 'chapter-draft'), host: typeof options.host === 'string' ? options.host : undefined });
        // After the project files are on disk, generate host-adapter
        // files immediately.  `init` honours `--host <name>` so the
        // user does not need a separate `openadab update --host ...`
        // round-trip just to materialise the adapter output for the
        // freshly created project.
        try {
          const commandsDir = resolveCommandsDir(import.meta.url);
          const loader = new CommandDefLoader(commandsDir);
          const defs = await loader.loadAll();
          const host: string = typeof options.host === 'string'
            ? options.host
            : ((await detectHost(projectRoot)) ?? 'generic');
          const adapter: AdapterBase = AdapterFactory.create(host);
          const files: GeneratedFile[] = adapter.generate(defs);
          await writeGeneratedFiles(projectRoot, files);
        } catch (adapterErr) {
          // Adapter generation is a best-effort side effect of init.
          // The project scaffold itself succeeded, so the user still
          // gets a successful spinner; the warning explains they can
          // re-run `openadab update --host <name>` to retry.
          spinner.warn(chalk.yellow(`Project initialized; host adapter generation deferred: ${(adapterErr as Error).message}`));
          if (isJson) {
            output({
              success: true,
              message: 'Project initialized successfully.',
              warning: `Host adapter generation deferred: ${(adapterErr as Error).message}`,
            }, { json: true });
          } else {
            console.log(chalk.yellow('Run `openadab update --host <name>` to generate the host adapter later.'));
          }
          return;
        }
        spinner.succeed(chalk.green('Project initialized successfully.'));
        if (!isJson) {
          console.log(chalk.green(`Project root: ${projectRoot}`));
        } else {
          output({ success: true, message: 'Project initialized successfully.', projectRoot }, { json: true });
        }
      } catch (err) {
        spinner.fail(chalk.red('Project initialization failed.'));
        process.exitCode = handleError(err, { json: isJson });
      }
    });

  program
    .command('update')
    .description('Regenerate host adapters and refresh schemas')
    .option('--schemas', 'Also refresh built-in schemas', false)
    .option('--host <name>', 'Host adapter to generate')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab update --schemas --host cursor')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const spinner = ora('Updating host adapters...').start();
      const isJson = options.json === true;
      try {
        const commandsDir = resolveCommandsDir(import.meta.url);
        const loader = new CommandDefLoader(commandsDir);
        const defs = await loader.loadAll();
        const host: string = typeof options.host === 'string' ? options.host : ((await detectHost(projectRoot)) ?? 'generic');
        const adapter: AdapterBase = AdapterFactory.create(host);
        const files: GeneratedFile[] = adapter.generate(defs);
        await writeGeneratedFiles(projectRoot, files);

        const schemasRefreshed: string[] = [];
        let schemasWarning: string | undefined;

        if (options.schemas === true) {
          spinner.text = 'Refreshing built-in schemas...';
          const schemaLoader = new SchemaLoader(join(projectRoot, 'adab', 'schemas'));
          let builtInSchemas: string[];
          try {
            builtInSchemas = await schemaLoader.listBuiltInSchemas();
          } catch (err) {
            throw new AdabError(
              `Failed to list built-in schemas: ${(err as Error).message}`,
              'SCHEMA_LIST_FAILED',
              { cause: err instanceof Error ? err : undefined },
            );
          }
          if (builtInSchemas.length === 0) {
            schemasWarning = 'No built-in schemas found';
          } else {
            const projectSchemasDir = join(projectRoot, 'adab', 'schemas');
            for (const schemaName of builtInSchemas) {
              const destDir = join(projectSchemasDir, schemaName);
              const schemaPath = join(destDir, 'schema.yaml');
              let isForked = false;
              let rawSchema: string | null = null;
              try {
                rawSchema = await safeReadFile(schemaPath);
              } catch (readErr) {
                // The schema file is missing or unreadable.  Treat as
                // "not forked" and let forkSchema() regenerate it.
                // We surface the read error so a permission problem
                // is not silently swallowed.
                console.warn(`[update] Could not read ${schemaPath}: ${(readErr as Error).message}`);
              }
              if (rawSchema !== null) {
                try {
                  const parsed = YAML.parse(rawSchema) as Record<string, unknown> | null;
                  if (parsed !== null && typeof parsed === 'object') {
                    isForked = parsed.forked_from !== undefined;
                  }
                } catch (parseErr) {
                  // Malformed YAML in the user's project should not
                  // brick `update`; log the parse failure and treat
                  // the schema as fresh so forkSchema() can rebuild
                  // it from the built-in source.
                  console.warn(`[update] Could not parse ${schemaPath}: ${(parseErr as Error).message}`);
                }
              }
              if (isForked || rawSchema === null) {
                await schemaLoader.forkSchema(schemaName, schemaName);
              }
              schemasRefreshed.push(schemaName);
            }
          }
        }

        spinner.succeed(chalk.green('Update complete.'));
        if (isJson) {
          if (options.schemas === true) {
            const payload: Record<string, unknown> = {
              success: true,
              commandsRun: schemasRefreshed,
              mode: 'schemas',
            };
            if (schemasWarning !== undefined) {
              payload.warning = schemasWarning;
            }
            output(payload, { json: true });
          } else {
            output({ success: true, mode: 'host-adapters' }, { json: true });
          }
        } else if (schemasWarning !== undefined) {
          console.log(chalk.yellow(`Warning: ${schemasWarning}`));
        }
      } catch (err) {
        spinner.fail(chalk.red('Update failed.'));
        process.exitCode = handleError(err, { json: isJson });
      }
    });

  const schemaCmd = program.command('schema').description('Schema management');

  schemaCmd
    .command('list')
    .description('List installed schemas in the project')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab schema list')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      try {
        await ensureProjectConfig(projectRoot);
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
        return;
      }
      const schemaDir = join(projectRoot, 'adab', 'schemas');
      let activeSchema = '';
      try {
        const configLoader = new ConfigLoader(projectRoot);
        await configLoader.load();
        activeSchema = configLoader.getActiveSchema();
      } catch {
        // Config may not exist yet; ignore.
      }
      try {
        const entries = await readdir(schemaDir, { withFileTypes: true });
        const list = entries.filter((d) => d.isDirectory()).map((d) => d.name);
        if (list.length === 0) {
          if (options.json !== true) {
            console.log(chalk.yellow('No schemas installed.'));
          } else {
            output({ schemas: [], activeSchema: '' }, { json: true });
          }
        } else {
          if (options.json !== true) {
            console.log(chalk.blue('Installed schemas:'));
            for (const name of list) {
              const marker = name === activeSchema ? chalk.cyan(' [active]') : '';
              console.log(chalk.green(`  ${name}`) + marker);
            }
          } else {
            output({ schemas: list, activeSchema }, { json: true });
          }
        }
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  schemaCmd
    .command('validate <path>')
    .description('Validate a schema directory')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab schema validate ./adab/schemas/chapter-draft')
    .action(async (schemaPath: string, options: Record<string, unknown>) => {
      const loader = new SchemaLoader(schemaPath);
      const validator = new SchemaValidator();
      try {
        const schema = await loader.load();
        const result = await validator.validate(schema, schemaPath);
        if (!result.passed) {
          const errorMessages = result.errors.join(', ');
          process.exitCode = handleError(new AdabError(`Schema validation failed: ${errorMessages}`, 'SCHEMA_VALIDATION_ERROR'), { json: options.json === true });
          if (options.json !== true) {
            const icon = chalk.red('✖');
            console.log(`${icon} Schema validation failed`);
            for (const e of result.errors) {
              console.log(chalk.red(`  Error: ${e}`));
            }
          } else {
            output(result, { json: true });
          }
          return;
        }
        if (options.json !== true) {
          const icon = chalk.green('✔');
          console.log(`${icon} Schema validation passed`);
        } else {
          output(result, { json: true });
        }
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  schemaCmd
    .command('fork <base> <name>')
    .description('Fork a built-in schema')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab schema fork chapter-draft my-custom-schema')
    .action(async (base: string, name: string, options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const schemaDir = join(projectRoot, 'adab', 'schemas');
      const loader = new SchemaLoader(schemaDir);
      try {
        await loader.forkSchema(base, name);
        if (options.json !== true) {
          console.log(chalk.green(`Schema forked: ${base} -> ${name}`));
        } else {
          output({ success: true, base, name }, { json: true });
        }
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  schemaCmd
    .command('show <name>')
    .description('Show schema details')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab schema show chapter-draft')
    .action(async (name: string, options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const schemaDir = join(projectRoot, 'adab', 'schemas', name);
      const loader = new SchemaLoader(schemaDir);
      try {
        const schema = await loader.load();
        output(schema, { json: options.json === true });
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  program
    .command('new')
    .description('Create a new change')
    .argument('<type>', 'Change kind (e.g. chapter, revision, plan). Stored on the manifest metadata under `kind`.')
    .argument('<id>', 'Change identifier')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab new chapter ch-001')
    .action(async (type: string, id: string, options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      try {
        // Reject traversal-style ids before they are joined onto
        // `adab/changes/` (e.g. `openadab new chapter ../../x` would
        // otherwise write `.openadab.yaml` outside the project).
        assertChangeDirSafe(projectRoot, id);
        await ensureProjectConfig(projectRoot);
        const configLoader = new ConfigLoader(projectRoot);
        await configLoader.load();
        const schemaName = configLoader.getActiveSchema();
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const schema = await schemaLoader.load();
        const manifestManager = new ManifestManager();
        const manifest = manifestManager.createManifest(id, schema);
        // Surface the user-supplied `type` argument on the manifest so
        // downstream tools (search, filters, reports) can distinguish
        // chapter vs revision vs plan changes without parsing the
        // directory name.  Stored in `metadata.kind` because the
        // ChangeManifest schema reserves a small set of top-level
        // fields and `kind` is not one of them.
        manifest.metadata = { ...manifest.metadata, kind: type };
        const changeDir = join(projectRoot, 'adab', 'changes', id);
        await mkdir(changeDir, { recursive: true });
        await manifestManager.writeManifest(changeDir, manifest);
        if (options.json !== true) {
          console.log(chalk.green(`Created ${type} change ${id}`));
        } else {
          output({ success: true, type, id, kind: type }, { json: true });
        }
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  program
    .command('status')
    .description('Show artifact graph status')
    .requiredOption('--change <id>', 'Change identifier')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab status --change ch-001 --json')
    .action(async (options: Record<string, unknown>) => {
      try {
        const projectRoot = resolveProjectRoot();
        assertChangeDirSafe(projectRoot, String(options.change));
        await ensureProjectConfig(projectRoot);
        const changeDir = join(projectRoot, 'adab', 'changes', String(options.change));
        const manifestManager = new ManifestManager();
        const changeManifest = await manifestManager.readManifest(changeDir);
        const schemaName = changeManifest.schema;
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const schema = await schemaLoader.load();
        const graph = new ArtifactGraph(schema);
        const status = await graph.toJson(changeDir);
        if (options.json !== true) {
          console.log(chalk.blue(`Status for change ${String(options.change)}:`));
        }
        output(status, { json: options.json === true });
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  program
    .command('instructions')
    .description('Load instructions for an artifact')
    .argument('<artifact>', 'Artifact identifier')
    .requiredOption('--change <id>', 'Change identifier')
    .option('--json', 'Output as JSON')
    .option('--inline-deps', 'Inline dependency contents')
    .addHelpText('after', '\nExample:\n  openadab instructions brief --change ch-001 --json')
    .action(async (artifact: string, options: Record<string, unknown>) => {
      try {
        const projectRoot = resolveProjectRoot();
        assertChangeDirSafe(projectRoot, String(options.change));
        await ensureProjectConfig(projectRoot);
        const changeId = String(options.change);
        const changeDir = join(projectRoot, 'adab', 'changes', changeId);
        const manifestManager = new ManifestManager();
        const changeManifest = await manifestManager.readManifest(changeDir);
        const configLoader = new ConfigLoader(projectRoot);
        const projectConfig = await configLoader.load();
        const schemaName = changeManifest.schema;
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const schema = await schemaLoader.load();
        const wikiEngine = new WikiEngine(projectRoot);
        const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
        const progressionTracker = new ProgressionTracker(projectRoot);
        const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
        const loader = new InstructionLoader(schema, projectConfig, contextPacker, changeId);
        const payload = await loader.loadInstructions(artifact, options.inlineDeps === true);
        if (options.json !== true) {
          console.log(chalk.blue(`Instructions for artifact ${artifact}:`));
        }
        output(payload, { json: options.json === true });
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  const contextCmd = program.command('context').description('Context pack operations');

  contextCmd
    .command('pack')
    .description('Pack context for an artifact')
    .requiredOption('--change <id>', 'Change identifier')
    .requiredOption('--artifact <id>', 'Artifact identifier')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab context pack --change ch-001 --artifact draft --json')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const configLoader = new ConfigLoader(projectRoot);
      await configLoader.load();
      const wikiEngine = new WikiEngine(projectRoot);
      const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
      const progressionTracker = new ProgressionTracker(projectRoot);
      const packer = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
      const pack = await packer.packContext(String(options.change), String(options.artifact));
      if (options.json !== true) {
        console.log(chalk.blue(`Context pack for ${String(options.artifact)}:`));
      }
      output(pack, { json: options.json === true });
    });

  program
    .command('validate')
    .description('Run validators on a change')
    .requiredOption('--change <id>', 'Change identifier')
    .option('--mechanical', 'Run mechanical validation')
    .option('--semantic', 'Run semantic validation')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab validate --change ch-001 --mechanical')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const changeId = String(options.change);
      const changeDir = join(projectRoot, 'adab', 'changes', changeId);
      const manifestManager = new ManifestManager();
      const changeManifest = await manifestManager.readManifest(changeDir);
      const results: ValidationResult[] = [];

      // Validator selection matrix:
      //   --mechanical only          → mechanical
      //   --semantic   only          → semantic
      //   --mechanical --semantic    → both
      //   neither                    → mechanical (default; matches the
      //                                 spec's "mechanical is automatic" rule)
      const wantMechanical = options.mechanical === true || (options.mechanical === undefined && options.semantic === undefined);
      const wantSemantic = options.semantic === true;

      if (wantMechanical) {
        const configLoader = new ConfigLoader(projectRoot);
        const projectConfig = await configLoader.load();
        const schemaName = changeManifest.schema;
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const wikiEngine = new WikiEngine(projectRoot);
        const validator = new MechanicalValidator(schemaLoader, projectConfig, wikiEngine, projectRoot);
        const changeResults = await validator.validateChange(changeDir);
        results.push(...changeResults);
      }
      if (wantSemantic) {
        const configLoader = new ConfigLoader(projectRoot);
        const projectConfig = await configLoader.load();
        const wikiEngine = new WikiEngine(projectRoot);
        const linter = new ContinuityLinter(projectConfig, wikiEngine, projectRoot);
        const schemaName = changeManifest.schema;
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const schema = await schemaLoader.load();
        const profileArtifactIds = new Set(['draft', 'revision', 'wiki-diff']);
        let generatedPrompts = 0;
        for (const artDef of schema.artifacts) {
          if (!profileArtifactIds.has(artDef.id)) {continue;}
          generatedPrompts += 1;
          const prompt = await linter.generateValidationPrompt(changeDir, artDef.id);
          results.push({
            artifactId: artDef.id,
            passed: true,
            errors: [],
            warnings: ['Semantic validation is a placeholder; review the generated prompt manually.'],
            extras: { prompt },
          } satisfies ValidationResult);
        }
        if (generatedPrompts === 0) {
          // A schema that names its artifacts differently (e.g.
          // `scene-plan` only) would otherwise match none of the profile
          // ids, produce zero prompts, and still print "Validation
          // passed" — a silent no-op.  Surface it instead.
          const warning = 'No semantic validation prompts generated: schema defines none of the profile artifact ids (draft, revision, wiki-diff).';
          if (options.json === true) {
            results.push({
              artifactId: '_semantic',
              passed: true,
              errors: [],
              warnings: [warning],
            } satisfies ValidationResult);
          } else {
            console.warn(chalk.yellow(warning));
          }
        } else if (options.json !== true) {
          console.log(chalk.yellow('Semantic validation is a placeholder. Prompt generated for manual review.'));
        }
      }
      const hasErrors = results.some((r) => !r.passed);
      if (options.json !== true) {
        for (const r of results) {
          const icon = r.passed ? chalk.green('✔') : chalk.red('✖');
          console.log(`${icon} ${r.artifactId}`);
          for (const e of r.errors) {
            console.log(chalk.red(`  Error: ${e}`));
          }
          for (const w of r.warnings) {
            console.log(chalk.yellow(`  Warning: ${w}`));
          }
        }
        if (hasErrors) {
          console.log(chalk.red(`Validation failed for ${changeId}`));
        } else {
          console.log(chalk.green(`Validation passed for ${changeId}`));
        }
      } else {
        output(results, { json: true });
      }
      if (hasErrors) {
        // In --json mode, route the failure through handleError so the
        // exit code is non-zero and a structured error envelope is
        // emitted on stderr.  In human mode, the loop above already
        // printed the per-artifact diagnostics; the non-zero exit
        // code is the only thing the shell wrapper needs.
        if (options.json === true) {
          const failedCount = results.filter((r) => !r.passed).length;
          process.exitCode = handleError(
            new AdabError(
              `Validation failed for ${changeId}: ${String(failedCount)} artifact(s) with errors`,
              'VALIDATION_ERROR',
            ),
            { json: true },
          );
        } else {
          process.exitCode = 1;
        }
      }
    });

  const wikiCmd = program.command('wiki').description('Wiki operations');

  wikiCmd
    .command('index')
    .description('Regenerate wiki index TOC')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab wiki index')
    .action(async (options: Record<string, unknown>) => {
      const isJson = options.json === true;
      const spinner = ora('Regenerating wiki index...').start();
      try {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        const wikiEngine = new WikiEngine(projectRoot);
        // generateIndex returns void; the JSON envelope below is the
        // minimal success shape (no result payload to report).
        await wikiEngine.generateIndex();
        // Resolve the on-disk path of the regenerated index so the
        // JSON consumer can confirm what was written.  In human mode
        // the spinner.succeed line already conveys success; we still
        // echo the path so operators can see exactly which file was
        // touched.
        const indexPath = join(projectRoot, 'adab', 'wiki', 'index.md');
        spinner.succeed(chalk.green(`Wiki index regenerated: ${indexPath}`));
        if (isJson) {
          const payload = { success: true, indexPath };
          output(payload, { json: true });
        } else {
          console.log(chalk.blue(`Index file: ${indexPath}`));
        }
      } catch (err) {
        // Failure path: do NOT call spinner.fail() (that writes to
        // stderr in addition to the JSON envelope that handleError
        // will emit).  Stop the spinner quietly and let handleError
        // produce a single, structured error message.
        spinner.stop();
        process.exitCode = handleError(err, { json: isJson });
      }
    });

  wikiCmd
    .command('lint')
    .description('Validate wiki page structure')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab wiki lint')
    .action(async (options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      await ensureProjectConfig(projectRoot);
      const wikiEngine = new WikiEngine(projectRoot);
      const pages = await wikiEngine.listPages();
      const errors: string[] = [];
      const warnings: string[] = [];
      for (const page of pages) {
        try {
          await wikiEngine.readPage(page);
        } catch (err) {
          errors.push(`${page}: ${(err as Error).message}`);
        }
      }
      const systemIssues = await wikiEngine.checkSystemPages();
      for (const issue of systemIssues) {
        const entry = `${issue.file}: ${issue.message}`;
        if (issue.severity === 'error') {
          errors.push(entry);
        } else {
          warnings.push(entry);
        }
      }
      if (errors.length === 0 && warnings.length === 0) {
        if (options.json !== true) {
          console.log(chalk.green('All wiki pages valid.'));
        } else {
          output({ valid: true, errors: [], warnings: [] }, { json: true });
        }
      } else {
        if (options.json !== true) {
          if (errors.length > 0) {
            console.log(chalk.yellow(`${String(errors.length)} wiki page(s) have issues:`));
            for (const e of errors) {
              console.log(chalk.yellow(`  - ${e}`));
            }
          }
          if (warnings.length > 0) {
            console.log(chalk.yellow(`${String(warnings.length)} wiki page(s) have warnings:`));
            for (const w of warnings) {
              console.log(chalk.yellow(`  - ${w}`));
            }
          }
        } else {
          output({ valid: errors.length === 0, errors, warnings }, { json: true });
        }
        if (errors.length > 0) {
          process.exitCode = handleError(new AdabError(`${String(errors.length)} wiki page(s) have issues`, 'VALIDATION_ERROR'), { json: options.json === true });
        }
      }
    });

  wikiCmd
    .command('diff')
    .description('Preview or generate wiki-diff')
    .option('--change <id>', 'Change identifier')
    .option('--from <path>', 'Generate wiki-diff from manuscript path')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab wiki diff --change ch-001')
    .action(async (options: Record<string, unknown>) => {
      if (options.from !== undefined && options.change !== undefined) {
        console.warn('Both --from and --change provided; --from takes precedence.');
      }
      if (options.from !== undefined) {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        const raw = await safeReadFile(typeof options.from === 'string' ? options.from : '');
        if (raw === null) {
          process.exitCode = handleError(new AdabError(`Manuscript not found: ${typeof options.from === 'string' ? options.from : ''}`, 'TARGET_NOT_FOUND'), { json: options.json === true });
          return;
        }
        const matches = new Set<string>();
        for (const target of extractWikiTargets(raw)) {
          matches.add(target);
        }
        const links = Array.from(matches);
        const report = await Promise.all(
          links.map(async (link) => {
            try {
              const exists = await fileExists(join(projectRoot, 'adab', 'wiki', `${link}.md`));
              return { link, exists };
            } catch (err) {
              return { link, exists: false, error: err instanceof Error ? err.message : String(err) };
            }
          }),
        );
        if (options.json !== true) {
          console.log(chalk.blue(`Wiki links found in ${typeof options.from === 'string' ? options.from : ''}:`));
          for (const r of report) {
            const icon = r.exists ? chalk.green('✔') : chalk.red('✖');
            console.log(`  ${icon} [[${r.link}]] ${r.exists ? '(exists)' : '(missing)'}`);
          }
        } else {
          output({ source: options.from, links: report }, { json: true });
        }
        return;
      }
      if (options.change !== undefined) {
        const projectRoot = resolveProjectRoot();
        try {
          if (typeof options.change === 'string') {
            assertChangeDirSafe(projectRoot, options.change);
          }
        } catch (err) {
          process.exitCode = handleError(err, { json: options.json === true });
          return;
        }
        await ensureProjectConfig(projectRoot);
        const diffPath = join(projectRoot, 'adab', 'changes', typeof options.change === 'string' ? options.change : '', 'wiki-diff.md');
        const raw = await safeReadFile(diffPath);
        if (raw === null) {
          if (options.json !== true) {
            console.log(chalk.yellow('No wiki-diff found for this change.'));
          } else {
            output({ error: true, code: 'TARGET_NOT_FOUND', message: 'No wiki-diff found for this change.' }, { json: true });
          }
          process.exitCode = handleError(new AdabError('No wiki-diff found for this change.', 'TARGET_NOT_FOUND'), { json: options.json === true });
          return;
        }
        const parser = new WikiDiffParser();
        const doc = await parser.parse(raw);
        if (options.json !== true) {
          console.log(chalk.blue(`Wiki-diff for ${typeof options.change === 'string' ? options.change : ''}:`));
        }
        output(doc, { json: options.json === true });
      }

      process.exitCode = handleError(new UsageError('Either --from <path> or --change <id> is required'), { json: options.json === true });
    });

  wikiCmd
    .command('apply-diff [path]')
    .description('Apply semantic wiki-diff operations')
    .option('--dry-run', 'Preview changes without writing')
    .addOption(new Option('--apply', 'Apply changes').conflicts(['dryRun']))
    .option('--change <id>', 'Change identifier (resolves to adab/changes/<id>/wiki-diff.md)')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab wiki apply-diff adab/changes/ch-001/wiki-diff.md --apply')
    .action(async (diffPath: string | undefined, options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      // Guard the change id before it is joined onto `adab/changes/`.
      if (options.change !== undefined && typeof options.change === 'string') {
        try {
          assertChangeDirSafe(projectRoot, options.change);
        } catch (err) {
          process.exitCode = handleError(err, { json: options.json === true });
          return;
        }
      }
      await ensureProjectConfig(projectRoot);

      // Resolve path from --change flag if provided
      if (options.change !== undefined && typeof options.change === 'string') {
        diffPath = join(projectRoot, 'adab', 'changes', options.change, 'wiki-diff.md');
      }

      if (diffPath === undefined || diffPath === '') {
        process.exitCode = handleError(new UsageError('Either <path> or --change <id> is required'), { json: options.json === true });
        return;
      }

      const wikiEngine = new WikiEngine(projectRoot);
      const applier = new WikiDiffApplier(projectRoot, wikiEngine);
      const raw = await safeReadFile(diffPath);
      if (raw === null) {
        process.exitCode = handleError(new AdabError(`Wiki-diff not found: ${diffPath}`, 'TARGET_NOT_FOUND'), { json: options.json === true });
        return;
      }
      const parser = new WikiDiffParser();
      const doc = await parser.parse(raw);
      const dryRun = resolveApplyDryRun(options);
      const result = await applier.apply(doc, dryRun);
      if (options.json !== true) {
        const icon = result.success ? chalk.green('✔') : chalk.red('✖');
        console.log(`${icon} Apply ${result.success ? 'succeeded' : 'failed'}`);
        if (result.summary !== '') {
          console.log(chalk.blue(`Summary: ${result.summary}`));
        }
      }
      output(result, { json: options.json === true });
      if (!result.success) {
        const summary = result.summary || 'unknown error';
        process.exitCode = handleError(new AdabError(`Apply failed: ${summary}`, 'WIKI_DIFF_APPLY_ERROR'), { json: options.json === true });
      }
    });

  program
    .command('sync')
    .description('Orchestrate full sync for a change')
    .requiredOption('--change <id>', 'Change identifier')
    .option('--full', 'Force full re-index instead of incremental')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab sync --change ch-001')
    .action(async (options: Record<string, unknown>) => {
      const spinner = ora(`Syncing change ${String(options.change)}...`).start();
      try {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        // Guard the change id before it is joined onto `adab/changes/`:
        // the manifest read below must not escape the project boundary
        // (SyncEngine.sync re-checks, but only after this read).
        assertChangeDirSafe(projectRoot, String(options.change));
        // Validate/pack against the schema the change was created under
        // (from its manifest), not the currently ACTIVE schema — a change
        // created under an older schema would otherwise be validated
        // against the wrong rules once the active schema changes.
        const changeDir = join(projectRoot, 'adab', 'changes', String(options.change));
        const manifestManager = new ManifestManager();
        const changeManifest = await manifestManager.readManifest(changeDir);
        const schemaName = changeManifest.schema;
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const wikiEngine = new WikiEngine(projectRoot);
        const mentionIndexer = new MentionIndexer(projectRoot, wikiEngine);
        const progressionTracker = new ProgressionTracker(projectRoot);
        const configLoader = new ConfigLoader(projectRoot);
        const projectConfig = await configLoader.load();
        const contextPacker = new ContextPacker(projectRoot, wikiEngine, mentionIndexer, progressionTracker, configLoader);
        const wikiDiffParser = new WikiDiffParser();
        const wikiDiffApplier = new WikiDiffApplier(projectRoot, wikiEngine);
        const validator = new MechanicalValidator(schemaLoader, projectConfig, wikiEngine, projectRoot);
        const syncEngine = new SyncEngine(
          projectRoot,
          wikiDiffParser,
          wikiDiffApplier,
          wikiEngine,
          mentionIndexer,
          progressionTracker,
          contextPacker,
          validator,
        );
        const report = await syncEngine.sync(String(options.change), options.full === true);
        spinner.succeed(chalk.green(`Sync complete. Modified ${String(report.wikiPagesModified.length)} wiki page(s).`));
        output(report, { json: options.json === true });
      } catch (err) {
        spinner.fail(chalk.red('Sync failed.'));
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  program
    .command('archive')
    .description('Archive a completed change')
    .argument('<change-id>', 'Change identifier')
    .option('--force', 'Force archive even if a conflicting in-progress change exists')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab archive draft-ch-012')
    .action(async (changeId: string, options: Record<string, unknown>) => {
      const spinner = ora(`Archiving ${changeId}...`).start();
      try {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        const configLoader = new ConfigLoader(projectRoot);
        await configLoader.load();
        const schemaName = configLoader.getActiveSchema();
        const schemaDir = join(projectRoot, 'adab', 'schemas', schemaName);
        const schemaLoader = new SchemaLoader(schemaDir);
        const engine = new ArchiveEngine(projectRoot, schemaLoader);
        const report = await engine.archive(changeId, options.force === true);
        spinner.succeed(chalk.green(`Archived ${changeId}.`));
        output(report, { json: options.json === true });
      } catch (err) {
        spinner.fail(chalk.red('Archive failed.'));
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  const configCmd = program.command('config').description('Configuration management');

  configCmd
    .command('get <path>')
    .description('Get a config value by dot-path')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab config get project.title')
    .action(async (path: string, options: Record<string, unknown>) => {
      try {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        const loader = new ConfigLoader(projectRoot);
        const config = await loader.load();
        const keys = path.split('.');
        let value: unknown = config;
        for (const key of keys) {
          if (value === null || typeof value !== 'object') {
            process.exitCode = handleError(new UsageError(`Invalid config path: ${path}`), { json: options.json === true });
            return;
          }
          value = (value as Record<string, unknown>)[key];
        }
        // A missing key leaves `value` undefined.  YAML cannot store
        // undefined, so "key absent" and "key present with undefined"
        // are indistinguishable — both are reported as an invalid path
        // instead of printing `undefined` and exiting 0.
        if (value === undefined) {
          process.exitCode = handleError(new UsageError(`Invalid config path: ${path}`), { json: options.json === true });
          return;
        }
        if (options.json !== true && typeof value === 'string') {
          console.log(chalk.green(value));
        } else {
          output(value, { json: options.json === true });
        }
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  configCmd
    .command('set <path> <value>')
    .description('Set a config value by dot-path')
    .option('--json', 'Parse value as JSON before storing')
    .addHelpText('after', '\nExample:\n  openadab config set project.title "My Novel"')
    .action(async (path: string, value: string, options: Record<string, unknown>) => {
      const projectRoot = resolveProjectRoot();
      let parsed: unknown = value;
      try {
        await ensureProjectConfig(projectRoot);
        const writer = new ConfigWriter(projectRoot);
        /**
         * The stored value. In raw mode (default) this is the verbatim string
         * the user typed. In `--json` mode this is the result of `JSON.parse`,
         * which lets callers persist numbers, booleans, objects, and arrays
         * without quoting. In raw mode, the string is stored as-is — including
         * any literal quotes — so `config set project.title My Title` stores
         * `My Title` (no surrounding quotes), while
         * `config set project.title "My Title" --json` parses to `My Title`
         * and `config set project.title My Title` stores `My Title`.
         */
        if (options.json === true) {
          try {
            parsed = JSON.parse(value);
          } catch (err) {
            const reason = err instanceof Error ? err.message : String(err);
            throw new AdabError(
              `Invalid JSON for config value at "${path}": ${reason}`,
              'CONFIG_INVALID_VALUE',
              { cause: err },
            );
          }
        }
        await writer.set(path, parsed);
        const logWriter = new LogWriter(projectRoot);
        // S2: redact sensitive values (secrets.*, *.token, *.apiKey, *.password, …)
        // before persisting them to adab/log.md so plaintext credentials never
        // land in the audit log.
        const logValue = redactConfigValue(path, parsed);
        await logWriter.append({
          ts: new Date().toISOString(),
          op: 'update',
          change: null,
          result: 'success',
          details: { path, value: logValue },
        });
        if (options.json !== true) {
          console.log(chalk.green(`Set ${path} = ${value}`));
        } else {
          output({ success: true, path, value: parsed }, { json: true });
        }
      } catch (err) {
        if (err instanceof AdabError && err.code === 'CONFIG_VALIDATION_ERROR') {
          const message = err.message;
          const povMatch = path === 'project.pov' && typeof parsed === 'string';
          const languageMatch = path === 'project.language' && typeof parsed === 'string';
          const tenseMatch = path === 'project.tense' && typeof parsed === 'string';
          if (options.json !== true) {
            if (povMatch) {
              console.error(chalk.red(`Invalid POV mode: "${String(parsed)}". Valid modes: first-person, limited-third, omniscient-third`));
            } else if (languageMatch) {
              console.error(chalk.red(`Invalid language: "${String(parsed)}". Valid values: zh-CN, en-US, ja-JP`));
            } else if (tenseMatch) {
              console.error(chalk.red(`Invalid tense: "${String(parsed)}". Valid values: past, present`));
            } else {
              console.error(chalk.red(message));
            }
          } else {
            const code = 'CONFIG_VALIDATION_ERROR';
            const detail = povMatch
              ? `Invalid POV mode: "${String(parsed)}". Valid modes: first-person, limited-third, omniscient-third`
              : languageMatch
                ? `Invalid language: "${String(parsed)}". Valid values: zh-CN, en-US, ja-JP`
                : tenseMatch
                  ? `Invalid tense: "${String(parsed)}". Valid values: past, present`
                  : message;
            console.error(JSON.stringify({ error: true, code, message: detail }, null, 2));
          }
          process.exitCode = 1;
          return;
        }
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  program
    .command('log')
    .description('Display log entries')
    .option('--limit <N>', 'Limit number of entries (must be a positive integer)', (v: string) => {
      const n = Number(v);
      if (!Number.isInteger(n) || n <= 0) {
        throw new UsageError(`Invalid --limit value: must be a positive integer, got "${v}"`);
      }
      return n;
    })
    .option('--change <id>', 'Filter by change ID')
    .option('--json', 'Output as JSON')
    .addHelpText('after', '\nExample:\n  openadab log --limit 10 --change ch-001')
    .action(async (options: Record<string, unknown>) => {
      try {
        const projectRoot = resolveProjectRoot();
        await ensureProjectConfig(projectRoot);
        const reader = new LogReader(projectRoot);
        let entries = await reader.readAll();
        if (options.change !== undefined && options.change !== '') {
          entries = entries.filter((e) => e.change === options.change);
        }
        // The `--limit` parser rejects non-positive integers up front, so the
        // `> 0` guard below is purely defensive and is not expected to fire in
        // normal operation. Keeping it makes the slice call safe even if a
        // future caller bypasses the parser (e.g. unit tests invoking the
        // action handler directly with a hand-built options object).
        if (options.limit !== undefined && typeof options.limit === 'number' && options.limit > 0) {
          entries = entries.slice(-options.limit);
        }
        if (options.json !== true) {
          console.log(chalk.blue(`Log entries (${String(entries.length)}):`));
        }
        output(entries, { json: options.json === true });
      } catch (err) {
        process.exitCode = handleError(err, { json: options.json === true });
      }
    });

  return program;
}

/**
 * Main entry point for the CLI.
 *
 * Parses process arguments and executes the appropriate command.
 *
 * @param argv Command-line arguments (defaults to process.argv).
 * @returns Promise resolving to the program instance.
 */
export async function run(argv: string[] = process.argv): Promise<Command> {
  const program = createProgram();
  await program.parseAsync(argv);
  return program;
}
