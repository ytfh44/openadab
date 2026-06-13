/**
 * Types for the Schema Workbench (Section 10).
 *
 * These describe the CLI output of schema commands and the internal
 * schema definition structure parsed from YAML.
 */

/** A single schema entry returned by `schema list --json`. */
export interface SchemaEntry {
  /** Schema directory name / identifier. */
  name: string;
  /** Human-readable description, if available. */
  description?: string;
  /** Schema version number. */
  version?: number;
  /** Number of artifacts in the schema. */
  artifactCount?: number;
  /** Whether the schema is built-in (shipped with the CLI). */
  builtin?: boolean;
}

/**
 * Response from `schema list --json`.
 * The actual CLI returns `{ schemas: string[], activeSchema: string }`,
 * but we also support richer entries when the schema metadata is available.
 */
export interface SchemaListResponse {
  /** Array of schema names or richer schema entry objects. */
  schemas: (string | SchemaEntry)[];
  /** Name of the currently active schema, or empty string. */
  activeSchema?: string;
}

/** A single artifact definition within a schema. */
export interface SchemaArtifactDef {
  /** Unique artifact identifier. */
  id: string;
  /** The file this artifact generates. */
  generates: string;
  /** IDs of artifacts this artifact depends on. */
  requires: string[];
  /** Path to a template file, if any. */
  template?: string;
  /** Inline instruction text. */
  instruction?: string;
  /** Path to an instruction file. */
  instructionFile?: string;
  /** Context budget in tokens. */
  contextBudget?: number;
  /** Whether this artifact is required (vs. optional). */
  required?: boolean;
  /** Validation rules. */
  validation?: {
    mechanical?: string[];
    semantic?: string[];
  };
}

/** A full schema definition returned by `schema show <name> --json`. */
export interface SchemaDefinition {
  /** Schema name. */
  name: string;
  /** Schema version number. */
  version: number;
  /** Human-readable description. */
  description?: string;
  /** Schema-level context variables. */
  context?: Record<string, string | number | boolean>;
  /** Artifacts defined in this schema. */
  artifacts: SchemaArtifactDef[];
  /** Apply configuration (how to apply the change). */
  apply?: {
    requires: string[];
    target: string;
    action?: 'copy' | 'move';
  };
}

/**
 * Response from `schema validate <path> --json`.
 */
export interface SchemaValidateResponse {
  /** Whether all validation checks passed. */
  passed: boolean;
  /** List of error messages if validation failed. */
  errors: string[];
}

/**
 * Response from `schema fork <base> <name> --json`.
 */
export interface SchemaForkResponse {
  /** Whether the fork operation succeeded. */
  success: boolean;
  /** The base schema name. */
  base: string;
  /** The new forked schema name. */
  name: string;
}
