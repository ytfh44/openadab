/**
 * Pure helpers for selecting and serializing wiki-diff operations.
 *
 * The desktop review UI must treat operations as operation records, not page
 * targets. A single target page can have several independent operations, and a
 * user must be able to include or exclude each operation without affecting the
 * others.
 *
 * Operation identity is based on the per-operation triplet (target page,
 * operation type, source artifact). Selections survive re-fetching and
 * reordering of the operation list.
 *
 * The temporary diff file format matches the CLI output of
 * `openadab wiki diff --json` so that `openadab wiki apply-diff --file <temp>`
 * accepts it directly.
 */

import type { WikiDiffOperation as WikiDiffOp } from '../types/inspector.js';

/**
 * Shape written to the temporary diff file consumed by the CLI.
 *
 * Mirrors WikiDiffResponse from inspector types so that
 * `openadab wiki apply-diff --file <temp>` accepts the file.
 */
export interface WikiDiffFilePayload {
  /** List of wiki-diff operations to apply. */
  operations: WikiDiffOp[];
}

/**
 * Build a stable selection key for one wiki-diff operation.
 *
 * The key is derived from the operation's identity triplet (target page,
 * operation type, source artifact). It does not depend on list position or
 * payload content, so selections remain valid across fetches and reorders.
 *
 * Two operations targeting the same page with the same type and source are
 * treated as the same operation regardless of payload differences.
 *
 * @param operation - Operation shown in the review table.
 * @returns Stable operation identity key in `${target}::${type}::${source}` form.
 */
export function wikiDiffOperationKey(operation: WikiDiffOp): string {
  return [operation.target, operation.type, operation.source].join('::');
}

/**
 * Build the default selection set for a fresh wiki-diff response.
 *
 * All operations are selected by default so that a no-op review applies
 * everything.
 *
 * @param operations - Operations returned by `openadab wiki diff --json`.
 * @returns One selection key per operation.
 */
export function initialWikiDiffSelectionKeys(
  operations: WikiDiffOp[],
): string[] {
  return operations.map((operation) => wikiDiffOperationKey(operation));
}

/**
 * Filter operations by operation-level selection keys.
 *
 * @param operations - Operations returned by `openadab wiki diff --json`.
 * @param checkedOperationKeys - Keys selected by the review UI.
 * @returns Operations whose own key is selected, in original order.
 */
export function filterWikiDiffOperations(
  operations: WikiDiffOp[],
  checkedOperationKeys: string[],
): WikiDiffOp[] {
  const checkedSet = new Set(checkedOperationKeys);
  return operations.filter((operation) =>
    checkedSet.has(wikiDiffOperationKey(operation)));
}

/**
 * Build a CLI-loadable filtered wiki-diff document string.
 *
 * The output matches the JSON shape of `openadab wiki diff --json` so that
 * the CLI can consume it via `openadab wiki apply-diff --file <temp>`.
 *
 * @param operations - Operations to include in the temporary diff document.
 * @returns JSON string accepted by `openadab wiki apply-diff --file <temp>`.
 */
export function buildFilteredWikiDiffDocument(
  operations: WikiDiffOp[],
): string {
  const payload: WikiDiffFilePayload = { operations };
  return JSON.stringify(payload, null, 2);
}

/**
 * Path components used for the temporary wiki-diff file.
 */
const TMP_DIR_NAME = 'adab';
const TMP_SUBDIR_NAME = '.temp';
const TMP_FILE_PREFIX = 'wiki-diff-selected-';
const TMP_FILE_SUFFIX = '.json';

/**
 * Write a temporary diff file containing only the selected operations.
 *
 * The file is placed under `<projectRoot>/adab/.temp/` so that it is
 * co-located with project state and discoverable by the CLI. The caller is
 * responsible for cleaning up the file after the CLI consumes it.
 *
 * @param operations - Selected wiki-diff operations to include.
 * @param projectRoot - Absolute path to the project root directory.
 * @param fsModule - The Node.js `fs/promises` module (injected for testability).
 * @param pathModule - The Node.js `path` module (injected for testability).
 * @returns Absolute path to the written temporary file.
 */
export async function writeWikiDiffTempFile(
  operations: WikiDiffOp[],
  projectRoot: string,
  fsModule: { mkdir(path: string, opts?: { recursive: boolean }): Promise<unknown>; writeFile(path: string, data: string): Promise<void> },
  pathModule: { join(...segments: string[]): string },
): Promise<string> {
  const tmpDir = pathModule.join(projectRoot, TMP_DIR_NAME, TMP_SUBDIR_NAME);
  await fsModule.mkdir(tmpDir, { recursive: true });
  const timestamp = Date.now();
  const fileName = `${TMP_FILE_PREFIX}${timestamp}${TMP_FILE_SUFFIX}`;
  const filePath = pathModule.join(tmpDir, fileName);
  const content = buildFilteredWikiDiffDocument(operations);
  await fsModule.writeFile(filePath, content);
  return filePath;
}
