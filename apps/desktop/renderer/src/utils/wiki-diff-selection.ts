/**
 * Pure helpers for selecting and serializing wiki-diff operations.
 *
 * The desktop review UI must treat operations as operation records, not page
 * targets. A single target page can have several independent operations, and a
 * user must be able to include or exclude each operation without affecting the
 * others.
 *
 * Operation identity is based on stable fields (target, type, source, payload)
 * so that selections survive re-fetching or reordering of the operation list.
 */

import type { WikiDiffOperation as WikiDiffOp } from '../types/inspector.js';

/**
 * Build a stable selection key for one wiki-diff operation.
 *
 * The key is derived from the operation's intrinsic identity fields
 * (target, type, source, payload). It does not depend on list position,
 * so selections remain valid across fetches and reorders.
 *
 * @param operation - Operation shown in the review table.
 * @returns Unique key for this review session.
 */
export function wikiDiffOperationKey(operation: WikiDiffOp): string {
  return [
    operation.target,
    operation.type,
    operation.source,
    JSON.stringify(operation.payload),
  ].join('::');
}

/**
 * Build the default selection set for a fresh wiki-diff response.
 *
 * @param operations - Operations returned by \openadab wiki diff --json\.
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
 * @param operations - Operations returned by \openadab wiki diff --json\.
 * @param checkedOperationKeys - Keys selected by the review UI.
 * @returns Operations whose own key is selected.
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
 * Build a CLI-loadable filtered wiki-diff document.
 *
 * @param changeId - Change id associated with the review.
 * @param operations - Operations to include in the temporary diff document.
 * @returns JSON string accepted by \openadab wiki apply-diff\.
 */
export function buildFilteredWikiDiffDocument(
  changeId: string,
  operations: WikiDiffOp[],
): string {
  return JSON.stringify({ changeId, operations }, null, 2);
}