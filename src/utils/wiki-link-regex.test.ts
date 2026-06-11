import { describe, it, expect } from 'vitest';

import { extractWikiTargets } from './wiki-link-regex.js';

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
