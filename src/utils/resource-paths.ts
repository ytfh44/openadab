/**
 * Pure helpers that resolve absolute paths to bundled CLI resources.
 *
 * The CLI ships non-TS assets (YAML schema definitions, host-adapter
 * command definitions, Markdown templates) that are loaded at runtime.
 * `tsc` only emits `.ts`/`.js`/`.d.ts` files, so those assets must be
 * copied into `dist/` by a post-build script.  At runtime the CLI must
 * be able to locate them whether it is running from the source tree
 * (`src/...`) or from the compiled tree (`dist/...`).
 *
 * The strategy is:
 *   1. Walk up from the caller's module URL until a directory
 *      containing `package.json` is found — that is the OpenAdab
 *      package root.
 *   2. Try the candidates in order. The default order is "most
 *      preferred first" — usually the built location, then the
 *      source-tree fallback. When `NODE_ENV === 'development'` the
 *      order is reversed so editing files under `src/schemas/built-in`
 *      is picked up live without rebuilding.
 *   3. When step 1 cannot locate a `package.json` (typical of single-
 *      file `esbuild --bundle`, `pkg`, or `ncc` outputs that embed
 *      the source) the resolver falls back to the `OPENADAB_ROOT`
 *      environment variable, so operators can point the CLI at a
 *      source checkout without rebuilding.
 *   4. Return the first candidate that actually exists on disk.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Maximum number of parent-directory hops the resolver will attempt
 * before giving up.  Sixteen covers any realistic layout
 * (monorepo-within-monorepo or deeply-nested pnpm store) while still
 * preventing runaway traversal in pathological inputs.
 */
const MAX_PARENT_HOPS = 16;

/**
 * Filename whose presence marks the OpenAdab package root.
 */
const PACKAGE_MARKER = 'package.json';

/**
 * Environment variable consulted when the upward `package.json` walk
 * fails.  Typical use: an esbuild `--bundle` or `pkg`-style single
 * file distribution where `import.meta.url` no longer points at a
 * sibling `package.json`.  Setting `OPENADAB_ROOT` to the source
 * checkout (or a copy of the relevant resources) is enough to make
 * the CLI locate its bundled assets.
 */
const ROOT_ENV_VAR = 'OPENADAB_ROOT';

/**
 * Walk up directory ancestors until one containing `package.json` is
 * found.  Returns that directory, or `null` if the marker is not found
 * within {@link MAX_PARENT_HOPS} hops or the filesystem root is reached.
 *
 * @param startDir Absolute directory to start searching from.
 * @returns The package root directory, or `null` when not found.
 */
function findPackageRoot(startDir: string): string | null {
  let current = resolve(startDir);
  for (let i = 0; i < MAX_PARENT_HOPS; i++) {
    if (existsSync(join(current, PACKAGE_MARKER))) {
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
 * Return the first candidate path (relative to the package root) that
 * already exists on disk, or `null` if none do.
 *
 * The candidate order encodes the user's preferred layout. In production
 * (or any `NODE_ENV` other than `development`) the built location is
 * preferred; in development the source location is preferred so live
 * edits are picked up without rebuilding.
 *
 * @param root       Absolute path to the package root.
 * @param candidates Absolute paths to try, in order of preference.
 * @param sourceFirst When `true`, reverse the candidate order so the
 *                    first entry is treated as the least preferred
 *                    and the last as the most preferred.  Used to flip
 *                    the priority in `NODE_ENV=development`.
 * @returns The first existing path, or `null` when none exist.
 */
function firstExisting(root: string, candidates: string[], sourceFirst: boolean): string | null {
  const ordered = sourceFirst ? candidates.slice().reverse() : candidates;
  for (const c of ordered) {
    if (existsSync(join(root, c))) {
      return join(root, c);
    }
  }
  return null;
}

/**
 * Determine whether the resolver should prefer the source-tree
 * candidate over the built one.
 *
 * Triggered by `NODE_ENV === 'development'`.  The comparison is
 * case-insensitive and tolerates the common variants
 * (`Development`, `DEV`, `dev`).
 *
 * @returns `true` when source-first ordering should be used.
 */
function preferSourceTree(): boolean {
  const env = process.env['NODE_ENV'];
  if (env === undefined) {
    return false;
  }
  return env.toLowerCase() === 'development';
}

/**
 * Resolve the package root, honouring the `OPENADAB_ROOT` environment
 * variable as a fallback for bundled / single-file distributions.
 *
 * Resolution order:
 *   1. Walk up from the caller looking for `package.json` (the
 *      normal case for source-tree and `tsc`-built runs).
 *   2. Honour `process.env.OPENADAB_ROOT` if it is set and points at
 *      a directory containing `package.json`.  This is the escape
 *      hatch for `esbuild --bundle` / `pkg` / `ncc` outputs where
 *      `import.meta.url` cannot reach the real source tree.
 *
 * @param moduleDir Absolute directory of the calling module.
 * @returns The package root directory.
 * @throws {Error} When neither strategy yields a usable root.
 */
function resolveRoot(moduleDir: string): string {
  const fromWalk = findPackageRoot(moduleDir);
  if (fromWalk !== null) {
    return fromWalk;
  }
  const envRoot = process.env[ROOT_ENV_VAR];
  if (envRoot !== undefined && envRoot.length > 0) {
    const resolved = resolve(envRoot);
    if (existsSync(join(resolved, PACKAGE_MARKER))) {
      return resolved;
    }
  }
  throw new Error(
    `Could not locate package root. Walked up from "${moduleDir}" ` +
    `without finding ${PACKAGE_MARKER}, and ${ROOT_ENV_VAR} is not set ` +
    `to a directory containing ${PACKAGE_MARKER}.`
  );
}

/**
 * Compute the absolute path to the built-in schemas directory shipped
 * with the CLI.
 *
 * @param metaUrl The `import.meta.url` of the calling module.
 * @returns Absolute path to the existing `schemas/built-in` directory.
 * @throws {Error} If no `package.json` is found in any ancestor
 *                 directory of the calling module (and
 *                 `OPENADAB_ROOT` is unset), or if neither the
 *                 built nor the source schemas directory exists on
 *                 disk.
 */
export function resolveBuiltInSchemasDir(metaUrl: string): string {
  const modulePath = fileURLToPath(metaUrl);
  const moduleDir = dirname(modulePath);
  const root = resolveRoot(moduleDir);
  const sourceFirst = preferSourceTree();
  const found = firstExisting(root, [
    'schemas/built-in',
    'src/schemas/built-in',
  ], sourceFirst);
  if (found === null) {
    throw new Error(
      `Could not locate built-in schemas directory under package root: <...>. ` +
      `Expected one of: <...>/schemas/built-in or <...>/src/schemas/built-in.`
    );
  }
  return found;
}

/**
 * Compute the absolute path to the host-adapter commands directory
 * shipped with the CLI.
 *
 * @param metaUrl The `import.meta.url` of the calling module.
 * @returns Absolute path to the existing `commands` directory.
 * @throws {Error} If no `package.json` is found in any ancestor
 *                 directory of the calling module (and
 *                 `OPENADAB_ROOT` is unset), or if neither the
 *                 built nor the source commands directory exists on
 *                 disk.
 */
export function resolveCommandsDir(metaUrl: string): string {
  const modulePath = fileURLToPath(metaUrl);
  const moduleDir = dirname(modulePath);
  const root = resolveRoot(moduleDir);
  const sourceFirst = preferSourceTree();
  const found = firstExisting(root, [
    'commands',
    'src/commands',
  ], sourceFirst);
  if (found === null) {
    throw new Error(
      `Could not locate commands directory under package root: <...>. ` +
      `Expected one of: <...>/commands or <...>/src/commands.`
    );
  }
  return found;
}
