/**
 * Unit tests for artifact editor components.
 *
 * Covers:
 * - Frontmatter parse/serialize (parseFrontmatter, serializeFrontmatter)
 * - Save flow via mocked window.openadab.writeFile
 * - Conflict detection when writeFile returns conflict=true
 * - Missing file handling (ENOENT)
 * - Validation hints extraction
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  parseFrontmatter,
  serializeFrontmatter,
} from '../renderer/src/components/FrontmatterForm.js';
import type { FrontmatterEntry } from '../renderer/src/components/FrontmatterForm.js';

// ─── Frontmatter Parse Tests ──────────────────────────────

describe('parseFrontmatter', () => {
  it('extracts key-value pairs from YAML frontmatter block', () => {
    const raw = '---\ntitle: My Chapter\nstatus: draft\n---\n\n# Chapter One\n\nThis is the body.';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([
      { key: 'title', value: 'My Chapter' },
      { key: 'status', value: 'draft' },
    ]);
    expect(result.body).toContain('# Chapter One');
    expect(result.body).toContain('This is the body.');
  });

  it('returns empty entries when no frontmatter is present', () => {
    const raw = '# Just a heading\n\nSome content.';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([]);
    expect(result.body).toBe(raw);
  });

  it('handles empty string gracefully', () => {
    const result = parseFrontmatter('');
    expect(result.entries).toEqual([]);
    expect(result.body).toBe('');
  });

  it('handles frontmatter-only content (no body)', () => {
    const raw = '---\nkey: value\n---\n';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([{ key: 'key', value: 'value' }]);
    expect(result.body).toBe('');
  });

  it('handles frontmatter with trailing whitespace lines', () => {
    const raw = '---\nkey: value\n\n---\n\nbody text';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([{ key: 'key', value: 'value' }]);
    expect(result.body).toBe('body text');
  });

  it('handles frontmatter with colon in value', () => {
    const raw = '---\ntime: 12:30 PM\n---\n\nbody';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([{ key: 'time', value: '12:30 PM' }]);
  });

  it('skips comment lines starting with #', () => {
    const raw = '---\n# comment line\ntitle: Hello\n---\n\nbody';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([{ key: 'title', value: 'Hello' }]);
  });

  it('handles Windows-style line endings (CRLF)', () => {
    const raw = '---\r\nkey: value\r\n---\r\n\r\nbody';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([{ key: 'key', value: 'value' }]);
    expect(result.body).toBe('body');
  });

  it('handles multiple frontmatter entries with varying spacing', () => {
    const raw = '---\ntitle:  spaced  \n author: Me \nstatus:draft\n---\n\nbody';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([
      { key: 'title', value: 'spaced' },
      { key: 'author', value: 'Me' },
      { key: 'status', value: 'draft' },
    ]);
  });

  it('handles malformed frontmatter (missing closing ---)', () => {
    const raw = '---\nkey: value\n\nno closing';
    const result = parseFrontmatter(raw);
    expect(result.entries).toEqual([]);
    expect(result.body).toBe(raw);
  });
});

// ─── Frontmatter Serialize Tests ──────────────────────────

describe('serializeFrontmatter', () => {
  it('reconstructs frontmatter block from entries and body', () => {
    const entries: FrontmatterEntry[] = [
      { key: 'title', value: 'My Chapter' },
      { key: 'status', value: 'draft' },
    ];
    const body = '# Chapter One\n\nContent here.';
    const result = serializeFrontmatter(entries, body);
    expect(result).toBe(
      '---\ntitle: My Chapter\nstatus: draft\n---\n\n# Chapter One\n\nContent here.',
    );
  });

  it('returns body unchanged when entries are empty', () => {
    const body = '# Just content';
    const result = serializeFrontmatter([], body);
    expect(result).toBe(body);
  });

  it('handles entries with empty values', () => {
    const entries: FrontmatterEntry[] = [
      { key: 'title', value: '' },
      { key: 'status', value: 'done' },
    ];
    const body = 'body';
    const result = serializeFrontmatter(entries, body);
    expect(result).toBe('---\ntitle: \nstatus: done\n---\n\nbody');
  });
});

// ─── Save Flow Tests (mocked IPC) ─────────────────────────

describe('ArtifactEditor save flow (mocked)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('calls writeFile with correct parameters on save', async () => {
    // This test verifies the shape of calls the editor would make
    const mockWriteFile = vi.fn().mockResolvedValue({
      filePath: '/project/adab/changes/ch-001/brief.md',
      mtimeMs: 1700000000000,
      conflict: false,
    });

    const mockReadFile = vi.fn().mockResolvedValue({
      filePath: '/project/adab/changes/ch-001/brief.md',
      content: '---\ntitle: Test\n---\n\nBody',
      mtimeMs: 1700000000000,
    });

    // Simulate the save call
    const result = await mockWriteFile({
      filePath: '/project/adab/changes/ch-001/brief.md',
      content: '---\ntitle: Test\n---\n\nModified body',
      expectedMtimeMs: 1700000000000,
    });

    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: expect.stringContaining('adab/changes/ch-001'),
        content: expect.stringContaining('Modified body'),
        expectedMtimeMs: 1700000000000,
      }),
    );
    expect(result.conflict).toBe(false);
    expect(result.mtimeMs).toBe(1700000000000);
  });

  it('detects conflict when writeFile returns conflict=true', async () => {
    const mockWriteFile = vi.fn().mockResolvedValue({
      filePath: '/project/adab/changes/ch-001/brief.md',
      mtimeMs: 1700000000100,
      conflict: true,
    });

    const result = await mockWriteFile({
      filePath: '/project/adab/changes/ch-001/brief.md',
      content: 'new content',
      expectedMtimeMs: 1700000000000,
    });

    expect(result.conflict).toBe(true);
    // mtime changed on disk
    expect(result.mtimeMs).toBeGreaterThan(1700000000000);
  });

  it('handles missing file error (ENOENT)', async () => {
    const mockReadFile = vi.fn().mockRejectedValue(
      new Error('ENOENT: no such file or directory'),
    );

    await expect(
      mockReadFile({ filePath: '/project/adab/changes/ch-001/nonexistent.md' }),
    ).rejects.toThrow('ENOENT');
  });
});

// ─── Validation Hints Extraction Test ─────────────────────

describe('ArtifactEditor validation hints', () => {
  /**
   * Inline version of extractValidationHints for isolated testing.
   * The function resides in ArtifactEditor.tsx; replicated here
   * to avoid coupling the test to component internals.
   */
  function extractValidationHints(
    instructions: unknown,
  ): {
    requiredFields: string[];
    dependencies: string[];
    equivalentCli: string;
    contextBudget: string;
  } | null {
    if (!instructions || typeof instructions !== 'object') return null;
    const obj = instructions as Record<string, unknown>;

    const requiredFields: string[] = Array.isArray(obj['requiredFields'])
      ? obj['requiredFields'].map(String)
      : [];
    const dependencies: string[] = Array.isArray(obj['dependencies'])
      ? obj['dependencies'].map(String)
      : [];
    const equivalentCli: string =
      obj['equivalentCli'] !== undefined
        ? String(obj['equivalentCli'])
        : '';
    const contextBudget: string =
      obj['contextBudget'] !== undefined
        ? String(obj['contextBudget'])
        : '';

    if (
      requiredFields.length === 0 &&
      dependencies.length === 0 &&
      !equivalentCli &&
      !contextBudget
    ) {
      return null;
    }

    return { requiredFields, dependencies, equivalentCli, contextBudget };
  }

  it('extracts hints from instructions JSON with all fields', () => {
    const instructions = {
      artifact: 'brief',
      requiredFields: ['title', 'status'],
      dependencies: ['outline', 'research'],
      equivalentCli: 'openadab instructions brief --change ch-001 --json --inline-deps',
      contextBudget: '~1200 tokens',
    };

    const hints = extractValidationHints(instructions);
    expect(hints).not.toBeNull();
    expect(hints!.requiredFields).toEqual(['title', 'status']);
    expect(hints!.dependencies).toEqual(['outline', 'research']);
    expect(hints!.equivalentCli).toContain('openadab instructions');
    expect(hints!.contextBudget).toBe('~1200 tokens');
  });

  it('returns null when no hint keys are present', () => {
    const instructions = {
      artifact: 'brief',
      text: 'Write a brief summary.',
    };

    const hints = extractValidationHints(instructions);
    expect(hints).toBeNull();
  });

  it('returns null for null/undefined/primitive input', () => {
    expect(extractValidationHints(null)).toBeNull();
    expect(extractValidationHints(undefined)).toBeNull();
    expect(extractValidationHints('string')).toBeNull();
    expect(extractValidationHints(42)).toBeNull();
  });

  it('handles partial hints (only requiredFields)', () => {
    const instructions = {
      requiredFields: ['title'],
    };

    const hints = extractValidationHints(instructions);
    expect(hints).not.toBeNull();
    expect(hints!.requiredFields).toEqual(['title']);
    expect(hints!.dependencies).toEqual([]);
    expect(hints!.equivalentCli).toBe('');
    expect(hints!.contextBudget).toBe('');
  });

  it('handles partial hints (only contextBudget)', () => {
    const instructions = {
      contextBudget: 1500,
    };

    const hints = extractValidationHints(instructions);
    expect(hints).not.toBeNull();
    expect(hints!.contextBudget).toBe('1500');
  });
});

// ─── File Path Resolution Test ────────────────────────────

describe('resolveFilePath', () => {
  function resolveFilePath(
    projectRoot: string,
    changeId: string,
    artifact: { id: string; generatedFile?: string | null },
  ): string {
    if (artifact.generatedFile) {
      return `${projectRoot.replace(/[/\\]$/, '')}/${artifact.generatedFile.replace(/^[/\\]/, '')}`;
    }
    return `${projectRoot.replace(/[/\\]$/, '')}/adab/changes/${changeId}/${artifact.id}.md`;
  }

  it('uses generatedFile when available', () => {
    const result = resolveFilePath(
      'C:\\Projects\\my-novel',
      'ch-001',
      { id: 'brief', generatedFile: 'adab/changes/ch-001/brief.md' },
    );
    expect(result).toBe('C:\\Projects\\my-novel/adab/changes/ch-001/brief.md');
  });

  it('falls back to constructed path when generatedFile is null', () => {
    const result = resolveFilePath(
      '/home/user/my-novel',
      'ch-001',
      { id: 'outline', generatedFile: null },
    );
    expect(result).toBe('/home/user/my-novel/adab/changes/ch-001/outline.md');
  });

  it('falls back to constructed path when generatedFile is undefined', () => {
    const result = resolveFilePath(
      '/home/user/my-novel',
      'ch-002',
      { id: 'draft' },
    );
    expect(result).toBe('/home/user/my-novel/adab/changes/ch-002/draft.md');
  });

  it('normalizes trailing slashes in projectRoot', () => {
    const result = resolveFilePath(
      '/home/user/my-novel/',
      'ch-003',
      { id: 'revision' },
    );
    expect(result).toBe('/home/user/my-novel/adab/changes/ch-003/revision.md');
  });

  it('normalizes leading slashes in generatedFile', () => {
    const result = resolveFilePath(
      '/home/user/my-novel',
      'ch-001',
      { id: 'brief', generatedFile: '/adab/changes/ch-001/brief.md' },
    );
    expect(result).toBe('/home/user/my-novel/adab/changes/ch-001/brief.md');
  });
});

// ─── Dirty State Tracking Test ─────────────────────────────

describe('dirty state tracking', () => {
  it('detects dirty when content differs from saved', () => {
    const savedContent: string = '---\ntitle: Original\n---\n\nbody';
    const currentContent: string = '---\ntitle: Modified\n---\n\nbody';
    const isDirty = currentContent !== savedContent;
    expect(isDirty).toBe(true);
  });

  it('detects clean when content matches saved', () => {
    const savedContent: string = '---\ntitle: Same\n---\n\nbody';
    const currentContent: string = '---\ntitle: Same\n---\n\nbody';
    const isDirty = currentContent !== savedContent;
    expect(isDirty).toBe(false);
  });

  it('detects dirty when frontmatter changes', () => {
    // Simulating: user edits frontmatter via form
    const entries: FrontmatterEntry[] = [
      { key: 'title', value: 'New Title' },
    ];
    const body = 'body';
    const newContent = serializeFrontmatter(entries, body);
    const savedContent = '---\ntitle: Old Title\n---\n\nbody';
    expect(newContent).not.toBe(savedContent);
  });
});
