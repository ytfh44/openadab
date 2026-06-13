/**
 * Schema-generic types for the Changes Workbench.
 *
 * These types describe the JSON output of `openadab status --change <id> --json`
 * and related CLI commands. All artifact identity, status, dependencies, and
 * validation information is parsed from CLI output without hardcoding any
 * specific artifact names or schema structures.
 */

/**
 * A single validation message (error or warning) attached to an artifact.
 */
export interface ValidationMessage {
  /** Human-readable description of the validation issue. */
  message: string;
  /** Optional field or path the message refers to. */
  field?: string;
}

/**
 * Validation results grouped by severity.
 */
export interface ValidationResult {
  /** Errors that prevent the artifact from passing validation. */
  errors?: ValidationMessage[];
  /** Warnings that do not block but should be reviewed. */
  warnings?: ValidationMessage[];
}

/**
 * Information about the next workflow step for an artifact.
 */
export interface NextStep {
  /**
   * If present, CLI reports that this change/artifact is ready to be applied.
   * The value identifies the apply target (e.g. "manuscript").
   */
  applyTarget?: string;
  /** Human-readable instruction for the next step. */
  instruction?: string;
}

/**
 * Status of a single artifact within a change.
 *
 * Parsed from the status JSON array produced by
 * `openadab status --change <id> --json`.
 */
export interface ArtifactStatus {
  /** Unique artifact identifier within the schema (e.g. "brief", "outline"). */
  id: string;
  /**
   * Workflow status.
   * - "blocked": cannot proceed until dependencies are satisfied.
   * - "ready": all dependencies satisfied; artifact is ready to work on.
   * - "done": artifact file exists and is complete.
   * - "optional": artifact is not required for this change.
   */
  status: 'blocked' | 'ready' | 'done' | 'optional';
  /**
   * Path to the generated artifact file relative to the project root,
   * or null if the file does not yet exist.
   */
  generatedFile?: string | null;
  /** IDs of artifacts this artifact depends on. */
  dependencies?: string[];
  /** Validation issues reported by the CLI for this artifact. */
  validations?: ValidationResult;
  /** Issues that prevent this artifact from being worked on. */
  blockingIssues?: string[];
  /** Next-step information, including whether the change is apply-ready. */
  nextStep?: NextStep;
}

/**
 * Top-level status response from `openadab status --change <id> --json`.
 */
export interface ChangeStatus {
  /** The change identifier. */
  changeId: string;
  /** All artifacts in the change workflow, with their current state. */
  artifacts: ArtifactStatus[];
  /** Schema type used for this change (e.g. "chapter-draft"). */
  schemaType?: string;
}

/**
 * Response from `openadab new <type> <id> --json`.
 */
export interface NewChangeResult {
  /** The type of change that was created. */
  type: string;
  /** The ID of the newly created change. */
  id: string;
  /** Path to the change directory relative to the project root. */
  path: string;
}

/**
 * Status color mapping.
 */
export const STATUS_COLORS: Record<ArtifactStatus['status'], {
  border: string;
  bg: string;
  text: string;
  dot: string;
  label: string;
}> = {
  blocked: {
    border: '#fecaca',
    bg: '#fef2f2',
    text: '#991b1b',
    dot: '#ef4444',
    label: 'Blocked',
  },
  ready: {
    border: '#fde68a',
    bg: '#fffbeb',
    text: '#92400e',
    dot: '#f59e0b',
    label: 'Ready',
  },
  done: {
    border: '#bbf7d0',
    bg: '#f0fdf4',
    text: '#166534',
    dot: '#22c55e',
    label: 'Done',
  },
  optional: {
    border: '#e5e7eb',
    bg: '#f9fafb',
    text: '#6b7280',
    dot: '#9ca3af',
    label: 'Optional',
  },
};
