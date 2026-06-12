import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Check whether the current module is being executed as the main entry point.
 *
 * In ESM, `process.argv[1]` is the resolved path of the script being run.
 * Compare it to the module's own URL to determine if this module was invoked
 * directly (e.g., `node dist/index.js` or `openadab` CLI) versus imported by
 * another module (e.g., test runner, REPL, embedded usage).
 *
 * Three robustness layers are applied so the comparison works in
 * realistic deployments:
 *
 *  1. **Path normalisation** — `realpathSync` is used on both sides so
 *     symlinks, `./` segments, and trailing separators are resolved
 *     the same way.  This is what makes
 *     `node ./Dist/Index.js` and `node ./dist/index.js` agree on
 *     Windows where the filesystem is case-insensitive.
 *  2. **Case-insensitive comparison on Windows** — `process.platform
 *     === 'win32'` triggers a `toLowerCase()` comparison so a launcher
 *     that typed `Dist\Index.js` (capitalised) still resolves to the
 *     same entry point as the canonical `dist/index.js` the module
 *     was registered under.
 *  3. **Missing argv[1] is safe** — `node --eval` leaves `argv[1]`
 *     `undefined`; the comparison simply returns `false` because no
 *     string ever equals `undefined` after realpathSync normalisation.
 *     This is the correct answer: a `--eval` snippet that imports
 *     this module is not the main entry point.
 *
 * @param metaUrl The `import.meta.url` of the calling module.
 * @returns `true` if this module is the main entry point.
 */
export function isMain(metaUrl: string): boolean {
  const arg1 = process.argv[1];
  if (typeof arg1 !== 'string' || arg1.length === 0) {
    return false;
  }
  const self = fileURLToPath(metaUrl);
  let realSelf: string;
  let realArg: string;
  try {
    realSelf = realpathSync(self);
  } catch {
    realSelf = self;
  }
  try {
    realArg = realpathSync(arg1);
  } catch {
    realArg = arg1;
  }
  if (process.platform === 'win32') {
    return realSelf.toLowerCase() === realArg.toLowerCase();
  }
  return realSelf === realArg;
}
