/**
 * Integration test: wiki-diff round-trip.
 *
 * Parses a wiki-diff Markdown document, applies it to wiki pages, and
 * verifies the pages are updated correctly with no data loss.
 */
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { beforeEach, describe, expect, it } from 'vitest';

import { WikiDiffApplier, WikiDiffParser } from '../../src/modules/wiki-diff-engine/index.js';
import { WikiEngine } from '../../src/modules/wiki-engine/index.js';

import { createMinimalProject } from './fixture.js';

describe('wiki-diff round-trip', () => {
  let projectRoot: string;

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), 'openadab-'));
    await createMinimalProject(projectRoot);
  });

  it('24.4 parses and applies wiki-diff, updating wiki pages', async () => {
    const wikiEngine = new WikiEngine(projectRoot);
    const applier = new WikiDiffApplier(projectRoot, wikiEngine);

    const diffMarkdown = `---
changeId: ch-002
---

### [[characters/mara]]

Source: ch-002/continuity-report.md

#### Add to Current State

- Hiding in the old warehouse.

#### Add to Knowledge Timeline

| Chapter | Knowledge |
|---------|-----------|
| 002 | Learned warehouse guard rotation |

#### Update Relationship

Mara and Docks are now familiar

#### Update Field

status: injured
`;

    const parser = new WikiDiffParser();
    const doc = await parser.parse(diffMarkdown);
    expect(doc.operations.length).toBeGreaterThan(0);

    const result = await applier.apply(doc, false);
    expect(result.success).toBe(true);
    expect(result.pagesModified).toBeGreaterThan(0);

    const updatedPage = await wikiEngine.readPage('characters/mara.md');
    const body = updatedPage.body;
    expect(body).toContain('Hiding in the old warehouse');
    expect(body).toContain('Learned warehouse guard rotation');
    expect(body).toContain('Docks: familiar');
    expect(updatedPage.frontmatter.status).toBe('injured');

    // Verify original content preserved
    expect(body).toContain('A skilled thief with a hidden past');
  });

  it('24.4 edge: dry-run does not modify files', async () => {
    const wikiEngine = new WikiEngine(projectRoot);
    const applier = new WikiDiffApplier(projectRoot, wikiEngine);

    const diffMarkdown = `---
changeId: ch-003
---

### [[characters/mara]]

Source: ch-003/continuity-report.md

#### Update Field

status: captured
`;

    const parser = new WikiDiffParser();
    const doc = await parser.parse(diffMarkdown);
    const result = await applier.apply(doc, true);
    expect(result.success).toBe(true);

    const page = await wikiEngine.readPage('characters/mara.md');
    expect(page.frontmatter.status).not.toBe('captured');
  });
});
