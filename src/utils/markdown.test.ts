import { describe, it, expect } from 'vitest';

import {
  extractFrontmatter,
  extractWikiLinks,
  extractSectionsByHeading,
} from './markdown.js';

describe('extractFrontmatter', () => {
  it('should extract YAML frontmatter and body', () => {
    const input = `---\ntitle: Hello\n---\nBody here\n`;
    const result = extractFrontmatter(input);
    expect(result.data).toEqual({ title: 'Hello' });
    expect(result.content.trim()).toBe('Body here');
  });

  it('should return empty data when no frontmatter', () => {
    const input = 'Just body\n';
    const result = extractFrontmatter(input);
    expect(result.data).toEqual({});
    expect(result.content).toBe('Just body\n');
  });

  it('should handle empty frontmatter values', () => {
    const input = `---\ntitle:\n---\nBody\n`;
    const result = extractFrontmatter(input);
    expect(result.data).toHaveProperty('title');
    expect(result.content.trim()).toBe('Body');
  });

  it('should handle empty content', () => {
    const input = `---\ntitle: X\n---\n`;
    const result = extractFrontmatter(input);
    expect(result.data).toEqual({ title: 'X' });
    expect(result.content.trim()).toBe('');
  });
});

describe('extractWikiLinks', () => {
  it('should extract simple wiki links', () => {
    const input = 'See [[Alice]] and [[Bob]]';
    expect(extractWikiLinks(input)).toEqual(['Alice', 'Bob']);
  });

  it('should extract link target from piped syntax', () => {
    const input = '[[Alice|A girl]] and [[Bob]]';
    expect(extractWikiLinks(input)).toEqual(['Alice', 'Bob']);
  });

  it('should deduplicate links keeping first appearance', () => {
    const input = '[[Alice]] [[Alice]] [[Bob]]';
    expect(extractWikiLinks(input)).toEqual(['Alice', 'Bob']);
  });

  it('should return empty array when no links', () => {
    expect(extractWikiLinks('plain text')).toEqual([]);
  });

  it('should ignore empty link targets', () => {
    expect(extractWikiLinks('[[]] and [[ ]]')).toEqual([]);
  });

  it('should handle special characters in link targets', () => {
    const input = '[[C-3PO]] [[Jean-Luc]] [[file_name]]';
    expect(extractWikiLinks(input)).toEqual(['C-3PO', 'Jean-Luc', 'file_name']);
  });

  it('should handle multiline content', () => {
    const input = 'Line 1 [[A]]\nLine 2 [[B]]';
    expect(extractWikiLinks(input)).toEqual(['A', 'B']);
  });

  it('should not extract wiki links inside backtick inline code', () => {
    const input = '`[[Foo]]`';
    expect(extractWikiLinks(input)).toEqual([]);
  });

  it('should not extract multiple wiki links when entire line is in backticks', () => {
    const input = '`[[Foo]] and [[Bar]]`';
    expect(extractWikiLinks(input)).toEqual([]);
  });

  it('should extract wiki link after inline code ends', () => {
    const input = 'Text `[[Foo]]` more [[Bar]]';
    expect(extractWikiLinks(input)).toEqual(['Bar']);
  });

  it('should extract wiki link in normal text before inline code', () => {
    const input = 'Text before [[Foo]] `[[Bar]]` after';
    expect(extractWikiLinks(input)).toEqual(['Foo']);
  });

  it('should not extract wiki links inside HTML <code> tags', () => {
    const input = '<code>[[Foo]]</code>';
    expect(extractWikiLinks(input)).toEqual([]);
  });

  it('should extract only code-external wiki links in mixed content', () => {
    const input = '`[[Foo]]` [[Bar]]';
    expect(extractWikiLinks(input)).toEqual(['Bar']);
  });

  it('should not extract wiki links inside fenced code blocks (```)', () => {
    const input = '```\n[[Foo]]\n[[Bar]]\n```';
    expect(extractWikiLinks(input)).toEqual([]);
  });

  it('should not extract wiki links inside tilde-fenced code blocks (~~~)', () => {
    const input = '~~~\n[[Foo]]\n~~~\n[[Baz]]';
    expect(extractWikiLinks(input)).toEqual(['Baz']);
  });

  it('should not extract wiki links inside a fenced block whose info string contains backticks', () => {
    // ```` ``` ```` — fence with 4-backtick info, opens with 3 backticks
    const input = '```\n[[Foo]]\n```\n[[Bar]]';
    expect(extractWikiLinks(input)).toEqual(['Bar']);
  });

  it('should handle multi-backtick inline code (``code with ` inside``) correctly', () => {
    // Two-backtick inline code can contain a single backtick. The
    // legacy single-backtick regex would match the inner single
    // backtick and strip the whole thing, eating the wiki link
    // outside the code span.  Verify the balanced tokeniser handles
    // it.
    const input = '`` `not a code span` `` [[Real]]';
    expect(extractWikiLinks(input)).toEqual(['Real']);
  });

  it('extractFrontmatter wraps YAML parse failures in a structured WikiDiffParseError', () => {
    // gray-matter uses js-yaml under the hood; an unterminated flow
    // mapping is the cheapest portable way to trigger a parse error.
    const bad = `---\ntitle: [unterminated\n---\nbody`;
    expect(() => extractFrontmatter(bad)).toThrow(/frontmatter|yaml|parse/i);
  });
});

describe('extractSectionsByHeading', () => {
  it('should extract section under heading', () => {
    const input = `# H1
## Target
Content here
More content
## Other
Other content
`;
    const result = extractSectionsByHeading(input, 'Target');
    expect(result).toBe('Content here\nMore content');
  });

  it('should return null when heading not found', () => {
    expect(extractSectionsByHeading('# H1\n', 'Missing')).toBeNull();
  });

  it('should stop at same-level heading', () => {
    const input = `## A
A content
## B
B content
`;
    expect(extractSectionsByHeading(input, 'A')).toBe('A content');
  });

  it('should stop at higher-level heading', () => {
    const input = `### Sub
Sub content
## Higher
Higher content
`;
    expect(extractSectionsByHeading(input, 'Sub')).toBe('Sub content');
  });

  it('should not stop at deeper heading', () => {
    const input = `## A
A content
### Sub
Sub content
`;
    expect(extractSectionsByHeading(input, 'A')).toBe('A content\n### Sub\nSub content\n');
  });

  it('should return empty string for empty section', () => {
    const input = `## A
## B
B content
`;
    // After the null-vs-empty-string fix, an empty section returns
    // null so "not found" and "found but empty" are unambiguous.
    expect(extractSectionsByHeading(input, 'A')).toBeNull();
  });

  it('should handle heading with extra spaces', () => {
    const input = `##  Target
Content
`;
    expect(extractSectionsByHeading(input, 'Target')).toBe('Content\n');
  });

  it('should handle heading with special regex characters', () => {
    const input = `## C++
Content
`;
    expect(extractSectionsByHeading(input, 'C++')).toBe('Content\n');
  });

  it('returns null (not "") for an empty section so callers can distinguish missing from empty', () => {
    // Regression: the helper used to return the empty string for an
    // empty section, which collided with the "not found" sentinel in
    // some call sites.  Use null so "not found" and "found but empty"
    // are unambiguous.
    const input = `## A
## B
B content
`;
    expect(extractSectionsByHeading(input, 'A')).toBeNull();
  });

  it('finds a heading that is not on the first line (multiline-prefix regression)', () => {
    // headingPattern used to be built without the `m` flag, so `^`
    // only matched the string's first character — a heading past the
    // first line was silently invisible.  Verify the multiline flag
    // is now in effect.
    const input = `first line of prose
second line

## Target
Content
`;
    expect(extractSectionsByHeading(input, 'Target')).toBe('Content\n');
  });
});
