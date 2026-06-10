import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, it, expect } from 'vitest';

import type { SchemaDef } from '../../schemas/schema-def.js';

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
});
