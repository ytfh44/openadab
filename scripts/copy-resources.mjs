#!/usr/bin/env node
/**
 * Build resource copy script.
 *
 * The TypeScript compiler only emits `.ts`/`.js`/`.d.ts` files into
 * `dist/`; it does not copy non-code assets such as the built-in schema
 * YAML files under `src/schemas/built-in/` or the host-adapter command
 * definitions under `src/commands/`.  Without this script the compiled
 * CLI cannot locate those resources at runtime and `update`, `init`,
 * and other commands fail.
 *
 * This script is pure Node.js (no external dependencies) and is invoked
 * automatically by `pnpm build` and `pnpm prepare`.  It can also be
 * executed directly for ad-hoc verification:
 *
 *     node scripts/copy-resources.mjs
 *
 * Override the project root for testing or non-standard checkouts via
 * the `OPENADAB_PROJECT_ROOT` environment variable.
 */
import { copyFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Default project root: parent directory of `scripts/`.
 */
const DEFAULT_PROJECT_ROOT = resolve(__dirname, '..');

/**
 * Return the list of resource directories that need to be copied from
 * `src/` to `dist/` after a `tsc` build.
 *
 * @param {string} projectRoot Absolute path to the OpenAdab package root.
 * @returns {Array<{src: string, dest: string}>} List of source/dest pairs.
 */
function getCopyTargets(projectRoot) {
  const src = join(projectRoot, 'src');
  const dist = join(projectRoot, 'dist');
  return [
    {
      src: join(src, 'schemas', 'built-in'),
      dest: join(dist, 'schemas', 'built-in'),
    },
    {
      src: join(src, 'commands'),
      dest: join(dist, 'commands'),
    },
  ];
}

/**
 * Recursively copy the contents of `src` into `dest`, creating `dest`
 * if necessary.  Existing files in `dest` are overwritten so the
 * operation is idempotent.
 *
 * This is a deliberate re-implementation of `fs.cp({ recursive, force })`
 * so the script depends only on `node:fs/promises` and behaves
 * identically on every supported Node version.
 *
 * @param {string} src Absolute path of the source directory.
 * @param {string} dest Absolute path of the destination directory.
 * @returns {Promise<{src: string, dest: string, skipped: boolean}>}
 *   A description of what was done.  `skipped` is `true` when the
 *   source did not exist, in which case nothing was copied.
 */
export async function copyDirectoryRecursive(src, dest) {
  if (!existsSync(src)) {
    return { src, dest, skipped: true };
  }
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = join(src, entry.name);
    const destPath = join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDirectoryRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      await copyFile(srcPath, destPath);
    }
  }
  return { src, dest, skipped: false };
}

/**
 * Copy every bundled resource directory from `src/` to `dist/`.
 *
 * Missing source directories are skipped (not treated as errors) so
 * partial source checkouts can still build successfully.
 *
 * @param {string} [projectRoot] Absolute path to the OpenAdab package root.
 *   Defaults to the directory containing `scripts/`.
 * @returns {Promise<Array<{src: string, dest: string, skipped: boolean}>>}
 *   One entry per attempted copy.
 */
export async function run(projectRoot = DEFAULT_PROJECT_ROOT) {
  const targets = getCopyTargets(projectRoot);
  const results = [];
  for (const { src, dest } of targets) {
    const result = await copyDirectoryRecursive(src, dest);
    if (result.skipped) {
      console.warn(`[copy-resources] Skipped (missing source): ${src}`);
    } else {
      console.log(`[copy-resources] Copied: ${src} -> ${dest}`);
    }
    results.push(result);
  }
  return results;
}

/**
 * Detect whether this module is being executed as the main entry point,
 * rather than imported as a library (e.g. by the integration test).
 *
 * `process.argv[1]` is the resolved path of the entry script on
 * supported Node versions.  We compare it (resolved to an absolute
 * path) against this file's location to decide whether to run.
 *
 * @returns {boolean} `true` when this file is the program entry point.
 */
function isMain() {
  if (typeof process.argv[1] !== 'string') {
    return false;
  }
  return resolve(process.argv[1]) === resolve(__filename);
}

if (isMain()) {
  const projectRoot = process.env.OPENADAB_PROJECT_ROOT ?? DEFAULT_PROJECT_ROOT;
  run(projectRoot).catch((err) => {
    console.error('[copy-resources] Failed:', err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
