/**
 * Internal helper that extracts only the *target* portion of wiki-style links
 * from a Markdown / manuscript string.
 *
 * Two link shapes are recognised:
 * - `[[Target]]`            – bare link
 * - `[[Target|Alias]]`      – aliased link, alias is discarded
 *
 * The captured target group forbids `[`, `]`, `|` and newlines so that
 * pathological aliases (e.g. containing `]`) cannot bleed into the target
 * capture.  The optional alias group allows `]` but is anchored to the
 * first `]]` that follows, preventing the alias from swallowing the closing
 * delimiters.
 *
 * Returns a *non-deduplicated* list of targets in the order they are first
 * encountered.  Deduplication is intentionally left to callers because the
 * original `wiki diff --from` command wants a `Set`-like view, while other
 * potential consumers (e.g. linting) may want every occurrence.
 *
 * The regex carries the `g` flag, which means its `lastIndex` is mutable
 * state shared across calls.  This helper defensively resets `lastIndex` to
 * `0` before each invocation so that interleaved callers (or repeated use
 * of the same module-level regex instance) cannot produce stale results.
 *
 * @param text Raw manuscript / Markdown text to scan.
 * @returns Ordered list of wiki-link targets (empty string entries are
 *          filtered out; whitespace around each target is trimmed).
 */
export const WIKI_LINK_RE = /\[\[([^\[\]|\n]+)(?:\|[^\]\n]*)?\]\]/g;

/**
 * Extract the *target* portion of every `[[…]]` wiki link found in `text`.
 *
 * This is the workhorse used by the `wiki diff --from <manuscript>` command
 * to map links to their backing `wiki/<Target>.md` files.  It must therefore
 * produce the bare target (never `Target|Alias`) so that the subsequent file
 * lookup succeeds for aliased links.
 *
 * @param text Raw manuscript / Markdown text to scan.
 * @returns Ordered list of unique-occurrence targets extracted from `text`.
 */
export function extractWikiTargets(text: string): string[] {
  const out: string[] = [];
  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(text)) !== null) {
    const target = match[1].trim();
    if (target.length > 0) {
      out.push(target);
    }
  }
  return out;
}
