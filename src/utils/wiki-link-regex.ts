/**
 * Shared wiki-link regex constant.
 *
 * This single `RegExp` instance is the **canonical** shape used by every
 * tool that needs to recognise `[[Target]]` / `[[Target|Alias]]` links in
 * a Markdown body.  Centralising it here keeps {@link extractWikiTargets}
 * (this file) and {@link import("./markdown.js").extractWikiLinks}
 * (markdown.ts) in lock-step — the two helpers are allowed to differ in
 * what they do *around* the match (deduplication, code-fence stripping),
 * but they MUST agree on which substrings count as a wiki link, otherwise
 * the context packer and the mention indexer can disagree on which
 * targets exist in a file.
 *
 * Two link shapes are recognised:
 * - `[[Target]]`            – bare link
 * - `[[Target|Alias]]`      – aliased link, alias is discarded
 *
 * The captured target group forbids `[`, `]`, `|` and newlines so that
 * pathological aliases (e.g. containing `]`) cannot bleed into the
 * target capture.  The optional alias group allows `]` but is anchored
 * to the first `]]` that follows, preventing the alias from swallowing
 * the closing delimiters.
 *
 * The regex carries the `g` flag, which means its `lastIndex` is mutable
 * state shared across calls.  Helpers that consume it MUST defensively
 * reset `lastIndex` to `0` before each invocation so that interleaved
 * callers (or repeated use of the same module-level regex instance)
 * cannot produce stale results.
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
 * ## Difference from `markdown.extractWikiLinks`
 *
 * The two helpers intentionally diverge on two points:
 *
 * 1. **Code-fence stripping**: this helper does NOT strip inline `` ` ``
 *    code or `<code>` blocks.  If you need that behaviour, use
 *    `extractWikiLinks` from `markdown.ts`, which is the higher-level
 *    helper used by the wiki engine when scanning page bodies.
 * 2. **Deduplication**: this helper returns every occurrence in order;
 *    `extractWikiLinks` deduplicates by target name.
 *
 * The mention indexer (modules/mention-indexer) has its own dedicated
 * pattern in `buildRegexPattern` and does NOT use this constant
 * directly — that pattern handles name + alias matching with word
 * boundaries, which is a different problem from wiki-link extraction.
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
