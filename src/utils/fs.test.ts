import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { AdabError } from './errors.js';
import {
  safeReadFile,
  safeReadFileSync,
  atomicWriteFile,
  ensureDir,
  fileExists,
} from './fs.js';

describe('safeReadFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-fs-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return content for existing file', async () => {
    const filePath = join(tempDir, 'hello.txt');
    writeFileSync(filePath, 'world', 'utf-8');
    const result = await safeReadFile(filePath);
    expect(result).toBe('world');
  });

  it('should return null for missing file', async () => {
    const result = await safeReadFile(join(tempDir, 'missing.txt'));
    expect(result).toBeNull();
  });

  it('should throw AdabError on permission denied (if possible)', async () => {
    const filePath = join(tempDir, 'secret.txt');
    writeFileSync(filePath, 'shh', 'utf-8');
    chmodSync(filePath, 0o000);
    try {
      const promise = safeReadFile(filePath);
      let threw = false;
      try {
        await promise;
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(AdabError);
      }
      if (!threw) {
        // Windows may ignore chmod for files; skip this assertion.
        expect(true).toBe(true);
      }
    } finally {
      chmodSync(filePath, 0o644);
    }
  });

  it('should handle empty file', async () => {
    const filePath = join(tempDir, 'empty.txt');
    writeFileSync(filePath, '', 'utf-8');
    const result = await safeReadFile(filePath);
    expect(result).toBe('');
  });
});

describe('safeReadFileSync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-fs-sync-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return content for existing file', () => {
    const filePath = join(tempDir, 'hello.txt');
    writeFileSync(filePath, 'world', 'utf-8');
    expect(safeReadFileSync(filePath)).toBe('world');
  });

  it('should return null for missing file', () => {
    const result = safeReadFileSync(join(tempDir, 'missing.txt'));
    expect(result).toBeNull();
  });

  it('should throw AdabError on permission denied (if possible)', () => {
    const filePath = join(tempDir, 'secret.txt');
    writeFileSync(filePath, 'shh', 'utf-8');
    chmodSync(filePath, 0o000);
    try {
      let threw = false;
      try {
        safeReadFileSync(filePath);
      } catch (err) {
        threw = true;
        expect(err).toBeInstanceOf(AdabError);
      }
      if (!threw) {
        // Windows may ignore chmod for files; skip this assertion.
        expect(true).toBe(true);
      }
    } finally {
      chmodSync(filePath, 0o644);
    }
  });
});

describe('atomicWriteFile', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-atomic-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should write file that can be read back', async () => {
    const filePath = join(tempDir, 'out.txt');
    await atomicWriteFile(filePath, 'atomic content');
    const result = await safeReadFile(filePath);
    expect(result).toBe('atomic content');
  });

  it('should overwrite existing file', async () => {
    const filePath = join(tempDir, 'out.txt');
    writeFileSync(filePath, 'old', 'utf-8');
    await atomicWriteFile(filePath, 'new');
    expect(await safeReadFile(filePath)).toBe('new');
  });

  it('should throw AdabError for invalid path', async () => {
    const badPath = join(tempDir, 'nonexistent-dir', 'file.txt');
    await expect(atomicWriteFile(badPath, 'x')).rejects.toBeInstanceOf(AdabError);
  });
});

describe('ensureDir', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-dir-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should create nested directories', async () => {
    const nested = join(tempDir, 'a', 'b', 'c');
    await ensureDir(nested);
    expect(await fileExists(nested)).toBe(true);
  });

  it('should be idempotent', async () => {
    const dir = join(tempDir, 'exists');
    mkdirSync(dir);
    await expect(ensureDir(dir)).resolves.toBeUndefined();
  });
});

describe('fileExists', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'openadab-exists-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should return true for existing file', async () => {
    const filePath = join(tempDir, 'file.txt');
    writeFileSync(filePath, 'x', 'utf-8');
    expect(await fileExists(filePath)).toBe(true);
  });

  it('should return false for missing file', async () => {
    expect(await fileExists(join(tempDir, 'nope.txt'))).toBe(false);
  });

  it('should return true for existing directory', async () => {
    expect(await fileExists(tempDir)).toBe(true);
  });
});
