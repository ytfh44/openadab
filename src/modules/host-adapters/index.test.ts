/**
 * Unit tests for host-adapters module.
 */
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from 'vitest';


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
});

describe('OpencodeAdapter', () => {
  it('generates one SKILL.md per command', () => {
    const adapter = new OpencodeAdapter();
    const files = adapter.generate(sampleCommands);
    expect(files).toHaveLength(2);
    expect(files[0].path).toBe('.agents/skills/adab-draft/SKILL.md');
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
    expect(files[0].content).toContain('Read `{{context_pack.mustRead}}`');
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

  it('overwrites files when hash differs (user modifications NOT preserved)', async () => {
    const path = join(tempDir, 'a.md');
    writeFileSync(path, 'old');
    const files = [{ path: 'a.md', content: 'new' }];
    const written = await writeGeneratedFiles(tempDir, files);
    expect(written).toContain('a.md');
    const content = readFileSync(path, 'utf-8');
    expect(content).toBe('new');
  });
});
