/**
 * Tests for Timeline workspace command construction.
 */

import { describe, expect, it } from 'vitest';
import { buildTimelineIndexRefreshArgs } from '../renderer/src/routes/TimelineWorkspace.js';

describe('buildTimelineIndexRefreshArgs', () => {
  it('uses a command that does not require a change id', () => {
    expect(buildTimelineIndexRefreshArgs()).toEqual([
      'wiki',
      'index',
      '--json',
    ]);
  });

  it('does not build sync without a required --change argument', () => {
    expect(buildTimelineIndexRefreshArgs()[0]).not.toBe('sync');
    expect(buildTimelineIndexRefreshArgs()).not.toContain('--full');
  });
});
