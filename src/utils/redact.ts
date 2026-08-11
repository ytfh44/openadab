/**
 * Config value redaction utilities.
 *
 * Centralises the policy for which config paths are considered sensitive so
 * that the CLI log writer can mask secrets before persisting audit entries
 * to `adab/log.md`. Without redaction, the log would record plaintext
 * tokens, API keys, and passwords entered via `openadab config set ...`.
 *
 * Redaction policy (case-insensitive on both the path segments and the
 * leaf key):
 *   - Any path containing a `secrets` (or `secret`) segment is fully
 *     redacted, regardless of value shape.
 *   - Any path whose leaf key matches a known sensitive suffix
 *     (`token`, `apikey`, `password`, `privatekey`, `credentials`,
 *     `auth`, `authorization`) is fully redacted.
 *
 * Non-sensitive values are returned unchanged so non-secret config
 * updates (e.g. `project.pov`, `context.maxTokens`) still appear in
 * the audit trail in cleartext.
 */
const REDACTED_PLACEHOLDER = '***';

/**
 * Lower-cased leaf-key suffixes that mark a config path as sensitive.
 *
 * The leaf (last path segment) is matched by SUFFIX against this set:
 * `service.authToken` is sensitive because `authtoken` ends with
 * `token`; `openai.apiKey` is sensitive because `apikey` ends with
 * `apikey`. `api.tokenType` is NOT sensitive by leaf-key alone
 * (`tokentype` ends with neither `token` nor any other suffix). Use
 * the `secrets` segment to redact whole subtrees.
 */
const SENSITIVE_LEAF_KEYS: ReadonlySet<string> = new Set([
  'token',
  'apikey',
  'password',
  'privatekey',
  'credentials',
  'auth',
  'authorization',
]);

/**
 * Determine whether a config path should be redacted in audit logs.
 *
 * Performs two independent checks (case-insensitive):
 *   1. Path contains a `secrets` or `secret` segment anywhere.
 *   2. The leaf (last) segment ends with a known sensitive suffix
 *      (e.g. `token`, `apikey`, `password`).
 *
 * @param path Dot-separated config path (e.g. `secrets.apiKey`).
 * @returns `true` when the value at `path` must be redacted.
 */
export function isSensitiveConfigPath(path: string): boolean {
  const segments = path.toLowerCase().split('.');
  if (segments.includes('secrets') || segments.includes('secret')) {
    return true;
  }
  const leaf = segments[segments.length - 1];
  for (const key of SENSITIVE_LEAF_KEYS) {
    if (leaf.endsWith(key)) {
      return true;
    }
  }
  return false;
}

/**
 * Redact a config value before persisting it to `adab/log.md`.
 *
 * Returns the literal placeholder string {@link REDACTED_PLACEHOLDER}
 * for any sensitive path, regardless of value type. Non-sensitive
 * values are returned unchanged so legitimate config updates remain
 * visible in the audit log.
 *
 * @param path  Dot-separated config path the value is being assigned to.
 * @param value The value that was just persisted to `adab/config.yaml`.
 * @returns The value to record in the log (redacted or verbatim).
 */
export function redactConfigValue(path: string, value: unknown): unknown {
  if (isSensitiveConfigPath(path)) {
    return REDACTED_PLACEHOLDER;
  }
  return value;
}

/**
 * The placeholder string written in place of a redacted value.
 *
 * Exposed so tests and other tools can assert redaction without
 * hard-coding the literal.
 */
export const REDACTED_VALUE = REDACTED_PLACEHOLDER;
