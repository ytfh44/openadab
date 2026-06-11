/**
 * Integration test for `scripts/copy-resources.mjs`.
 *
 * Builds a fixture project tree under a temp directory, dynamically
 * imports the build script, invokes its `run` function with the fixture
 * root, and asserts that the resource directories were copied faithfully
 * to the expected `dist/` layout.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

interface CopyModule {
  run: (projectRoot: string) => Promise<Array<{ skipped: boolean; src: string; dest: string }>>;
  copyDirectoryRecursive: (src: string, dest: string) => Promise<{ skipped: boolean; src: string; dest: string }>;
}

/**
 * Resolve the project root by walking up from this test file's location
 * until a `package.json` is found.
 */
function resolveProjectRoot(startDir: string): string {
  let current = startDir;
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(current, 'package.json'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`Could not locate project root from: ${startDir}`);
    }
    current = parent;
  }
  throw new Error(`Could not locate project root from: ${startDir}`);
}

describe('scripts/copy-resources.mjs', () => {
  let tempDir: string;
  let scriptModule: CopyModule;

  beforeEach(async () => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-copy-resources-'));
    writeFileSync(join(tempDir, 'package.json'), '{"name":"copy-resources-fixture"}');

    const projectRoot = resolveProjectRoot(dirname(fileURLToPath(import.meta.url)));
    const scriptPath = join(projectRoot, 'scripts', 'copy-resources.mjs');
    const scriptUrl = pathToFileURL(scriptPath).href;
    scriptModule = (await import(scriptUrl)) as unknown as CopyModule;
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('copies a fixture built-in schema tree into dist/', async () => {
    const schemaDir = join(tempDir, 'src', 'schemas', 'built-in', 'foo', 'templates');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(tempDir, 'src', 'schemas', 'built-in', 'foo', 'schema.yaml'), 'name: foo\nversion: 1\n');
    writeFileSync(join(schemaDir, 't.md'), '# t');

    const results = await scriptModule.run(tempDir);

    const schemaCopy = results.find((r) => r.dest === join(tempDir, 'dist', 'schemas', 'built-in'));
    expect(schemaCopy).toBeDefined();
    expect(schemaCopy?.skipped).toBe(false);

    const copiedSchema = join(tempDir, 'dist', 'schemas', 'built-in', 'foo', 'schema.yaml');
    const copiedTemplate = join(tempDir, 'dist', 'schemas', 'built-in', 'foo', 'templates', 't.md');
    expect(existsSync(copiedSchema)).toBe(true);
    expect(existsSync(copiedTemplate)).toBe(true);
    expect(readFileSync(copiedSchema, 'utf-8')).toBe('name: foo\nversion: 1\n');
    expect(readFileSync(copiedTemplate, 'utf-8')).toBe('# t');
  });

  it('copies the commands directory into dist/commands', async () => {
    const commandsDir = join(tempDir, 'src', 'commands');
    mkdirSync(commandsDir, { recursive: true });
    writeFileSync(join(commandsDir, 'draft.yaml'), 'id: draft\n');
    writeFileSync(join(commandsDir, 'revise.yaml'), 'id: revise\n');

    const results = await scriptModule.run(tempDir);

    const commandsCopy = results.find((r) => r.dest === join(tempDir, 'dist', 'commands'));
    expect(commandsCopy).toBeDefined();
    expect(commandsCopy?.skipped).toBe(false);

    expect(existsSync(join(tempDir, 'dist', 'commands', 'draft.yaml'))).toBe(true);
    expect(existsSync(join(tempDir, 'dist', 'commands', 'revise.yaml'))).toBe(true);
    expect(readFileSync(join(tempDir, 'dist', 'commands', 'draft.yaml'), 'utf-8')).toBe('id: draft\n');
  });

  it('is idempotent: running twice does not throw and preserves content', async () => {
    const schemaDir = join(tempDir, 'src', 'schemas', 'built-in', 'bar');
    mkdirSync(schemaDir, { recursive: true });
    writeFileSync(join(schemaDir, 'schema.yaml'), 'name: bar\n');

    await scriptModule.run(tempDir);
    await expect(scriptModule.run(tempDir)).resolves.toBeDefined();

    expect(readFileSync(join(tempDir, 'dist', 'schemas', 'built-in', 'bar', 'schema.yaml'), 'utf-8')).toBe('name: bar\n');
  });

  it('skips (and reports skipped=true) when a source directory does not exist', async () => {
    const commandsSrc = join(tempDir, 'src', 'commands');
    mkdirSync(commandsSrc, { recursive: true });
    writeFileSync(join(commandsSrc, 'lint.yaml'), 'id: lint\n');

    const results = await scriptModule.run(tempDir);

    const schemaCopy = results.find((r) => r.dest === join(tempDir, 'dist', 'schemas', 'built-in'));
    expect(schemaCopy?.skipped).toBe(true);

    const commandsCopy = results.find((r) => r.dest === join(tempDir, 'dist', 'commands'));
    expect(commandsCopy?.skipped).toBe(false);
  });

  it('copyDirectoryRecursive overwrites a modified file at the destination', async () => {
    const srcDir = join(tempDir, 'src', 'sub');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'a.txt'), 'new');

    const destDir = join(tempDir, 'dest', 'sub');
    mkdirSync(destDir, { recursive: true });
    writeFileSync(join(destDir, 'a.txt'), 'old');

    await scriptModule.copyDirectoryRecursive(srcDir, destDir);

    expect(readFileSync(join(destDir, 'a.txt'), 'utf-8')).toBe('new');
  });
});
