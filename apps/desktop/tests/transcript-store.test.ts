/**
 * Tests for TranscriptStore: JSONL write/read, initiator filter, limit, clear.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { TranscriptStore } from '../electron/transcript-store.js';
import type { CommandEvent } from '../shared/ipc-types.js';

/** Create a sample CommandEvent for testing. */
function makeEvent(overrides?: Partial<CommandEvent>): CommandEvent {
  return {
    id: overrides?.id ?? randomUUID(),
    command: 'openadab',
    args: overrides?.args ?? ['status', '--change', 'ch-001', '--json'],
    cwd: overrides?.cwd ?? '/test/project',
    startedAt: overrides?.startedAt ?? new Date().toISOString(),
    endedAt: overrides?.endedAt ?? new Date().toISOString(),
    exitCode: overrides?.exitCode ?? 0,
    stdout: overrides?.stdout ?? '{"ok":true}',
    stderr: overrides?.stderr ?? '',
    parsedJson: overrides?.parsedJson ?? { ok: true },
    initiator: overrides?.initiator ?? 'user',
    cancelled: overrides?.cancelled ?? false,
  };
}

describe('TranscriptStore', () => {
  let tempDir: string;
  let store: TranscriptStore;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'openadab-transcript-test-'));
    store = new TranscriptStore(tempDir);
    await store.load();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('starts empty when no file exists', async () => {
    expect(store.count).toBe(0);
    const events = await store.getEvents();
    expect(events).toEqual([]);
  });

  it('appends a single event and reads it back', async () => {
    const event = makeEvent();
    await store.append(event);

    expect(store.count).toBe(1);
    const events = await store.getEvents();
    expect(events).toHaveLength(1);
    expect(events[0].id).toBe(event.id);
    expect(events[0].args).toEqual(event.args);
    expect(events[0].initiator).toBe('user');
    expect(events[0].parsedJson).toEqual({ ok: true });
  });

  it('persists events across re-load', async () => {
    const event = makeEvent();
    await store.append(event);

    // Create a new store instance for the same project root
    const store2 = new TranscriptStore(tempDir);
    await store2.load();

    expect(store2.count).toBe(1);
    const events = await store2.getEvents();
    expect(events[0].id).toBe(event.id);
  });

  it('appends multiple events and preserves order', async () => {
    const e1 = makeEvent({ id: 'a', args: ['status'] });
    const e2 = makeEvent({ id: 'b', args: ['sync'] });
    const e3 = makeEvent({ id: 'c', args: ['archive'] });

    await store.append(e1);
    await store.append(e2);
    await store.append(e3);

    const events = await store.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].id).toBe('a');
    expect(events[1].id).toBe('b');
    expect(events[2].id).toBe('c');
  });

  it('filters by initiator', async () => {
    await store.append(makeEvent({ id: 'u1', initiator: 'user' }));
    await store.append(makeEvent({ id: 'u2', initiator: 'user' }));
    await store.append(makeEvent({ id: 'a1', initiator: 'agent' }));
    await store.append(makeEvent({ id: 'ar1', initiator: 'auto-refresh' }));

    const userEvents = await store.getEvents({ initiator: 'user' });
    expect(userEvents).toHaveLength(2);
    expect(userEvents.map((e) => e.id)).toEqual(['u1', 'u2']);

    const agentEvents = await store.getEvents({ initiator: 'agent' });
    expect(agentEvents).toHaveLength(1);
    expect(agentEvents[0].id).toBe('a1');

    const autoEvents = await store.getEvents({ initiator: 'auto-refresh' });
    expect(autoEvents).toHaveLength(1);
    expect(autoEvents[0].id).toBe('ar1');
  });

  it('applies limit correctly', async () => {
    for (let i = 0; i < 10; i++) {
      await store.append(makeEvent({ id: `evt-${i}` }));
    }

    const limited = await store.getEvents({ limit: 3 });
    expect(limited).toHaveLength(3);
    // Should return the most recent events (last 3)
    expect(limited[0].id).toBe('evt-7');
    expect(limited[1].id).toBe('evt-8');
    expect(limited[2].id).toBe('evt-9');
  });

  it('combines initiator filter and limit', async () => {
    await store.append(makeEvent({ id: 'u1', initiator: 'user' }));
    await store.append(makeEvent({ id: 'a1', initiator: 'agent' }));
    await store.append(makeEvent({ id: 'u2', initiator: 'user' }));
    await store.append(makeEvent({ id: 'u3', initiator: 'user' }));

    const result = await store.getEvents({ initiator: 'user', limit: 2 });
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('u2');
    expect(result[1].id).toBe('u3');
  });

  it('returns all events when no filter specified', async () => {
    await store.append(makeEvent());
    await store.append(makeEvent());
    await store.append(makeEvent());

    const events = await store.getEvents();
    expect(events).toHaveLength(3);
  });

  it('returns empty for non-existent initiator filter', async () => {
    await store.append(makeEvent({ initiator: 'user' }));

    const events = await store.getEvents({ initiator: 'agent' });
    expect(events).toEqual([]);
  });

  it('clears all events', async () => {
    await store.append(makeEvent());
    await store.append(makeEvent());
    expect(store.count).toBe(2);

    await store.clear();
    expect(store.count).toBe(0);

    const events = await store.getEvents();
    expect(events).toEqual([]);
  });

  it('handles malformed JSON lines gracefully on load', async () => {
    // Write directly to the file with mixed valid/invalid lines
    const { appendFile, readFile } = await import('node:fs/promises');
    const filePath = join(tempDir, '.adab-transcript.jsonl');
    await appendFile(filePath, JSON.stringify(makeEvent({ id: 'ok' })) + '\n');
    await appendFile(filePath, 'this is not json\n');
    await appendFile(filePath, JSON.stringify(makeEvent({ id: 'also-ok' })) + '\n');
    await appendFile(filePath, '\n'); // blank line
    await appendFile(filePath, '{malformed\n');

    const store2 = new TranscriptStore(tempDir);
    await store2.load();

    expect(store2.count).toBe(2);
    const events = await store2.getEvents();
    expect(events.map((e) => e.id)).toEqual(['ok', 'also-ok']);
  });

  it('writes JSONL format with one object per line', async () => {
    await store.append(makeEvent({ id: 'first' }));
    await store.append(makeEvent({ id: 'second' }));

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(
      join(tempDir, '.adab-transcript.jsonl'),
      'utf-8',
    );
    const lines = content.trim().split('\n');
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(() => JSON.parse(line)).not.toThrow();
    }
  });
});
