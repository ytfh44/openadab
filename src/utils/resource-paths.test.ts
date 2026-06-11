/**
 * Unit tests for the resource path resolution utilities.
 *
 * These tests verify that the path resolvers correctly locate the package
 * root by walking up from a given module URL, then return the absolute
 * path to the bundled CLI resource that actually exists on disk.
 * The two relevant layouts are exercised:
 *   - Built layout: `<root>/dist/modules/...`  +  `<root>/schemas/built-in`
 *   - Source layout: `<root>/src/modules/...`   +  `<root>/src/schemas/built-in`
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { resolveBuiltInSchemasDir, resolveCommandsDir } from './resource-paths.js';

describe('resolveBuiltInSchemasDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-rp-schemas-'));
    writeFileSync(join(tempDir, 'package.json'), '{"name":"openadab-fixture"}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves to <root>/schemas/built-in when the caller lives under dist/ and the built directory exists', () => {
    const distSchemasDir = join(tempDir, 'schemas', 'built-in');
    mkdirSync(distSchemasDir, { recursive: true });
    const distModulePath = join(tempDir, 'dist', 'modules', 'schema-engine', 'index.js');
    mkdirSync(dirname(distModulePath), { recursive: true });
    const url = pathToFileURL(distModulePath).href;

    const result = resolveBuiltInSchemasDir(url);

    expect(result).toBe(distSchemasDir);
  });

  it('resolves to <root>/src/schemas/built-in when the caller lives under src/ and the source directory exists', () => {
    const srcSchemasDir = join(tempDir, 'src', 'schemas', 'built-in');
    mkdirSync(srcSchemasDir, { recursive: true });
    const srcModulePath = join(tempDir, 'src', 'modules', 'schema-engine', 'index.ts');
    mkdirSync(dirname(srcModulePath), { recursive: true });
    const url = pathToFileURL(srcModulePath).href;

    const result = resolveBuiltInSchemasDir(url);

    expect(result).toBe(srcSchemasDir);
  });

  it('prefers the built location when both built and source directories exist', () => {
    mkdirSync(join(tempDir, 'schemas', 'built-in'), { recursive: true });
    mkdirSync(join(tempDir, 'src', 'schemas', 'built-in'), { recursive: true });
    const modulePath = join(tempDir, 'dist', 'modules', 'schema-engine', 'index.js');
    mkdirSync(dirname(modulePath), { recursive: true });
    const url = pathToFileURL(modulePath).href;

    expect(resolveBuiltInSchemasDir(url)).toBe(join(tempDir, 'schemas', 'built-in'));
  });

  it('throws when no package.json is found in any ancestor directory', () => {
    const orphanDir = mkdtempSync(join(tmpdir(), 'openadab-orphan-'));
    try {
      const modulePath = join(orphanDir, 'index.js');
      mkdirSync(dirname(modulePath), { recursive: true });
      const url = pathToFileURL(modulePath).href;

      expect(() => resolveBuiltInSchemasDir(url)).toThrow(/package root/i);
    } finally {
      rmSync(orphanDir, { recursive: true, force: true });
    }
  });
});

describe('resolveCommandsDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-rp-commands-'));
    writeFileSync(join(tempDir, 'package.json'), '{"name":"openadab-fixture"}');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('resolves to <root>/commands when the caller lives under dist/ and the built directory exists', () => {
    const distCommandsDir = join(tempDir, 'commands');
    mkdirSync(distCommandsDir, { recursive: true });
    const distModulePath = join(tempDir, 'dist', 'cli', 'index.js');
    mkdirSync(dirname(distModulePath), { recursive: true });
    const url = pathToFileURL(distModulePath).href;

    const result = resolveCommandsDir(url);

    expect(result).toBe(distCommandsDir);
  });

  it('resolves to <root>/src/commands when the caller lives under src/ and the source directory exists', () => {
    const srcCommandsDir = join(tempDir, 'src', 'commands');
    mkdirSync(srcCommandsDir, { recursive: true });
    const srcModulePath = join(tempDir, 'src', 'cli', 'index.ts');
    mkdirSync(dirname(srcModulePath), { recursive: true });
    const url = pathToFileURL(srcModulePath).href;

    const result = resolveCommandsDir(url);

    expect(result).toBe(srcCommandsDir);
  });

  it('returns the same path for equivalent dist and src callers when only the source location exists', () => {
    mkdirSync(join(tempDir, 'src', 'commands'), { recursive: true });
    const distModulePath = join(tempDir, 'dist', 'cli', 'index.js');
    const srcModulePath = join(tempDir, 'src', 'cli', 'index.ts');
    mkdirSync(dirname(distModulePath), { recursive: true });
    mkdirSync(dirname(srcModulePath), { recursive: true });

    const distResult = resolveCommandsDir(pathToFileURL(distModulePath).href);
    const srcResult = resolveCommandsDir(pathToFileURL(srcModulePath).href);

    expect(distResult).toBe(srcResult);
  });
});
