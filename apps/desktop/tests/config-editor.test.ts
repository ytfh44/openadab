/**
 * Tests for Project workbench config command argument construction
 * and auto-detection of config value modes.
 */

import { describe, expect, it } from 'vitest';
import {
  buildConfigSetArgs,
  detectConfigValueMode,
} from '../renderer/src/components/ConfigEditor.js';

describe('detectConfigValueMode', () => {
  it('returns raw for plain strings', () => {
    expect(detectConfigValueMode('hello')).toBe('raw');
    expect(detectConfigValueMode('My Novel')).toBe('raw');
    expect(detectConfigValueMode('')).toBe('raw');
  });

  it('returns raw for numbers', () => {
    expect(detectConfigValueMode('42')).toBe('raw');
    expect(detectConfigValueMode('3.14')).toBe('raw');
    expect(detectConfigValueMode('-7')).toBe('raw');
  });

  it('returns raw for booleans and null', () => {
    expect(detectConfigValueMode('true')).toBe('raw');
    expect(detectConfigValueMode('false')).toBe('raw');
    expect(detectConfigValueMode('null')).toBe('raw');
  });

  it('returns json for objects', () => {
    expect(detectConfigValueMode('{"key":"val"}')).toBe('json');
    expect(detectConfigValueMode('{}')).toBe('json');
  });

  it('returns json for arrays', () => {
    expect(detectConfigValueMode('[1,2,3]')).toBe('json');
    expect(detectConfigValueMode('[]')).toBe('json');
  });

  it('returns json for whitespace-padded JSON values', () => {
    expect(detectConfigValueMode('  {"a":1}  ')).toBe('json');
    expect(detectConfigValueMode('\n[1]\t')).toBe('json');
  });

  it('returns raw for strings that contain braces mid-text', () => {
    expect(detectConfigValueMode('hello {world}')).toBe('raw');
    expect(detectConfigValueMode('prefix [1,2]')).toBe('raw');
  });
});

describe('buildConfigSetArgs', () => {
  it('omits --json for ordinary raw strings', () => {
    expect(buildConfigSetArgs('project.title', 'My Novel', 'raw')).toEqual([
      'config',
      'set',
      'project.title',
      'My Novel',
    ]);
  });

  it('preserves spaces and quotes in raw mode without forcing JSON parsing', () => {
    expect(buildConfigSetArgs('project.subtitle', 'Part "One"', 'raw')).toEqual([
      'config',
      'set',
      'project.subtitle',
      'Part "One"',
    ]);
  });

  it('adds --json when the user explicitly selects JSON mode for an object', () => {
    expect(buildConfigSetArgs('context', '{"maxTokens":12000}', 'json')).toEqual([
      'config',
      'set',
      'context',
      '{"maxTokens":12000}',
      '--json',
    ]);
  });

  it('adds --json for numeric values only in JSON mode', () => {
    expect(buildConfigSetArgs('context.maxTokens', '12000', 'json')).toEqual([
      'config',
      'set',
      'context.maxTokens',
      '12000',
      '--json',
    ]);
  });
});
