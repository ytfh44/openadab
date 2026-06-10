/**
 * Integration test: CLI commands end-to-end.
 *
 * Invokes the CLI module directly, captures stdout/stderr and exit codes,
 * and verifies command behavior.
 */
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProgram } from '../../src/cli/index.js';
import { createMinimalProject } from './fixture.js';
describe('CLI end-to-end', () => {
    let projectRoot;
    beforeEach(async () => {
        projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
        await createMinimalProject(projectRoot);
    });
    async function run(args) {
        const originalCwd = process.cwd();
        process.chdir(projectRoot);
        const stdoutLines = [];
        const stderrLines = [];
        const logSpy = vi.spyOn(console, 'log').mockImplementation((msg) => {
            stdoutLines.push(String(msg));
        });
        const errorSpy = vi.spyOn(console, 'error').mockImplementation((msg) => {
            stderrLines.push(String(msg));
        });
        let capturedExitCode = 0;
        vi.spyOn(process, 'exit').mockImplementation((code) => {
            if (typeof code === 'number') {
                capturedExitCode = code;
            }
            else if (code !== undefined && code !== null) {
                capturedExitCode = Number(code);
            }
            return undefined;
        });
        const originalExitCode = process.exitCode;
        let finalExitCode = 0;
        try {
            const program = createProgram();
            await program.parseAsync(['node', 'openadab', ...args]);
            if (capturedExitCode !== 0) {
                finalExitCode = capturedExitCode;
            }
            else {
                const exitAfterParse = process.exitCode;
                if (exitAfterParse !== undefined && exitAfterParse !== originalExitCode) {
                    finalExitCode = exitAfterParse;
                }
            }
        }
        catch {
            finalExitCode = capturedExitCode === 0 ? 1 : capturedExitCode;
        }
        finally {
            process.exitCode = originalExitCode;
            logSpy.mockRestore();
            errorSpy.mockRestore();
            process.chdir(originalCwd);
        }
        return { exitCode: finalExitCode, stdout: stdoutLines.join('\n'), stderr: stderrLines.join('\n') };
    }
    it('24.7 init fails when project already initialized', async () => {
        const { exitCode, stderr } = await run(['init']);
        expect(exitCode).toBe(1);
        expect(stderr).toContain('already initialized');
    });
    it('24.7 status --json returns valid JSON', async () => {
        const changeId = 'ch-002';
        const changeDir = join(projectRoot, 'adab', 'changes', changeId);
        await mkdir(changeDir, { recursive: true });
        const manifest = `changeId: ${changeId}\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: in_progress\ncurrentArtifact: brief\nartifacts:\n  brief: ready\n  scene-plan: blocked\n  draft: blocked\n  revision: blocked\n  continuity-report: blocked\n  wiki-diff: blocked\nchapter: "002"\nmetadata: {}\n`;
        await writeFile(join(changeDir, '.openadab.yaml'), manifest, 'utf-8');
        const { exitCode, stdout } = await run(['status', '--change', changeId, '--json']);
        expect(exitCode).toBe(0);
        const json = JSON.parse(stdout);
        expect(json.changeName).toBe(changeId);
        expect(Array.isArray(json.artifacts)).toBe(true);
    });
    it('24.7 schema list outputs built-in schemas', async () => {
        const { exitCode, stdout } = await run(['schema', 'list']);
        expect(exitCode).toBe(0);
        expect(stdout).toContain('chapter-draft');
    });
    it('24.7 config get returns a value', async () => {
        const { exitCode, stdout } = await run(['config', 'get', 'project.title']);
        expect(exitCode).toBe(0);
        expect(stdout).toContain('Test Novel');
    });
    it('24.7 validate --change returns validation results', async () => {
        const changeId = 'ch-003';
        const changeDir = join(projectRoot, 'adab', 'changes', changeId);
        await mkdir(changeDir, { recursive: true });
        const manifest = `changeId: ${changeId}\nschema: chapter-draft\nversion: 1\ncreated: 2024-01-01T00:00:00Z\nstatus: in_progress\ncurrentArtifact: brief\nartifacts:\n  brief: ready\n  scene-plan: blocked\n  draft: blocked\n  revision: blocked\n  continuity-report: blocked\n  wiki-diff: blocked\nchapter: "003"\nmetadata: {}\n`;
        await writeFile(join(changeDir, '.openadab.yaml'), manifest, 'utf-8');
        // Write all required artifact files so mechanical validation passes
        for (const art of ['brief', 'scene-plan', 'draft', 'revision', 'continuity-report', 'wiki-diff']) {
            await writeFile(join(changeDir, `${art}.md`), `---\nartifact: ${art}\n---\n\nContent for ${art}.\n`, 'utf-8');
        }
        const { exitCode, stdout } = await run(['validate', '--change', changeId, '--json']);
        expect(exitCode).toBe(0);
        const json = JSON.parse(stdout);
        expect(Array.isArray(json)).toBe(true);
    });
    it('24.7 exit code 1 on missing required argument', async () => {
        const { exitCode } = await run(['config', 'get']);
        expect(exitCode).toBe(1);
    });
    it('24.7 exit code 1 on operational error', async () => {
        const { exitCode } = await run(['archive', 'nonexistent-change']);
        expect(exitCode).toBe(1);
    });
});
//# sourceMappingURL=cli-e2e.test.js.map