/**
 * Transcript persistence store for the Electron main process.
 *
 * Writes CommandEvent objects as JSONL (one JSON object per line) to
 * `{projectRoot}/.adab-transcript.jsonl`. Supports reading with
 * initiator filter and limit, and clearing the transcript.
 */

import { appendFile, readFile, unlink, access } from 'node:fs/promises';
import { join } from 'node:path';
import type {
  CommandEvent,
  TranscriptGetEventsRequest,
} from '../shared/ipc-types.js';

const TRANSCRIPT_FILENAME = '.adab-transcript.jsonl';

/**
 * Manages persistent storage of CLI transcript events.
 *
 * One instance per open project. Events are appended as JSONL lines
 * for crash-safe incremental writing.
 */
export class TranscriptStore {
  private filePath: string;
  private events: CommandEvent[] = [];

  constructor(projectRoot: string) {
    this.filePath = join(projectRoot, TRANSCRIPT_FILENAME);
  }

  /** Load existing events from disk into memory. */
  async load(): Promise<void> {
    try {
      await access(this.filePath);
    } catch {
      this.events = [];
      return;
    }

    try {
      const content = await readFile(this.filePath, 'utf-8');
      const lines = content.split('\n');
      const parsed: CommandEvent[] = [];
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.length === 0) continue;
        try {
          parsed.push(JSON.parse(trimmed) as CommandEvent);
        } catch {
          // Skip malformed lines silently
        }
      }
      this.events = parsed;
    } catch {
      this.events = [];
    }
  }

  /** Append a single CommandEvent to the JSONL file and in-memory array. */
  async append(event: CommandEvent): Promise<void> {
    const line = JSON.stringify(event) + '\n';
    await appendFile(this.filePath, line, 'utf-8');
    this.events.push(event);
  }

  /**
   * Query events with optional filtering and limiting.
   *
   * @param request.filter — a filter object with `initiator` and/or `changeId`
   * @param request.limit — cap the number of results (most recent N)
   */
  async getEvents(
    request?: TranscriptGetEventsRequest,
  ): Promise<CommandEvent[]> {
    let results = [...this.events];

    if (request?.initiator) {
      results = results.filter((e) => e.initiator === request.initiator);
    }

    if (request?.limit && request.limit > 0) {
      results = results.slice(-request.limit);
    }

    return results;
  }

  /** Delete the transcript file and clear in-memory events. */
  async clear(): Promise<void> {
    try {
      await unlink(this.filePath);
    } catch {
      // File may not exist — that's fine
    }
    this.events = [];
  }

  /** Number of events currently loaded. */
  get count(): number {
    return this.events.length;
  }

  /** The filesystem path of the transcript file. */
  get transcriptPath(): string {
    return this.filePath;
  }
}
