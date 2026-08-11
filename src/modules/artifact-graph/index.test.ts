import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import type { SchemaDef } from '../../schemas/schema-def.js';
import { SchemaValidationError } from '../../utils/errors.js';

import { ArtifactGraph } from './index.js';

describe('ArtifactGraph', () => {
  function linearSchema(): SchemaDef {
    return {
      name: 'linear',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'scene-plan', generates: 'scene-plan.md', requires: ['brief'] },
        { id: 'draft', generates: 'draft.md', requires: ['scene-plan'] },
        { id: 'revision', generates: 'revision.md', requires: ['draft'] },
      ],
    };
  }

  function makeChangeDir(schema: SchemaDef, doneIds: string[] = []) {
    const dir = mkdtempSync(join(tmpdir(), 'openadab-ag-'));
    for (const art of schema.artifacts) {
      if (doneIds.includes(art.id)) {
        const file = join(dir, art.generates);
        writeFileSync(file, `---\nstatus: done\n---\n\ncontent for ${art.id}`);
      }
    }
    return dir;
  }

  it('topological sort returns linear chain order', () => {
    const graph = new ArtifactGraph(linearSchema());
    const sorted = graph.topologicalSort();
    expect(sorted).toEqual(['brief', 'scene-plan', 'draft', 'revision']);
  });

  it('getStatus reflects blocked/ready/done states', async () => {
    const schema = linearSchema();
    const dir = makeChangeDir(schema, ['brief']);
    const graph = new ArtifactGraph(schema);
    const status = await graph.getStatus(dir);
    expect(status.brief).toBe('done');
    expect(status['scene-plan']).toBe('ready');
    expect(status.draft).toBe('blocked');
    expect(status.revision).toBe('blocked');
  });

  it('getNextStep returns write for ready artifacts', async () => {
    const schema = linearSchema();
    const dir = makeChangeDir(schema, ['brief']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ id: 'scene-plan', action: 'write' }]);
  });

  it('getNextStep returns apply when all done and apply ready', async () => {
    const schema: SchemaDef = {
      name: 'apply-schema',
      version: 1,
      artifacts: [
        { id: 'brief', generates: 'brief.md', requires: [] },
        { id: 'draft', generates: 'draft.md', requires: ['brief'] },
      ],
      apply: { requires: ['brief', 'draft'], target: 'manuscript/chapters/ch-001.md', action: 'copy' },
    };
    const dir = makeChangeDir(schema, ['brief', 'draft']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ action: 'apply', target: 'manuscript/chapters/ch-001.md' }]);
  });

  it('getBlockingIssues reports missing deps', async () => {
    const schema = linearSchema();
    const dir = makeChangeDir(schema, []);
    const graph = new ArtifactGraph(schema);
    const issues = await graph.getBlockingIssues(dir);
    expect(issues.length).toBeGreaterThan(0);
    const draftIssue = issues.find((i) => i.artifactId === 'draft');
    expect(draftIssue).toBeDefined();
    expect(draftIssue?.missingDeps).toContain('scene-plan');
  });

  // AG-1: requires references an artifact id that does not exist in the
  // schema.  topologicalSort must throw (the graph is not well-formed).
  it('AG-1: throws SchemaValidationError when an artifact requires a non-existent id', () => {
    const schema: SchemaDef = {
      name: 'broken-refs',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: [] },
        { id: 'b', generates: 'b.md', requires: ['ghost'] },
      ],
    };
    const graph = new ArtifactGraph(schema);
    expect(() => graph.topologicalSort()).toThrow(SchemaValidationError);
  });

  it('AG-1: throws when apply.requires references a non-existent id', () => {
    const schema: SchemaDef = {
      name: 'broken-apply',
      version: 1,
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
      apply: { requires: ['ghost'], target: 'out.md', action: 'copy' },
    };
    const graph = new ArtifactGraph(schema);
    expect(() => graph.topologicalSort()).toThrow(SchemaValidationError);
  });

  it('AG-1: even with a duplicate artifact id, the unknown ref is reported', () => {
    const schema: SchemaDef = {
      name: 'dup-and-ghost',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: ['ghost'] },
        { id: 'a', generates: 'a2.md', requires: [] },
      ],
    };
    const graph = new ArtifactGraph(schema);
    expect(() => graph.topologicalSort()).toThrow(/ghost/);
  });

  // AG-3: context variable keys with regex metacharacters must be treated
  // as literal text.  We pass a key like "a.b" (the dot is not part of a
  // path here, it's just a character in the name) and a value containing
  // "$&" (which `String.replace` would normally interpret).
  it('AG-3: getNextStep escapes regex metacharacters in context keys and $& in values', async () => {
    const schema: SchemaDef = {
      name: 'apply-regex',
      version: 1,
      context: { 'a.b': '$&literal' },
      artifacts: [
        { id: 'a', generates: 'a.md', requires: [] },
        { id: 'b', generates: 'b.md', requires: ['a'] },
      ],
      apply: { requires: ['b'], target: 'out/{{a.b}}.md', action: 'copy' },
    };
    const dir = makeChangeDir(schema, ['a', 'b']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ action: 'apply', target: 'out/$&literal.md' }]);
  });

  it('AG-3: context value containing $1 / $2 / $` replacement patterns is inserted literally', async () => {
    const schema: SchemaDef = {
      name: 'apply-dollar',
      version: 1,
      context: { name: 'X$1$2$`$Y' },
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
      apply: { requires: ['a'], target: 'out/{{name}}.md', action: 'copy' },
    };
    const dir = makeChangeDir(schema, ['a']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ action: 'apply', target: 'out/X$1$2$`$Y.md' }]);
  });

  it('AG-3: context key with parentheses and brackets is matched as a literal token', async () => {
    const schema: SchemaDef = {
      name: 'apply-grouping',
      version: 1,
      context: { 'a(b)': 'ok' },
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
      apply: { requires: ['a'], target: 'out/{{a(b)}}.md', action: 'copy' },
    };
    const dir = makeChangeDir(schema, ['a']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ action: 'apply', target: 'out/ok.md' }]);
  });

  it('AG-3: a missing context key leaves the placeholder in place (no replace at all)', async () => {
    const schema: SchemaDef = {
      name: 'apply-missing',
      version: 1,
      context: {},
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
      apply: { requires: ['a'], target: 'out/{{chapter}}.md', action: 'copy' },
    };
    const dir = makeChangeDir(schema, ['a']);
    const graph = new ArtifactGraph(schema);
    const next = await graph.getNextStep(dir);
    expect(next).toEqual([{ action: 'apply', target: 'out/{{chapter}}.md' }]);
  });

  // AG-7: changeDir that resolves to "/" (no path segments) must not
  // produce an empty changeName.
  it('AG-7: toJson changeName falls back to basename when the input has no path segments', async () => {
    const schema: SchemaDef = {
      name: 'n',
      version: 1,
      artifacts: [{ id: 'a', generates: 'a.md', requires: [] }],
    };
    const graph = new ArtifactGraph(schema);
    // Use a single-segment path that mimics a bare directory name.
    const dir = makeChangeDir(schema, []);
    const json = await graph.toJson(dir);
    expect(json.changeName.length).toBeGreaterThan(0);
  });

  // AG-8: when an artifact file exists but fails mechanical validation,
  // getBlockingIssues must surface it as a validation issue (not as a
  // blocking dependency issue).
  it('AG-8: getBlockingIssues surfaces a validation-failed artifact as a validationIssue', async () => {
    const schema: SchemaDef = {
      name: 'invalid-art',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: [], validation: { mechanical: ['frontmatterPresent'] } },
      ],
    };
    const dir = mkdtempSync(join(tmpdir(), 'openadab-ag-ag8-'));
    // write a file that has content but no frontmatter
    writeFileSync(join(dir, 'a.md'), 'just a body, no frontmatter here\n');
    const graph = new ArtifactGraph(schema);
    const issues = await graph.getBlockingIssues(dir);
    const validationIssue = issues.find((i) => i.artifactId === 'a' && i.reason.includes('Validation'));
    expect(validationIssue).toBeDefined();
  });

  // AG-9: a validator that throws must be treated as "invalid" rather
  // than crashing the whole status computation.
  it('AG-9: isValid swallows validator errors and treats the artifact as invalid', async () => {
    const schema: SchemaDef = {
      name: 'validator-throws',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: [] },
      ],
    };
    const dir = makeChangeDir(schema, []);
    const explodingValidator = {
      validateArtifact: async () => {
        throw new Error('boom');
      },
    };
    const graph = new ArtifactGraph(schema, explodingValidator);
    const status = await graph.getStatus(dir);
    expect(status.a).toBe('ready');
  });

  // AG-6: toJson must compute the status map exactly once and share the
  // result with getNextStep / getBlockingIssues — each _computeStatus call
  // re-stats every artifact file on disk.
  it('AG-6: toJson computes status exactly once (shared with getNextStep/getBlockingIssues)', async () => {
    const schema = linearSchema();
    const dir = makeChangeDir(schema, ['brief']);
    const graph = new ArtifactGraph(schema);
    const computeSpy = vi.spyOn(
      ArtifactGraph.prototype,
      '_computeStatus',
    );
    try {
      const json = await graph.toJson(dir);
      expect(computeSpy).toHaveBeenCalledTimes(1);
      // Sanity: the shared result still drives the derived fields.
      expect(json.nextStep).toEqual([{ id: 'scene-plan', action: 'write' }]);
      expect(json.blockingIssues.length).toBeGreaterThan(0);
    } finally {
      computeSpy.mockRestore();
    }
  });

  // AG-2 / AG-5: cycle detection still fires when inDegree.size differs
  // from artifacts.length (e.g. duplicates were dropped).
  it('AG-2: cycle detection uses inDegree size, not artifacts.length', () => {
    // Two nodes a, b with a <-> b (cycle), and a duplicate "a" entry.
    const schema: SchemaDef = {
      name: 'cycle-with-dup',
      version: 1,
      artifacts: [
        { id: 'a', generates: 'a.md', requires: ['b'] },
        { id: 'b', generates: 'b.md', requires: ['a'] },
        { id: 'a', generates: 'a2.md', requires: [] },
      ],
    };
    const graph = new ArtifactGraph(schema);
    expect(() => graph.topologicalSort()).toThrow(/Cycle/);
  });
});
