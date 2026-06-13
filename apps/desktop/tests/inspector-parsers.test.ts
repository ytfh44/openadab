import { describe, expect, it } from 'vitest';

import { parseContextPackResponse } from '../renderer/src/components/ContextPackCard.js';
import { parseMechanicalValidationResponse } from '../renderer/src/components/ValidationCard.js';

describe('parseContextPackResponse', () => {
  it('normalizes the current CLI context pack shape', () => {
    const result = parseContextPackResponse({
      mustRead: ['adab/wiki/index.md', 'adab/changes/ch-001/brief.md'],
      optionalRead: ['adab/wiki/city.md'],
      excluded: ['adab/raw/notes.md'],
      reasons: {
        'adab/wiki/index.md': 'config.alwaysInclude',
        'adab/changes/ch-001/brief.md': 'artifact dependency',
        'adab/wiki/city.md': 'thread: City',
        'adab/raw/notes.md': 'budget exceeded',
        __stale_index_warning: 'Mention index is stale.',
      },
    });

    expect(result).not.toBeNull();
    expect(result!.mustRead).toEqual([
      {
        file: 'adab/wiki/index.md',
        reason: 'config.alwaysInclude',
      },
      {
        file: 'adab/changes/ch-001/brief.md',
        reason: 'artifact dependency',
      },
    ]);
    expect(result!.optional[0]).toEqual({
      file: 'adab/wiki/city.md',
      reason: 'thread: City',
    });
    expect(result!.excluded[0]).toEqual({
      file: 'adab/raw/notes.md',
      reason: 'budget exceeded',
    });
    expect(result!.staleIndexWarning).toBe(true);
  });

  it('keeps the older desktop-friendly context pack shape working', () => {
    const result = parseContextPackResponse({
      mustRead: [{ file: 'a.md', reason: 'required', tokens: 120 }],
      optional: [{ file: 'b.md', reason: 'nice to have' }],
      excluded: [],
      estimatedSize: 120,
    });

    expect(result).not.toBeNull();
    expect(result!.mustRead[0]).toEqual({
      file: 'a.md',
      reason: 'required',
      tokens: 120,
      stale: false,
    });
    expect(result!.optional[0].file).toBe('b.md');
    expect(result!.estimatedSize).toBe(120);
  });
});

describe('parseMechanicalValidationResponse', () => {
  it('normalizes the current CLI validation result array', () => {
    const result = parseMechanicalValidationResponse([
      {
        artifactId: 'brief',
        passed: true,
        errors: [],
        warnings: [],
      },
      {
        artifactId: 'draft',
        passed: false,
        errors: ['Missing frontmatter', 'Empty body'],
        warnings: [],
      },
    ]);

    expect(result).toEqual({
      passed: false,
      errors: [
        { file: 'draft', message: 'Missing frontmatter' },
        { file: 'draft', message: 'Empty body' },
      ],
    });
  });

  it('keeps the older object response shape working', () => {
    const result = parseMechanicalValidationResponse({
      passed: false,
      errors: [
        {
          file: 'adab/changes/ch-001/draft.md',
          line: 3,
          message: 'Missing title',
        },
      ],
    });

    expect(result).toEqual({
      passed: false,
      errors: [
        {
          file: 'adab/changes/ch-001/draft.md',
          line: 3,
          message: 'Missing title',
        },
      ],
    });
  });
});
