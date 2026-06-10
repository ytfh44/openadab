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
    expect(extractSectionsByHeading(input, 'A')).toBe('A content\n### Sub\nSub content');
  });

  it('should return empty string for empty section', () => {
    const input = `## A
## B
B content
`;
    expect(extractSectionsByHeading(input, 'A')).toBe('');
  });

  it('should handle heading with extra spaces', () => {
    const input = `##  Target  
Content
`;
    expect(extractSectionsByHeading(input, 'Target')).toBe('Content');
  });

  it('should handle heading with special regex characters', () => {
    const input = `## C++
Content
`;
    expect(extractSectionsByHeading(input, 'C++')).toBe('Content');
  });
});
