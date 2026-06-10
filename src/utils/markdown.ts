import matter from 'gray-matter';

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
 * @param content Raw Markdown content.
 * @returns Parsed frontmatter and body.
 */
export function extractFrontmatter(content: string): FrontmatterResult {
  const parsed = matter(content);
  return {
    data: parsed.data,
    content: parsed.content,
  };
}

/**
 * Extract all wiki-style links (`[[...]]`) from a Markdown string.
 *
 * Supports links with or without display text (`[[Target|Display]]`).
 * Only the target portion is returned.
 *
 * @param content Markdown content.
 * @returns Array of link targets (deduplicated, in order of first appearance).
 */
export function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  const targets: string[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  while ((match = regex.exec(content)) !== null) {
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
 * @param content Markdown content.
 * @param heading Exact heading text to match (without leading `#`).
 * @returns The extracted section, or `null` if the heading is not found.
 */
export function extractSectionsByHeading(content: string, heading: string): string | null {
  const lines = content.split('\n');
  const headingPattern = new RegExp(`^(#{1,6})\\s*${escapeRegex(heading)}\\s*$`);

  let startIndex = -1;
  let headingLevel = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(headingPattern);
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
  for (let i = startIndex + 1; i < lines.length; i++) {
    const lineMatch = /^(#{1,6})\s/.exec(lines[i]);
    if (lineMatch && lineMatch[1].length <= headingLevel) {
      endIndex = i;
      break;
    }
  }

  const sectionLines = lines.slice(startIndex + 1, endIndex);
  const section = sectionLines.join('\n').trim();
  return section.length > 0 ? section : '';
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
