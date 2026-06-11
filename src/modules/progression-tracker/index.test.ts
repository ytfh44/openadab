import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import { ProgressionTracker } from './index.js';


describe('ProgressionTracker', () => {
  function setupTracker() {
    const root = mkdtempSync(join(tmpdir(), 'openadab-pt-'));
    const tracker = new ProgressionTracker(root);
    return { root, tracker };
  }

  it('parses continuity-report knowledge entries', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'continuity-report.md');
    writeFileSync(file, '## Character Knowledge\n- Alice now knows the secret\n');
    const events = await tracker.parseContinuityReport(file);
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
    expect(events[0].type).toBe('knowledge');
    expect(events[0].change).toContain('secret');
  });

  it('parses wiki-diff knowledge entry', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'wiki-diff.md');
    writeFileSync(file, `---\nchangeId: ch-002\n---\n\n### [[characters/Alice]]\nSource: manuscript/chapters/ch-002.md\n\n#### Add to Current State\n- Alice learns the truth\n`);
    const events = await tracker.parseWikiDiff(file);
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
    expect(events[0].type).toBe('knowledge');
  });

  it('detects thread status changes', async () => {
    const { root, tracker } = setupTracker();
    const file = join(root, 'wiki-diff.md');
    writeFileSync(file, `---\nchangeId: ch-003\n---\n\n### [[threads/The Prophecy]]\nSource: manuscript/chapters/ch-003.md\n\n#### Update Thread Status\nStatus: resolved\n`);
    const events = await tracker.parseWikiDiff(file);
    expect(events.length).toBe(1);
    expect(events[0].type).toBe('thread_status');
    expect(events[0].to).toBe('resolved');
  });

  it('flags contradictions', async () => {
    const { root, tracker } = setupTracker();
    const indexDir = join(root, 'adab', 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'progressions.json'), JSON.stringify({
      chapters: [{
        chapter: 'ch-001',
        events: [{ chapter: 'ch-001', entity: 'Alice', type: 'knowledge' as const, change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' }],
      }],
    }));
    const newEvents = [{ chapter: 'ch-002', entity: 'Alice', type: 'knowledge' as const, change: 'does not know secret', timestamp: '2024-01-02T00:00:00Z' }];
    const contradictions = await tracker.detectContradictions(newEvents);
    expect(contradictions.length).toBeGreaterThan(0);
    expect(contradictions[0].reason).toContain('Contradictory');
  });

  it('entity query returns matching events', async () => {
    const { root, tracker } = setupTracker();
    const indexDir = join(root, 'adab', 'index');
    mkdirSync(indexDir, { recursive: true });
    writeFileSync(join(indexDir, 'progressions.json'), JSON.stringify({
      chapters: [{
        chapter: 'ch-001',
        events: [
          { chapter: 'ch-001', entity: 'Alice', type: 'knowledge', change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' },
          { chapter: 'ch-001', entity: 'Bob', type: 'knowledge', change: 'Learned secret', timestamp: '2024-01-01T00:00:00Z' },
        ],
      }],
    }));
    const events = await tracker.getProgression('Alice');
    expect(events.length).toBe(1);
    expect(events[0].entity).toBe('Alice');
  });
});
