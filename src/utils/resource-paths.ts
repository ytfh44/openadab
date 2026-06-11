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
 *   2. Try the built (`<root>/<resource>`) location first, then fall
 *      back to the source (`<root>/src/<resource>`) location.  Return
 *      the first path that actually exists on disk.  This matches
 *      both layouts transparently:
 *        - Built:   `dist/modules/<x>/index.js`  →  `<root>/schemas/built-in`
 *        - Source:  `src/modules/<x>/index.ts`   →  `<root>/src/schemas/built-in`
 *        - Test:    `src/.../index.test.ts`     →  `<root>/src/schemas/built-in`
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Maximum number of parent-directory hops the resolver will attempt
 * before giving up.  Eight is more than enough for any realistic layout
 * and prevents runaway traversal in pathological inputs.
 */
const MAX_PARENT_HOPS = 8;

/**
 * Filename whose presence marks the OpenAdab package root.
 */
const PACKAGE_MARKER = 'package.json';

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
 * already exists on disk, or `null` if none do.  The candidates list
 * is interpreted as "most preferred first".
 *
 * @param root Absolute path to the package root.
 * @param candidates Absolute paths to try, in order of preference.
 * @returns The first existing path, or `null` when none exist.
 */
function firstExisting(root: string, candidates: string[]): string | null {
  for (const c of candidates) {
    if (existsSync(join(root, c))) {
      return join(root, c);
    }
  }
  return null;
}

/**
 * Compute the absolute path to the built-in schemas directory shipped
 * with the CLI.
 *
 * @param metaUrl The `import.meta.url` of the calling module.
 * @returns Absolute path to the existing `schemas/built-in` directory.
 * @throws {Error} If no `package.json` is found in any ancestor
 *                 directory of the calling module, or if neither the
 *                 built nor the source schemas directory exists on
 *                 disk.
 */
export function resolveBuiltInSchemasDir(metaUrl: string): string {
  const modulePath = fileURLToPath(metaUrl);
  const moduleDir = dirname(modulePath);
  const root = findPackageRoot(moduleDir);
  if (root === null) {
    throw new Error(
      `Could not locate package root from module path: ${modulePath}. ` +
      `No ancestor directory contained ${PACKAGE_MARKER}.`
    );
  }
  const found = firstExisting(root, [
    'schemas/built-in',
    'src/schemas/built-in',
  ]);
  if (found === null) {
    throw new Error(
      `Could not locate built-in schemas directory under package root: ${root}. ` +
      `Expected one of: ${join(root, 'schemas', 'built-in')} or ${join(root, 'src', 'schemas', 'built-in')}.`
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
 *                 directory of the calling module, or if neither the
 *                 built nor the source commands directory exists on
 *                 disk.
 */
export function resolveCommandsDir(metaUrl: string): string {
  const modulePath = fileURLToPath(metaUrl);
  const moduleDir = dirname(modulePath);
  const root = findPackageRoot(moduleDir);
  if (root === null) {
    throw new Error(
      `Could not locate package root from module path: ${modulePath}. ` +
      `No ancestor directory contained ${PACKAGE_MARKER}.`
    );
  }
  const found = firstExisting(root, [
    'commands',
    'src/commands',
  ]);
  if (found === null) {
    throw new Error(
      `Could not locate commands directory under package root: ${root}. ` +
      `Expected one of: ${join(root, 'commands')} or ${join(root, 'src', 'commands')}.`
    );
  }
  return found;
}
