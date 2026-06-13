/**
 * Type definitions for the Inspector panel data.
 *
 * These types describe the JSON output shapes of the CLI commands
 * used by the Inspector: context pack, validation, and wiki diff.
 * All types are parsed generically from CLI stdout without
 * hardcoding any specific artifact names or schema structures.
 */

/**
 * A single context pack item from
 * `openadab context pack --change <id> --artifact <id> --json`.
 */
export interface ContextPackItem {
  /** File path relative to project root. */
  file: string;
  /** Reason this file was included (or excluded). */
  reason: string;
  /** Estimated token count, if available. */
  tokens?: number;
  /** Whether the index used for selection is stale. */
  stale?: boolean;
}

/**
 * Response shape from `openadab context pack --change <id> --artifact <id> --json`.
 */
export interface ContextPackResponse {
  /** Files that must be read for this artifact. */
  mustRead: ContextPackItem[];
  /** Files that are optional/recommended. */
  optional: ContextPackItem[];
  /** Files that were considered but excluded. */
  excluded: ContextPackItem[];
  /** Total estimated token count for all must-read files, if available. */
  estimatedSize?: number;
  /** Whether a stale index warning should be shown. */
  staleIndexWarning?: boolean;
}

/**
 * A single mechanical validation error from
 * `openadab validate --change <id> --mechanical --json`.
 */
export interface ValidationError {
  /** File path relative to project root. */
  file: string;
  /** Line number where the error occurred, if known. */
  line?: number;
  /** Human-readable error message. */
  message: string;
}

/**
 * Response shape from `openadab validate --change <id> --mechanical --json`.
 */
export interface MechanicalValidationResponse {
  /** Whether all mechanical checks passed. */
  passed: boolean;
  /** List of errors, empty if passed. */
  errors: ValidationError[];
}

/**
 * A single wiki-diff operation from
 * `openadab wiki diff --change <id> --json`.
 */
export interface WikiDiffOperation {
  /** Target wiki page identifier. */
  target: string;
  /** Operation type (e.g. "create", "update", "delete"). */
  type: string;
  /** Source of the diff operation. */
  source: string;
  /** Operation payload (content to apply). */
  payload: unknown;
  /** Warnings associated with this operation. */
  warnings?: string[];
}

/**
 * Response shape from `openadab wiki diff --change <id> --json`.
 */
export interface WikiDiffResponse {
  /** List of wiki-diff operations. */
  operations: WikiDiffOperation[];
  /** Whether this is a dry-run (no changes applied). */
  dryRun?: boolean;
}

/** Empty state message for a card. */
export type InspectorCardState =
  | { kind: 'empty'; message: string }
  | { kind: 'loading' }
  | { kind: 'error'; message: string; onRetry: () => void }
  | { kind: 'loaded' };
