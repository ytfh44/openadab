/**
 * Tests for Project workbench config command argument construction.
 */

import { describe, expect, it } from 'vitest';
import { buildConfigSetArgs } from '../renderer/src/components/ConfigEditor.js';

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
