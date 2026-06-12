/**
 * Base error class for all OpenAdab errors.
 *
 * Provides a structured `code` field so callers can distinguish error types
 * without relying on fragile string matching.
 */
export class AdabError extends Error {
  code: string;

  constructor(message: string, code: string, options?: { cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.code = code;
    this.name = 'AdabError';
  }

  /**
   * Serialise the error for JSON consumers (CLI `--json` output, logs).
   *
   * The default `Error#toJSON` only emits `{}` because the standard
   * `Error` properties (`name`, `message`) are not own-enumerable.  We
   * expose them here along with the OpenAdab-specific `code` so that
   * `JSON.stringify(err)` produces a meaningful, structured payload
   * that downstream automation can branch on.
   *
   * Subclasses inherit this method and the `name` field is read at
   * call-time, so a `ConfigValidationError` serialises with
   * `name: "ConfigValidationError"` and a `UsageError` with
   * `name: "UsageError"` — never the base class name.
   *
   * @returns Plain object with `name`, `code`, and `message` fields.
   */
  toJSON(): { name: string; code: string; message: string } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * Thrown when project configuration fails validation (schema, missing fields,
 * type mismatches, etc.).
 */
export class ConfigValidationError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'CONFIG_VALIDATION_ERROR', options);
    this.name = 'ConfigValidationError';
  }
}

/**
 * Thrown when a workflow schema definition fails validation (duplicate IDs,
 * missing templates, invalid references, etc.).
 */
export class SchemaValidationError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'SCHEMA_VALIDATION_ERROR', options);
    this.name = 'SchemaValidationError';
  }
}

/**
 * Thrown when a cyclic dependency is detected in an artifact graph.
 */
export class CycleDetectedError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'CYCLE_DETECTED', options);
    this.name = 'CycleDetectedError';
  }
}

/**
 * Thrown when parsing a wiki-diff document fails (malformed Markdown,
 * unknown operation type, missing required sections, etc.).
 */
export class WikiDiffParseError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'WIKI_DIFF_PARSE_ERROR', options);
    this.name = 'WikiDiffParseError';
  }
}

/**
 * Thrown when a referenced target (wiki page, artifact, file, etc.) does not
 * exist.
 */
export class TargetNotFoundError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'TARGET_NOT_FOUND', options);
    this.name = 'TargetNotFoundError';
  }
}

/**
 * Thrown when an illegal change status transition is attempted (e.g. moving
 * from *synced* back to *in_progress*).
 */
export class ChangeStatusError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'CHANGE_STATUS_ERROR', options);
    this.name = 'ChangeStatusError';
  }
}

/**
 * Thrown when a variable interpolation fails because a referenced variable
 * is missing from the context.
 */
export class UnresolvedVariableError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'UNRESOLVED_VARIABLE', options);
    this.name = 'UnresolvedVariableError';
  }
}

/**
 * Thrown when a referenced template file does not exist in the schema directory.
 */
export class TemplateNotFoundError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'TEMPLATE_NOT_FOUND', options);
    this.name = 'TemplateNotFoundError';
  }
}

/**
 * Thrown when a wiki-diff operation is missing a required source citation.
 */
export class MissingSourceError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'MISSING_SOURCE', options);
    this.name = 'MissingSourceError';
  }
}

/**
 * Thrown when the user supplied invalid CLI input (missing required
 * argument, mutually-exclusive flags together, malformed value for a
 * custom option parser, etc.).
 *
 * The CLI's `handleError` helper maps `USAGE_ERROR` to a non-zero exit
 * code with a different value from generic errors so that shell wrappers
 * can distinguish "user error, fix the invocation" from "internal
 * failure".  Use this class for any error caused by *how* the user
 * called the tool, not for errors that occur while the tool is doing
 * real work.
 */
export class UsageError extends AdabError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, 'USAGE_ERROR', options);
    this.name = 'UsageError';
  }
}
