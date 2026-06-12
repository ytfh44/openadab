import { describe, it, expect } from 'vitest';

import { WIKI_LINK_RE, extractWikiTargets } from './wiki-link-regex.js';
import { extractWikiLinks } from './markdown.js';

describe('extractWikiTargets', () => {
  it('should capture a basic [[Foo]] link', () => {
    expect(extractWikiTargets('See [[Foo]]')).toEqual(['Foo']);
  });

  it('should capture target only from [[Target|Alias]] (alias format)', () => {
    expect(extractWikiTargets('[[Alice|流浪者]]')).toEqual(['Alice']);
  });

  it('should capture multiple links on the same line', () => {
    expect(extractWikiTargets('[[A]] and [[B]]')).toEqual(['A', 'B']);
  });

  it('should capture targets from mixed simple and aliased links', () => {
    expect(extractWikiTargets('[[A]] and [[B|alias]] and [[C|alias2]]')).toEqual(['A', 'B', 'C']);
  });

  it('should capture target that contains spaces', () => {
    expect(extractWikiTargets('[[Alice the Wanderer]]')).toEqual(['Alice the Wanderer']);
  });

  it('should treat empty alias as a valid link', () => {
    expect(extractWikiTargets('[[Foo|]]')).toEqual(['Foo']);
  });

  it('should capture links across multiple lines', () => {
    expect(extractWikiTargets('[[A]]\n[[B]]')).toEqual(['A', 'B']);
  });

  it('should capture target with hyphens and underscores', () => {
    expect(extractWikiTargets('[[alice-v2_test]]')).toEqual(['alice-v2_test']);
  });

  it('should return empty array when there is no wiki link', () => {
    expect(extractWikiTargets('plain text')).toEqual([]);
  });

  it('should not let `]` inside alias break target extraction', () => {
    expect(extractWikiTargets('[[Foo|[link]]]')).toEqual(['Foo']);
  });
});

describe('WIKI_LINK_RE shared constant', () => {
  // ensure wiki-link-regex and markdown.extractWikiLinks use the
  // same shape of pattern.  If we ever drift them apart, these guards fail.
  it('exposes a global RegExp', () => {
    expect(WIKI_LINK_RE).toBeInstanceOf(RegExp);
    expect(WIKI_LINK_RE.flags).toContain('g');
  });

  it('matches the same links as markdown.extractWikiLinks', () => {
    const samples = [
      '[[Foo]]',
      '[[A]] and [[B]]',
      '[[Target|Alias]]',
      '[[Alice the Wanderer]]',
      'plain text',
      '[[alice-v2_test]]',
    ];
    for (const s of samples) {
      expect(extractWikiTargets(s)).toEqual(extractWikiLinks(s));
    }
  });

  it('excludes code-fenced links in the markdown variant only', () => {
    // extractWikiTargets in the wiki-link-regex util intentionally does NOT
    // strip inline code blocks; that is the markdown wrapper's job.  This
    // test documents the intentional difference.
    const sample = '`[[Foo]]`';
    expect(extractWikiTargets(sample)).toEqual(['Foo']);
    expect(extractWikiLinks(sample)).toEqual([]);
  });
});
