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
