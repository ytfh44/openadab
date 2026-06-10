/**
 * Unit tests for the Log System module.
 */
import { mkdtempSync, rmSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import type { LogEntry } from '../../schemas/types.js';

import { LogWriter, LogReader } from './index.js';


describe('LogWriter', () => {
  let tempDir: string;
  let writer: LogWriter;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-log-test-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
    writer = new LogWriter(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('appends entry to new log file', async () => {
    const entry: LogEntry = {
      ts: '2026-06-06T10:00:00Z',
      op: 'init',
      change: null,
      result: 'ok',
    };
    await writer.append(entry);
    const raw = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    expect(raw).toContain('<!-- log-entry');
    expect(raw).toContain('"op":"init"');
    expect(raw).toContain('`init`');
    expect(raw).toContain('ok');
  });

  it('appends multiple entries preserving order', async () => {
    const e1: LogEntry = { ts: '2026-06-06T10:00:00Z', op: 'init', change: null, result: 'ok' };
    const e2: LogEntry = { ts: '2026-06-06T10:01:00Z', op: 'new', change: 'draft-ch-001', result: 'ok' };
    await writer.append(e1);
    await writer.append(e2);
    const raw = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    const initIndex = raw.indexOf('init');
    const newIndex = raw.indexOf('new');
    expect(initIndex).toBeLessThan(newIndex);
  });

  it('includes details when provided', async () => {
    const entry: LogEntry = {
      ts: '2026-06-06T10:02:00Z',
      op: 'sync',
      change: 'draft-ch-001',
      result: 'ok',
      details: { pagesModified: 3 },
    };
    await writer.append(entry);
    const raw = readFileSync(join(tempDir, 'adab', 'log.md'), 'utf-8');
    expect(raw).toContain('"pagesModified":3');
  });
});

describe('LogReader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-logreader-test-'));
    mkdirSync(join(tempDir, 'adab'), { recursive: true });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns empty array when log file missing', async () => {
    const reader = new LogReader(tempDir);
    const entries = await reader.readAll();
    expect(entries).toEqual([]);
  });

  it('reads all entries from log file', async () => {
    const logPath = join(tempDir, 'adab', 'log.md');
    writeFileSync(
      logPath,
      `<!-- log-entry {"ts":"2026-06-06T10:00:00Z","op":"init","change":null,"result":"ok"} -->\n- **2026-06-06T10:00:00Z** \`init\` — ok\n\n` +
        `<!-- log-entry {"ts":"2026-06-06T10:01:00Z","op":"new","change":"draft-ch-001","result":"ok"} -->\n- **2026-06-06T10:01:00Z** \`new\` change \`draft-ch-001\` — ok\n`,
      'utf-8'
    );
    const reader = new LogReader(tempDir);
    const entries = await reader.readAll();
    expect(entries).toHaveLength(2);
    expect(entries[0].op).toBe('init');
    expect(entries[1].op).toBe('new');
    expect(entries[1].change).toBe('draft-ch-001');
  });

  it('filters by change', async () => {
    const logPath = join(tempDir, 'adab', 'log.md');
    writeFileSync(
      logPath,
      `<!-- log-entry {"ts":"2026-06-06T10:00:00Z","op":"new","change":"ch-001","result":"ok"} -->\n- **...** \`new\` ...\n\n` +
        `<!-- log-entry {"ts":"2026-06-06T10:01:00Z","op":"new","change":"ch-002","result":"ok"} -->\n- **...** \`new\` ...\n`,
      'utf-8'
    );
    const reader = new LogReader(tempDir);
    const filtered = await reader.filter({ change: 'ch-001' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].change).toBe('ch-001');
  });

  it('filters by operation', async () => {
    const logPath = join(tempDir, 'adab', 'log.md');
    writeFileSync(
      logPath,
      `<!-- log-entry {"ts":"2026-06-06T10:00:00Z","op":"init","change":null,"result":"ok"} -->\n- **...** \`init\` ...\n\n` +
        `<!-- log-entry {"ts":"2026-06-06T10:01:00Z","op":"sync","change":"ch-001","result":"ok"} -->\n- **...** \`sync\` ...\n`,
      'utf-8'
    );
    const reader = new LogReader(tempDir);
    const filtered = await reader.filter({ operation: 'sync' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].op).toBe('sync');
  });

  it('filters by date range', async () => {
    const logPath = join(tempDir, 'adab', 'log.md');
    writeFileSync(
      logPath,
      `<!-- log-entry {"ts":"2026-06-05T10:00:00Z","op":"init","change":null,"result":"ok"} -->\n- **...** \`init\` ...\n\n` +
        `<!-- log-entry {"ts":"2026-06-06T10:00:00Z","op":"sync","change":"ch-001","result":"ok"} -->\n- **...** \`sync\` ...\n\n` +
        `<!-- log-entry {"ts":"2026-06-07T10:00:00Z","op":"archive","change":"ch-001","result":"ok"} -->\n- **...** \`archive\` ...\n`,
      'utf-8'
    );
    const reader = new LogReader(tempDir);
    const filtered = await reader.filter({ startDate: '2026-06-06T00:00:00Z', endDate: '2026-06-06T23:59:59Z' });
    expect(filtered).toHaveLength(1);
    expect(filtered[0].op).toBe('sync');
  });

  it('skips malformed JSON comments', async () => {
    const logPath = join(tempDir, 'adab', 'log.md');
    writeFileSync(
      logPath,
      `<!-- log-entry {invalid json} -->\n- **...** \`bad\` ...\n\n` +
        `<!-- log-entry {"ts":"2026-06-06T10:00:00Z","op":"init","change":null,"result":"ok"} -->\n- **...** \`init\` ...\n`,
      'utf-8'
    );
    const reader = new LogReader(tempDir);
    const entries = await reader.readAll();
    expect(entries).toHaveLength(1);
    expect(entries[0].op).toBe('init');
  });
});
