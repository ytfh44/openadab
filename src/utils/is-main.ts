import { fileURLToPath } from 'node:url';

/**
 * Check whether the current module is being executed as the main entry point.
 *
 * In ESM, `process.argv[1]` is the resolved path of the script being run.
 * Compare it to the module's own URL to determine if this module was invoked
 * directly (e.g., `node dist/index.js` or `openadab` CLI) versus imported by
 * another module (e.g., test runner, REPL, embedded usage).
 *
 * @param metaUrl The `import.meta.url` of the calling module.
 * @returns `true` if this module is the main entry point.
 */
export function isMain(metaUrl: string): boolean {
  return process.argv[1] === fileURLToPath(metaUrl);
}
