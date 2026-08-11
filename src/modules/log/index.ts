/**
 * Log System — append-only structured log for `adab/log.md`.
 *
 * Uses Markdown + HTML-comment JSON hybrid format so humans can read the
 * Markdown while machines parse the JSON comments.
 */
import { appendFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { LogEntry } from '../../schemas/types.js';
import { safeReadFile, ensureDir } from '../../utils/fs.js';

export class LogWriter {
  private readonly logPath: string;

  constructor(projectRoot: string) {
    this.logPath = join(projectRoot, 'adab', 'log.md');
  }

  /**
   * Append a single log entry to `log.md`.
   *
   * Format:
   * ```
   * <!-- log-entry {"ts":"...","op":"...","change":"...","result":"..."} -->
   * - **...** `op` ...
   * ```
   */
  async append(entry: LogEntry): Promise<void> {
    const line = this.formatEntry(entry);
    // The file is read only to decide whether a blank-line separator is
    // needed — the entry itself is appended with O_APPEND, so two
    // concurrent appends can no longer LOSE an entry the way the old
    // read-modify-write could (both readers saw the same base, the later
    // writer clobbered the earlier entry).  Worst case under a race is a
    // slightly odd blank line.
    const existing = await safeReadFile(this.logPath);
    const separator = existing !== null && existing.length > 0 && !existing.endsWith('\n\n') ? '\n\n' : '';
    await ensureDir(join(this.logPath, '..'));
    await appendFile(this.logPath, `${separator}${line}\n`, 'utf-8');
    // Defensive re-read: detect if another process modified the log concurrently.
    // Since this is a single-user CLI, concurrent writes are unlikely but not impossible.
    // Compare only the machine-readable `<!-- log-entry ... -->` fragment rather than the
    // full formatted line, so cosmetic tweaks to the Markdown portion do not trigger
    // false positives.
    const verify = await safeReadFile(this.logPath);
    // `.match()` keeps the regex literal inside a call expression: a
    // leading `(/<!--…-->/.exec(…))` form trips oxc's HTML-comment
    // detection and fails to parse.
    // Built via `new RegExp` (not a `/<!--…/` literal): oxc's parser treats
    // a leading `(/<!--` as an HTML comment and fails to transform the
    // module, and the lint autofixer converts `.match()` to `.exec()`.
    const lastComment = new RegExp('<!--.*?-->').exec(line)?.[0] ?? line;
    if (verify !== null && !verify.includes(lastComment)) {
      console.warn('[LogWriter] Possible concurrent modification detected — log entry may have been lost.');
    }
  }

  private formatEntry(entry: LogEntry): string {
    const payload = JSON.stringify({
      ts: entry.ts,
      op: entry.op,
      change: entry.change ?? null,
      result: entry.result,
      ...(entry.details ? { details: entry.details } : {}),
    });
    const changeStr = entry.change !== null && entry.change !== undefined && entry.change.length > 0 ? ` change \`${entry.change}\`` : '';
    const detailStr = entry.details ? ` (${JSON.stringify(entry.details)})` : '';
    return `<!-- log-entry ${payload} -->\n- **${entry.ts}** \`${entry.op}\`${changeStr} — ${entry.result}${detailStr}`;
  }
}

/**
 * Options for filtering log entries.
 */
export interface LogFilterOptions {
  /** Filter by change ID. */
  change?: string;
  /** Filter by operation name. */
  operation?: string;
  /** Inclusive start date (ISO string). */
  startDate?: string;
  /** Inclusive end date (ISO string). */
  endDate?: string;
}

/**
 * Read and parse structured log entries from `adab/log.md`.
 */
export class LogReader {
  private readonly logPath: string;

  constructor(projectRoot: string) {
    this.logPath = join(projectRoot, 'adab', 'log.md');
  }

  /**
   * Read all log entries from `log.md`.
   *
   * @returns Array of parsed log entries (newest last).
   * @throws {Error} If the log file cannot be read.
   */
  async readAll(): Promise<LogEntry[]> {
    const raw = await safeReadFile(this.logPath);
    if (raw === null) {
      return [];
    }
    return this.parse(raw);
  }

  async filter(options: LogFilterOptions): Promise<LogEntry[]> {
    const entries = await this.readAll();
    return entries.filter((e) => {
      if (options.change !== undefined && e.change !== options.change) {return false;}
      if (options.operation !== undefined && e.op !== options.operation) {return false;}
      if (options.startDate !== undefined && e.ts < options.startDate) {return false;}
      if (options.endDate !== undefined && e.ts > options.endDate) {return false;}
      return true;
    });
  }

  private parse(raw: string): LogEntry[] {
    const entries: LogEntry[] = [];
    const regex = /<!--\s*log-entry\s+(\{.+?\})\s*-->/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(raw)) !== null) {
      try {
        const parsed = JSON.parse(match[1]) as Record<string, unknown>;
        const entry: LogEntry = {
          ts: typeof parsed.ts === 'string' ? parsed.ts : '',
          op: typeof parsed.op === 'string' ? parsed.op : '',
          change: parsed.change === null ? null : typeof parsed.change === 'string' ? parsed.change : '',
          result: typeof parsed.result === 'string' ? parsed.result : '',
          details: typeof parsed.details === 'object' && parsed.details !== null
            ? (parsed.details as Record<string, unknown>)
            : undefined,
        };
        entries.push(entry);
      } catch (err) {
        console.warn('[LogReader] Skipped malformed log entry:', err instanceof Error ? err.message : String(err));
      }
    }
    return entries;
  }
}
