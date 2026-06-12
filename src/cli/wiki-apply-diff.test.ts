/**
 * Unit tests for `wiki apply-diff` CLI option resolution and conflict detection.
 *
 * Covers:
 *  - dryRun flag priority is reversed when both `--apply` and
 *    `--dry-run` are passed. After the fix, `--apply` always wins and the
 *    operation writes changes (dryRun=false).
 *  - `--apply` and `--dry-run` are not declared as mutually exclusive
 *    in Commander. After the fix, passing both should make Commander reject
 *    the input as a usage error and the action handler should not run.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { WikiDiffApplier } from '../modules/wiki-diff-engine/index.js';

import { createMinimalProject } from '../../tests/integration/fixture.js';

import { createProgram, resolveApplyDryRun } from './index.js';

const WIKI_DIFF_MARKDOWN = `---
changeId: ch-001
---

### [[characters/mara]]

Source: ch-001/continuity-report.md

#### Update Field

status: injured
`;

async function scaffoldProject(): Promise<{ projectRoot: string; diffPath: string }> {
  const projectRoot = await mkdtemp(join(tmpdir(), 'openadab-cli-'));
  await createMinimalProject(projectRoot);
  const changeDir = join(projectRoot, 'adab', 'changes', 'ch-001');
  await mkdir(changeDir, { recursive: true });
  await writeFile(join(changeDir, 'wiki-diff.md'), WIKI_DIFF_MARKDOWN, 'utf-8');
  return { projectRoot, diffPath: join(changeDir, 'wiki-diff.md') };
}

describe('resolveApplyDryRun (dryRun flag priority)', () => {
  it('dryRun=false when only --apply is passed', () => {
    expect(resolveApplyDryRun({ apply: true })).toBe(false);
  });

  it('dryRun=true when only --dry-run is passed', () => {
    expect(resolveApplyDryRun({ dryRun: true })).toBe(true);
  });

  it('dryRun=true when neither flag is passed (safe default)', () => {
    expect(resolveApplyDryRun({})).toBe(true);
  });

  it('dryRun=false when both --apply and --dry-run are passed (--apply wins)', () => {
    expect(resolveApplyDryRun({ apply: true, dryRun: true })).toBe(false);
  });

  it('dryRun=false when --apply is explicitly true even with other unrelated options', () => {
    expect(resolveApplyDryRun({ apply: true, change: 'ch-001', json: true })).toBe(false);
  });
});

describe('CLI wiki apply-diff dryRun integration', () => {
  let projectRoot: string;
  let diffPath: string;
  let applySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const scaffold = await scaffoldProject();
    projectRoot = scaffold.projectRoot;
    diffPath = scaffold.diffPath;

    applySpy = vi.spyOn(WikiDiffApplier.prototype, 'apply');
    applySpy.mockResolvedValue({
      success: true,
      operationsApplied: 1,
      pagesModified: 1,
      contradictionsFlagged: 0,
      summary: 'ok',
      warnings: [],
    });
  });

  async function runWithoutConflict(args: string[]): Promise<void> {
    const originalCwd = process.cwd();
    process.chdir(projectRoot);

    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {
      return undefined as unknown as never;
    }) as never);
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const program = createProgram();
      const wikiCmd = program.commands.find((c) => c.name() === 'wiki');
      const applyDiffCmd = wikiCmd?.commands.find((c) => c.name() === 'apply-diff');
      expect(applyDiffCmd).toBeDefined();

      const applyOption = applyDiffCmd?.options.find((o) => o.long === '--apply');
      if (applyOption !== undefined) {
        applyOption.conflictsWith = [];
      }

      await program.parseAsync(['node', 'openadab', ...args]);
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      errorSpy.mockRestore();
      exitSpy.mockRestore();
      process.exitCode = originalExitCode;
    }
  }

  it('passes dryRun=false to WikiDiffApplier.apply when only --apply is passed', async () => {
    await runWithoutConflict(['wiki', 'apply-diff', diffPath, '--apply']);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]?.[1]).toBe(false);
  });

  it('passes dryRun=true to WikiDiffApplier.apply when only --dry-run is passed', async () => {
    await runWithoutConflict(['wiki', 'apply-diff', diffPath, '--dry-run']);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]?.[1]).toBe(true);
  });

  it('passes dryRun=true to WikiDiffApplier.apply when neither flag is passed (safe default)', async () => {
    await runWithoutConflict(['wiki', 'apply-diff', diffPath]);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]?.[1]).toBe(true);
  });

  it('passes dryRun=false to WikiDiffApplier.apply when both --apply and --dry-run are passed (--apply wins)', async () => {
    await runWithoutConflict(['wiki', 'apply-diff', diffPath, '--apply', '--dry-run']);
    expect(applySpy).toHaveBeenCalledTimes(1);
    expect(applySpy.mock.calls[0]?.[1]).toBe(false);
  });
});

describe('CLI wiki apply-diff conflict detection', () => {
  let projectRoot: string;
  let diffPath: string;
  let applySpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    const scaffold = await scaffoldProject();
    projectRoot = scaffold.projectRoot;
    diffPath = scaffold.diffPath;

    applySpy = vi.spyOn(WikiDiffApplier.prototype, 'apply');
    applySpy.mockResolvedValue({
      success: true,
      operationsApplied: 1,
      pagesModified: 1,
      contradictionsFlagged: 0,
      summary: 'ok',
      warnings: [],
    });
  });

  it('--apply --dry-run together triggers a usage error and does not invoke the action handler', async () => {
    const originalCwd = process.cwd();
    process.chdir(projectRoot);

    const stderrLines: string[] = [];
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg: unknown) => {
      stderrLines.push(String(msg));
    });
    const stderrWriteSpy = vi.spyOn(process.stderr, 'write').mockImplementation(((chunk: unknown) => {
      stderrLines.push(String(chunk));
      return true;
    }) as never);

    let capturedExitCode: number | null = null;
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(((code?: number | string | null) => {
      if (typeof code === 'number') {
        capturedExitCode = code;
      } else if (typeof code === 'string') {
        capturedExitCode = Number(code);
      } else {
        capturedExitCode = 1;
      }
      throw new Error(`__test_exit:${String(capturedExitCode)}`);
    }) as never);

    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    try {
      const program = createProgram();
      try {
        await program.parseAsync([
          'node',
          'openadab',
          'wiki',
          'apply-diff',
          diffPath,
          '--apply',
          '--dry-run',
        ]);
      } catch (err) {
        if (!(err instanceof Error) || !err.message.startsWith('__test_exit:')) {
          throw err;
        }
      }
      if (capturedExitCode === null && process.exitCode !== undefined && process.exitCode !== originalExitCode) {
        capturedExitCode = process.exitCode;
      }
    } finally {
      process.chdir(originalCwd);
      logSpy.mockRestore();
      errorSpy.mockRestore();
      stderrWriteSpy.mockRestore();
      exitSpy.mockRestore();
      process.exitCode = originalExitCode;
    }

    expect(capturedExitCode).not.toBeNull();
    expect(capturedExitCode).not.toBe(0);
    expect(applySpy).not.toHaveBeenCalled();
    const combined = stderrLines.join('\n').toLowerCase();
    expect(combined).toMatch(/--apply|--dry-run|conflict/);
  });
});
