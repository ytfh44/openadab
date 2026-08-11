import matter from 'gray-matter';
import YAML from 'yaml';

import { WikiDiffParseError } from './errors.js';
import { WIKI_LINK_RE } from './wiki-link-regex.js';

/**
 * YAML frontmatter parse engine backed by the `yaml` package instead of
 * gray-matter's bundled js-yaml.
 *
 * js-yaml 3.x (gray-matter's pinned dependency) has a high-severity
 * ReDoS advisory (quadratic CPU in `!!omap` resolution) with no fixed
 * 3.x release, and gray-matter cannot move to js-yaml 4 (it binds
 * `safeLoad` at module load, which 4.x removed). Passing a custom
 * engine per call keeps gray-matter's fence handling while routing the
 * actual YAML parsing through the `yaml` package (already a direct
 * dependency, unaffected by the advisory).
 *
 * @param str Raw frontmatter body.
 * @returns Parsed frontmatter object (never null/undefined).
 */
function yamlParseEngine(str: string): Record<string, unknown> {
  const parsed: unknown = YAML.parse(str);
  if (parsed === null || parsed === undefined || typeof parsed !== 'object' || Array.isArray(parsed)) {
    // Empty block or a bare-scalar frontmatter: every consumer here
    // expects an object, so degrade to an empty object like an empty
    // frontmatter block.
    return {};
  }
  return parsed as Record<string, unknown>;
}

/**
 * Parse Markdown with YAML frontmatter using the safe `yaml` engine.
 *
 * Only the parse path is swapped: stringify keeps gray-matter's default
 * js-yaml dump, which is unaffected by the advisory.
 *
 * @param content Raw Markdown content.
 * @returns The gray-matter parse result (data + content + …).
 */
export function matterWithSafeYaml(content: string): ReturnType<typeof matter> {
  return matter(content, {
    engines: {
      yaml: {
        parse: yamlParseEngine,
        stringify: (data: object): string => YAML.stringify(data),
      },
    },
  });
}

export interface FrontmatterResult {
  /** Parsed frontmatter data. */
  data: Record<string, unknown>;
  /** Document body without frontmatter. */
  content: string;
}

/**
 * Extract YAML frontmatter and body from a Markdown string.
 *
 * Uses `gray-matter` under the hood.  If no frontmatter is present,
 * `data` will be an empty object and `content` will equal the input.
 *
 * Parse errors are caught and re-thrown as {@link WikiDiffParseError}
 * with the original error preserved on the `cause` chain, so callers
 * can branch on a structured code (`WIKI_DIFF_PARSE_ERROR`) instead of
 * the raw frontmatter exception.
 *
 * @param content Raw Markdown content.
 * @returns Parsed frontmatter and body.
 */
export function extractFrontmatter(content: string): FrontmatterResult {
  let parsed: ReturnType<typeof matter>;
  try {
    parsed = matterWithSafeYaml(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new WikiDiffParseError(
      `Failed to parse YAML frontmatter: ${msg}`,
      { cause: err instanceof Error ? err : undefined },
    );
  }
  return {
    data: parsed.data,
    content: parsed.content,
  };
}

/**
 * Strip fenced code blocks from `text`, replacing them with an
 * equivalent number of newlines so downstream line numbers are not
 * disturbed.
 *
 * Recognises the two CommonMark fence characters (backtick and tilde),
 * any opening fence length ≥ 3, and closes on the first line whose
 * leading whitespace is followed by the same fence character repeated
 * at least as many times as the opener.
 *
 * Indented (4-space) code blocks are *not* stripped — they are rare
 * in prose and stripping them risks eating indented lists.  Callers
 * that need to honour them should pass the result through a real
 * Markdown parser.
 *
 * @param text Markdown text.
 * @returns Text with fenced code blocks replaced by newlines.
 */
function stripFencedCode(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (const line of lines) {
    const trimmed = line.replace(/^\s*/, '');
    if (!inFence) {
      // Match the opener against the ORIGINAL line so the `{0,3}`
      // leading-space constraint is real: a 4+-space-indented fence is
      // an indented code block (CommonMark), not a fence, and must be
      // left untouched.
      const openMatch = /^( {0,3})(`{3,}|~{3,})/.exec(line);
      if (openMatch) {
        inFence = true;
        fenceChar = openMatch[2][0];
        fenceLen = openMatch[2].length;
        out.push('');
        continue;
      }
      out.push(line);
    } else {
      const closeMatch = new RegExp(`^\\s*${fenceChar}{${String(fenceLen)},}\\s*$`).exec(trimmed);
      if (closeMatch) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
        out.push('');
        continue;
      }
      out.push('');
    }
  }
  return out.join('\n');
}

/**
 * Strip inline code spans from `text`, replacing each span with empty
 * string of the same length bucket (we keep them out of the result so
 * wiki-link extraction skips them).
 *
 * The implementation honours CommonMark's "balanced backticks" rule:
 * the opening fence is a run of N backticks and the matching closer
 * is a run of at least N backticks.  When the closer is longer than
 * the opener, the excess backticks (closeLen - N) are kept as literal
 * content, per CommonMark.  This correctly handles the case
 * `` ``code with a ` backtick inside`` `` that the old single-backtick
 * regex would misparse.
 *
 * @param text Markdown text.
 * @returns Text with inline code spans removed.
 */
export function stripInlineCode(text: string): string {
  let out = '';
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '`') {
      out += text[i];
      i++;
      continue;
    }
    let run = 0;
    while (i + run < text.length && text[i + run] === '`') {
      run++;
    }
    if (run === 0) {
      out += text[i];
      i++;
      continue;
    }
    // Find the matching closer: at least `run` backticks, not preceded
    // by another backtick (otherwise it's a longer run we should be
    // treating as the opener).
    let j = i + run;
    let found = -1;
    let closeLen = 0;
    while (j < text.length) {
      if (text[j] === '`') {
        closeLen = 0;
        while (j + closeLen < text.length && text[j + closeLen] === '`') {
          closeLen++;
        }
        if (closeLen >= run) {
          found = j;
          break;
        }
        j += closeLen;
        continue;
      }
      j++;
    }
    if (found === -1) {
      // No matching closer — treat the run as literal text and move on.
      out += text.slice(i, i + run);
      i += run;
      continue;
    }
    // Drop the code span (opener + content + closer).  A closer run
    // longer than the opener leaves its excess backticks as literal
    // content, e.g. `` `a`` `` (opener 1, closer 2) keeps one backtick.
    out += '`'.repeat(closeLen - run);
    i = found + closeLen;
  }
  return out;
}

/**
 * Extract all wiki-style links (`[[...]]`) from a Markdown string.
 *
 * Supports links with or without display text (`[[Target|Display]]`).
 * Only the target portion is returned. Wiki links inside inline code
 * (backticks, including balanced multi-backtick spans), fenced code
 * blocks (``` ``` ``` ``` or ``` ~~~ ```), and HTML `<code>` tags are
 * excluded.
 *
 * This helper shares the {@link WIKI_LINK_RE} constant with
 * `utils/wiki-link-regex.ts`, so both tools agree on which substrings
 * count as a wiki link.  They deliberately differ in the *surrounding*
 * behaviour: this wrapper strips code fences and deduplicates, while
 * `extractWikiTargets` keeps every occurrence.
 *
 * @param content Markdown content.
 * @returns Array of link targets (deduplicated, in order of first appearance).
 */
export function extractWikiLinks(content: string): string[] {
  const withoutCode = stripInlineCode(
    stripFencedCode(content).replace(/<code[^>]*>[\s\S]*?<\/code>/gi, '')
  );
  const targets: string[] = [];
  const seen = new Set<string>();

  WIKI_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKI_LINK_RE.exec(withoutCode)) !== null) {
    const target = match[1].trim();
    if (target && !seen.has(target)) {
      seen.add(target);
      targets.push(target);
    }
  }

  return targets;
}

/**
 * Extract the content under a specific Markdown heading.
 *
 * The heading line itself is excluded from the returned content.  The extracted
 * block runs from the line after the heading up to (but not including) the next
 * heading of the same or higher level, or the end of the document.
 *
 * The returned string preserves the original document's line breaks (no
 * `.trim()` is applied to the joined lines), so callers that need to
 * splice content back in via `body.indexOf(section) + section.length`
 * can do so without losing the surrounding newlines.  When the heading
 * exists but the section is empty, `null` is returned (not `""`) so
 * callers can distinguish "heading not found" from "heading found
 * with empty body".
 *
 * Only ATX headings (`#`, `##`, …) are matched — Setext-style
 * underlines (===, ---) and ATX headings with trailing `#` are
 * intentionally not recognised, matching the spec's "Exact heading
 * text" contract.
 *
 * Heading-pattern lines inside fenced code blocks (``` or ~~~,
 * following the same fence rules as `stripFencedCode`) do not
 * terminate the section — only real top-level headings do. Without
 * this, a code sample containing a `## …` line silently truncated
 * the section at that line.
 *
 * trailing HTML comments (e.g. `## Heading <!-- note -->`) are
 * tolerated by the matching pattern, so documentation-style annotations
 * on a heading do not prevent the section from being recognised.
 *
 * the prior implementation trimmed the joined section, which
 * meant downstream `body.indexOf(section)` could not always locate the
 * exact end of the original block (the trim removed the very newline
 * the consumer relied on to compute its insertion point).
 *
 * @param content Markdown content.
 * @param heading Exact heading text to match (without leading `#`).
 * @returns The extracted section preserving original line breaks, or
 *          `null` if the heading is not found *or* the section is empty.
 */
export function extractSectionsByHeading(content: string, heading: string): string | null {
  const lines = content.split('\n');
  // allow an optional trailing HTML comment after the heading text.
  // The `m` flag makes `^` and `$` match per-line boundaries, so headings
  // past the first line of the document are recognised.
  const headingPattern = new RegExp(
    `^(#{1,6})\\s*${escapeRegex(heading)}\\s*(?:<!--[\\s\\S]*?-->)?\\s*$`,
    'm',
  );

  let startIndex = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = headingPattern.exec(lines[i]);
    if (match) {
      startIndex = i;
      headingLevel = match[1].length;
      break;
    }
  }

  if (startIndex === -1) {
    return null;
  }

  let endIndex = lines.length;
  // Track fenced code blocks (same rules as `stripFencedCode`: opener
  // is ≥3 backticks/tildes with ≤3 leading spaces, closer is the same
  // char repeated ≥ opener length) so heading-looking lines inside a
  // fence do not truncate the section. The heading that started this
  // scan is real (the scan before it was at top level), so only the
  // terminator loop needs fence tracking.
  let inFence = false;
  let fenceChar = '';
  let fenceLen = 0;
  for (let i = startIndex + 1; i < lines.length; i++) {
    const trimmed = lines[i].replace(/^\s*/, '');
    if (inFence) {
      const closeMatch = new RegExp(`^\\s*${fenceChar}{${String(fenceLen)},}\\s*$`).exec(trimmed);
      if (closeMatch) {
        inFence = false;
        fenceChar = '';
        fenceLen = 0;
      }
      continue;
    }
    const openMatch = /^( {0,3})(`{3,}|~{3,})/.exec(trimmed);
    if (openMatch) {
      inFence = true;
      fenceChar = openMatch[2][0];
      fenceLen = openMatch[2].length;
      continue;
    }
    const lineMatch = /^(#{1,6})\s/.exec(lines[i]);
    if (lineMatch && lineMatch[1].length <= headingLevel) {
      endIndex = i;
      break;
    }
  }

  const sectionLines = lines.slice(startIndex + 1, endIndex);
  // do NOT trim.  Preserve the original trailing newlines so that
  // `content.indexOf(section) + section.length` is the exact insertion
  // point a caller needs.
  const section = sectionLines.join('\n');
  if (section.length === 0) {
    return null;
  }
  return section;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
