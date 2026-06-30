/**
 * Unit tests for host-adapters module.
 */
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';


import type { CommandDef } from '../../schemas/command-def.js';
import type { GeneratedFile } from './index.js';

import { AdapterFactory } from './adapter-factory.js';
import {
  CommandDefLoader,
  AdapterBase,
  OpencodeAdapter,
  CursorAdapter,
  CopilotAdapter,
  GenericAdapter,
  MonolithicPromptAdapter,
  detectHost,
  computeHash,
  isUnchanged,
  writeGeneratedFiles,
  initRegistry,
} from './index.js';

const sampleCommands: CommandDef[] = [
  {
    name: 'draft',
    description: 'Write chapter draft',
    category: 'writing',
    parameters: [
      { name: 'change', type: 'string', required: true, description: 'Change ID' },
      { name: 'artifact', type: 'string', required: false, default: 'draft' },
    ],
    steps: [
      { action: 'cli', command: 'openadab context pack --change {{change}} --artifact {{artifact}} --json', capture: 'context_pack' },
      { action: 'read', paths: '{{context_pack.mustRead}}' },
      { action: 'write', path: '{{instructions.outputPath}}', content: '{{llm_output}}' },
    ],
  },
  {
    name: 'explore',
    description: 'Explore story state',
    category: 'utility',
    parameters: [],
    steps: [{ action: 'cli', command: 'openadab status --json' }],
  },
];

describe('CommandDefLoader', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'host-adapters-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('loads valid yaml command definitions', async () => {
    const yaml = `name: draft\ndescription: Write chapter draft\ncategory: writing\nparameters:\n  - name: change\n    type: string\n    required: true\nsteps:\n  - action: cli\n    command: openadab status --json`;
    writeFileSync(join(tempDir, 'draft.yaml'), yaml);
    const loader = new CommandDefLoader(tempDir);
    const defs = await loader.loadAll();
    expect(defs).toHaveLength(1);
    expect(defs[0].name).toBe('draft');
  });

  it('skips invalid yaml without throwing', async () => {
    writeFileSync(join(tempDir, 'bad.yaml'), 'name: draft\nsteps: not-an-array');
    const loader = new CommandDefLoader(tempDir);
    const defs = await loader.loadAll();
    expect(defs).toEqual([]);
  });

  it('returns empty array when no yaml files exist', async () => {
    const loader = new CommandDefLoader(tempDir);
    const defs = await loader.loadAll();
    expect(defs).toEqual([]);
  });

  it('warns and skips duplicate command names (later files are not silently dropped)', async () => {
    // Two yaml files with the same `name` would generate two `adab-draft/SKILL.md`
    // files and overwrite each other on disk. The loader must surface this.
    const yamlA = `name: draft\ndescription: A\ncategory: writing\nparameters: []\nsteps:\n  - action: cli\n    command: openadab status --json`;
    const yamlB = `name: draft\ndescription: B\ncategory: writing\nparameters: []\nsteps:\n  - action: cli\n    command: openadab status --json`;
    writeFileSync(join(tempDir, 'a.yaml'), yamlA);
    writeFileSync(join(tempDir, 'b.yaml'), yamlB);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const loader = new CommandDefLoader(tempDir);
    const defs = await loader.loadAll();
    // Only the first occurrence is kept; the duplicate is reported.
    expect(defs).toHaveLength(1);
    expect(defs[0].description).toBe('A');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duplicate'));
    warn.mockRestore();
  });
});

describe('OpencodeAdapter', () => {
  it('generates one SKILL.md per command with YAML frontmatter', () => {
    const adapter = new OpencodeAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('.agents/skills/adab-draft/SKILL.md');
    // YAML frontmatter
    expect(files[0].content).toContain('---');
    expect(files[0].content).toContain('name: adab-draft');
    expect(files[0].content).toContain('description: Use when you need to Write chapter draft. Triggered by /adab:draft for writing tasks.');
    // Body content
    expect(files[0].content).toContain('/adab:draft');
    expect(files[0].content).toContain('Change ID');
    expect(files[0].content).toContain('openadab context pack');
  });


  it('includes parameter documentation', () => {
    const adapter = new OpencodeAdapter();
    const files = adapter.generate(sampleCommands);
    const draft = files.find((f) => f.path.includes('draft'));
    expect(draft).toBeDefined();
    expect(draft!.content).toContain('`change` (string) (required)');
    expect(draft!.content).toContain('`artifact` (string)');
  });

  it('renders the command-specific steps in the workflow section (HA-6)', () => {
    // The hard-coded 5-step workflow was disconnected from cmd.steps. The new
    // implementation must call formatSteps() so the actual step text appears.
    const adapter = new OpencodeAdapter();
    const files = adapter.generate(sampleCommands);
    const draft = files.find((f) => f.path.includes('draft'))!;
    // The draft command has a read step over {{context_pack.mustRead}}.
    expect(draft.content).toContain('{{context_pack.mustRead}}');
    // It also has a write step.
    expect(draft.content).toContain('{{instructions.outputPath}}');
  });
});

describe('CursorAdapter', () => {
  it('generates a single .mdc file', () => {
    const adapter = new CursorAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('.cursor/rules/adab.mdc');
    expect(files[0].content).toContain('@draft');
    expect(files[0].content).toContain('@explore');
  });

  it('includes cli steps only', () => {
    const adapter = new CursorAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files[0].content).toContain('openadab context pack');
    expect(files[0].content).not.toContain('Read the file(s)');
  });
});

describe('CopilotAdapter', () => {
  it('generates a single copilot-instructions.md', () => {
    const adapter = new CopilotAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('.github/copilot-instructions.md');
    expect(files[0].content).toContain('/adab:draft');
    expect(files[0].content).toContain('/adab:explore');
  });

  it('includes workflow steps', () => {
    const adapter = new CopilotAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files[0].content).toContain('Run `openadab context pack');
    // Dotted placeholders are now resolved into <name.subkey> form so the AI
    // sees a clean documentation placeholder instead of raw {{...}} syntax.
    expect(files[0].content).toContain('Read `<context_pack.mustRead>`');
  });

  it('preserves dotted placeholders via interpolateParameters (HA-8)', () => {
    const adapter = new CopilotAdapter();
    const cmds: CommandDef[] = [
      {
        name: 'tpl',
        description: 'tpl',
        category: 'writing',
        parameters: [],
        steps: [
          { action: 'cli', command: 'openadab x --a {{simple}}' },
          { action: 'read', paths: '{{context_pack.mustRead}}' },
        ],
      },
    ];
    const files = adapter.generate(cmds);
    const text = files[0].content;
    expect(text).toContain('Run `openadab x --a <simple>`');
    expect(text).toContain('Read `<context_pack.mustRead>`');
    // The raw dotted placeholder must NOT survive in the output.
    expect(text).not.toContain('{{context_pack.mustRead}}');
  });

  it('numbers CLI / read / write steps independently (HA-7)', () => {
    // The original code re-used the literal strings "1.", "2.", "3." for every
    // cli/read/write step, producing sequences like "1. Run ... 1. Read ... 1. Run ...".
    // The fix uses an independent counter per action type, so the resulting
    // numbering is 1..N for each category.
    const cmds: CommandDef[] = [
      {
        name: 'mixed',
        description: 'mixed steps',
        category: 'writing',
        parameters: [],
        steps: [
          { action: 'cli', command: 'openadab a' },
          { action: 'cli', command: 'openadab b' },
          { action: 'read', paths: 'a.md' },
          { action: 'cli', command: 'openadab c' },
          { action: 'read', paths: 'b.md' },
        ],
      },
    ];
    const adapter = new CopilotAdapter();
    const files = adapter.generate(cmds);
    const text = files[0].content;
    expect(text).toContain('1. Run `openadab a`');
    expect(text).toContain('2. Run `openadab b`');
    expect(text).toContain('3. Run `openadab c`');
    // Read counter is independent.
    expect(text).toMatch(/1\. Read `a\.md`/);
    expect(text).toMatch(/2\. Read `b\.md`/);
  });
});

describe('GenericAdapter', () => {
  it('generates AGENTS.md', () => {
    const adapter = new GenericAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('AGENTS.md');
    expect(files[0].content).toContain('/adab:draft');
    expect(files[0].content).toContain('Parameters');
    expect(files[0].content).toContain('Steps');
  });
});

describe('MonolithicPromptAdapter', () => {
  it('generates PROMPT.md', () => {
    const adapter = new MonolithicPromptAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('PROMPT.md');
    expect(files[0].content).toContain('/adab:draft');
  });

  it('truncates content exceeding budget', () => {
    const adapter = new MonolithicPromptAdapter(10);
    const files = adapter.generate(sampleCommands);
    expect(files[0].content).toContain('[Content truncated to fit token budget]');
  });

  it('appends the truncation marker even when no H2 boundary is found in the truncated slice', () => {
    // When the truncated slice contains no `## ` heading, the original code would
    // emit the marker anyway but the slice would still be over budget. The new
    // behaviour guarantees the marker is appended at the very end.
    const adapter = new MonolithicPromptAdapter(1);
    const files = adapter.generate(sampleCommands);
    const content = files[0].content;
    expect(content).toContain('[Content truncated to fit token budget]');
    expect(content.length).toBeLessThan(200);
  });

  it('escapes backticks in outputPath to keep the markdown fenced code valid (HA-11)', () => {
    const ctx = { outputPath: 'a`b`c.md' };
    const adapter = new MonolithicPromptAdapter(undefined, 'en', ctx);
    const files = adapter.generate(sampleCommands);
    // The output path is wrapped in backticks to form `\`a\`b\`c.md\``.
    // Raw backticks inside would break the outer fences — they must be escaped.
    expect(files[0].content).toContain('\\`');
  });
});

describe('detectHost', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'host-detect-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('detects opencode from .opencode directory', async () => {
    mkdirSync(join(tempDir, '.opencode'));
    expect(await detectHost(tempDir)).toBe('opencode');
  });

  it('detects cursor from .cursor directory', async () => {
    mkdirSync(join(tempDir, '.cursor'));
    expect(await detectHost(tempDir)).toBe('cursor');
  });

  it('detects copilot from .github/copilot-instructions.md', async () => {
    mkdirSync(join(tempDir, '.github'));
    writeFileSync(join(tempDir, '.github', 'copilot-instructions.md'), '');
    expect(await detectHost(tempDir)).toBe('copilot');
  });

  it('returns null when no marker exists', async () => {
    expect(await detectHost(tempDir)).toBeNull();
  });

  it('returns null and warns when multiple host markers coexist (HA-3 ambiguous)', async () => {
    // Two host markers coexist — auto-detection cannot pick one without bias.
    // The spec's "Fallback to generic" scenario requires returning null so that
    // the caller falls back to the generic adapter and surfaces a warning.
    mkdirSync(join(tempDir, '.opencode'));
    mkdirSync(join(tempDir, '.cursor'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const result = await detectHost(tempDir);
    expect(result).toBeNull();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('multiple'));
    warn.mockRestore();
  });
});

describe('computeHash', () => {
  it('returns consistent hashes for identical content', () => {
    const a = computeHash('hello');
    const b = computeHash('hello');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('returns different hashes for different content', () => {
    const a = computeHash('hello');
    const b = computeHash('world');
    expect(a).not.toBe(b);
  });
});

describe('isUnchanged', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'hash-test-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('returns true when file content matches', async () => {
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'same');
    expect(await isUnchanged(path, 'same')).toBe(true);
  });

  it('returns false when file content differs', async () => {
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'old');
    expect(await isUnchanged(path, 'new')).toBe(false);
  });

  it('returns false when file does not exist', async () => {
    const path = join(tempDir, 'missing.md');
    expect(await isUnchanged(path, 'x')).toBe(false);
  });
});

describe('AdapterFactory', () => {
  it('creates registered adapters', () => {
    const opencodeAdapter = AdapterFactory.create('opencode');
    expect(opencodeAdapter).toBeInstanceOf(OpencodeAdapter);

    const cursorAdapter = AdapterFactory.create('cursor');
    expect(cursorAdapter).toBeInstanceOf(CursorAdapter);

    const copilotAdapter = AdapterFactory.create('copilot');
    expect(copilotAdapter).toBeInstanceOf(CopilotAdapter);

    const genericAdapter = AdapterFactory.create('generic');
    expect(genericAdapter).toBeInstanceOf(GenericAdapter);

    const monolithicAdapter = AdapterFactory.create('monolithic');
    expect(monolithicAdapter).toBeInstanceOf(MonolithicPromptAdapter);
  });

  it('falls back to default adapter for unknown hosts', () => {
    const adapter = AdapterFactory.create('unknown-host');
    expect(adapter).toBeInstanceOf(GenericAdapter);
  });

  it('throws when default adapter is not registered', () => {
    // Create a fresh factory instance by clearing the registry
    // Note: This test verifies the error path when no default is available
    expect(() => AdapterFactory.create('unknown-host', 'non-existent-default')).toThrow();
  });

  it('returns registered hosts', () => {
    const hosts = AdapterFactory.getRegisteredHosts();
    expect(hosts).toContain('opencode');
    expect(hosts).toContain('cursor');
    expect(hosts).toContain('copilot');
    expect(hosts).toContain('generic');
    expect(hosts).toContain('monolithic');
  });

  it('checks if host is registered', () => {
    expect(AdapterFactory.isRegistered('opencode')).toBe(true);
    expect(AdapterFactory.isRegistered('cursor')).toBe(true);
    expect(AdapterFactory.isRegistered('unknown')).toBe(false);
  });

  it('allows custom adapter registration', () => {
    class CustomAdapter extends AdapterBase {
      generate(): GeneratedFile[] {
        return [{ path: 'custom.md', content: 'custom' }];
      }
    }

    AdapterFactory.register('custom', CustomAdapter);
    const adapter = AdapterFactory.create('custom');
    expect(adapter).toBeInstanceOf(CustomAdapter);

    // Clean up: remove custom adapter from registry
    // Note: In a real scenario, you might want to reset the registry between tests
  });

  it('_resetForTests() clears the registry (HA-5)', () => {
    // Start from a clean slate to avoid pollution from earlier tests
    // (e.g. the "custom" adapter registered above).
    AdapterFactory._resetForTests();
    initRegistry();
    const builtIns = AdapterFactory.getRegisteredHosts();
    expect(builtIns).toContain('opencode');
    expect(builtIns).toContain('cursor');
    expect(builtIns).toContain('copilot');
    expect(builtIns).toContain('generic');
    expect(builtIns).toContain('monolithic');
    // Now reset — the registry must be empty.
    AdapterFactory._resetForTests();
    expect(AdapterFactory.getRegisteredHosts()).toEqual([]);
    // Re-init must restore the built-ins.
    initRegistry();
    const restored = AdapterFactory.getRegisteredHosts();
    expect(restored).toEqual(builtIns);
  });

  it('emits a warning when falling back to the default adapter (HA-12)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const adapter = AdapterFactory.create('definitely-not-registered');
    expect(adapter).toBeInstanceOf(GenericAdapter);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('definitely-not-registered'));
    warn.mockRestore();
  });
});

describe('writeGeneratedFiles', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'write-gen-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes new files', async () => {
    const files = [{ path: 'a.md', content: 'hello' }];
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).toContain('a.md');
  });

  it('skips unchanged files', async () => {
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'hello');
    const files = [{ path: 'a.md', content: 'hello' }];
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).not.toContain('a.md');
  });

  it('skips existing file with no baseline cache (unknown provenance — user data preserved)', async () => {
    // Pre-existing file with no .openadab-cache.json: behaviour is "unknown state" — must NOT overwrite.
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'old-user-content');
    const files = [{ path: 'a.md', content: 'new-generated' }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).not.toContain('a.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toBe('old-user-content');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('overwrites file when baseline matches existing content but new content differs (regeneration)', async () => {
    // Simulate: previous run produced baseline "baseline" and the file on disk still has "baseline".
    // The new adapter output is "new" — that is a deliberate adapter change, so it overwrites.
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'baseline');
    const cachePath = join(tempDir, '.openadab-cache.json');
    const baselineHash = computeHash('baseline');
    writeFileSync(cachePath, JSON.stringify({ hashes: { 'a.md': baselineHash } }), 'utf-8');
    const files = [{ path: 'a.md', content: 'new' }];
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).toContain('a.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toBe('new');
  });

  it('preserves user-modified file when baseline exists and differs from current content', async () => {
    // File on disk = "user-edit", baseline = "baseline" (user modified the file)
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'user-edit');
    const cachePath = join(tempDir, '.openadab-cache.json');
    const baselineHash = computeHash('baseline');
    writeFileSync(cachePath, JSON.stringify({ hashes: { 'a.md': baselineHash } }), 'utf-8');
    const files = [{ path: 'a.md', content: 'new' }];
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).not.toContain('a.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toBe('user-edit');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('user modifications detected'));
    warn.mockRestore();
  });
});
