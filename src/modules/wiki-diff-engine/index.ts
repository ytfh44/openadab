/**
 * Wiki Diff Engine — parses semantic wiki-diff Markdown into structured
 * operations and applies them to project wiki pages.
 */
import { join } from 'node:path';

import type { Root, Heading, Yaml } from 'mdast';
import remarkFrontmatter from 'remark-frontmatter';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { WikiDiffDocument, WikiDiffOperation } from '../../schemas/wiki-diff.js';
import { WikiDiffParseError, TargetNotFoundError, MissingSourceError, AdabError } from '../../utils/errors.js';
import { safeReadFile, atomicWriteFile, fileExists } from '../../utils/fs.js';
import { resolveWithinBoundary } from '../../utils/path.js';
import { extractSectionsByHeading } from '../../utils/markdown.js';
import type { WikiEngine } from '../wiki-engine/index.js';

/**
 * Result of applying a wiki-diff document.
 */
export interface ApplyResult {
  /** Whether the application succeeded. */
  success: boolean;
  /** Number of operations processed. */
  operationsApplied: number;
  /** Number of pages that would be / were modified. */
  pagesModified: number;
  /** Number of contradictions flagged. */
  contradictionsFlagged: number;
  /** Human-readable summary of changes. */
  summary: string;
  /** Warnings emitted during application. */
  warnings: string[];
}

/**
 * Parses wiki-diff Markdown documents into structured operations.
 */
export class WikiDiffParser {
  /**
   * Parse a wiki-diff Markdown string into a {@link WikiDiffDocument}.
   *
   * Uses unified + remark-parse to walk the AST and extract operations
   * declared under per-target headings.
   *
   * @param markdown Raw wiki-diff Markdown content.
   * @returns Parsed document with operations array.
   * @throws {WikiDiffParseError} On malformed or unrecognized sections.
   */
  async parse(markdown: string): Promise<WikiDiffDocument> {
    const processor = unified().use(remarkParse).use(remarkFrontmatter);
    const tree = processor.parse(markdown);

    let changeId = '';
    const operations: WikiDiffOperation[] = [];
    const seen = new Set<string>();

    const yamlNode = tree.children.find((c): c is Yaml => c.type === 'yaml');
    if (yamlNode && 'value' in yamlNode) {
      const fm = yamlNode.value;
      const idMatch = /changeId:\s*(.+)/.exec(fm);
      if (idMatch !== null) {changeId = idMatch[1].trim();}
    }

    let i = 0;
    while (i < tree.children.length) {
      const node = tree.children[i];
      if (node.type === 'heading' && node.depth === 3) {
        const target = this.extractHeadingText(node);
        const targetMatch = /\[\[(.+?)\]\]/.exec(target);
        if (targetMatch === null) {
          i++;
          continue;
        }
        const targetPath = `${targetMatch[1]}.md`;

        const blockEnd = this.findBlockEnd(tree.children, i);
        const blockNodes = tree.children.slice(i + 1, blockEnd);
        const blockMarkdown = this.nodesToMarkdown(blockNodes, markdown);
        const ops = this.parseBlock(blockMarkdown, targetPath, markdown, i);
        for (const op of ops) {
          const key = `${op.type}:${op.target}:${JSON.stringify(op)}`;
          if (seen.has(key)) {
            throw new WikiDiffParseError(`Duplicate operation detected for target ${op.target}`);
          }
          seen.add(key);
          operations.push(op);
        }
        i = blockEnd;
        continue;
      }
      i++;
    }

    if (changeId === '') {
      const fallback = /changeId:\s*(.+)/.exec(markdown);
      if (fallback !== null) {changeId = fallback[1].trim();}
    }

    return { changeId: changeId || 'unknown', operations };
  }

  /**
   * Extract plain text from a heading node.
   */
  private extractHeadingText(heading: Heading): string {
    const parts: string[] = [];
    for (const child of heading.children) {
      if (child.type === 'text') {
        parts.push(child.value);
      } else if (child.type === 'inlineCode') {
        parts.push(child.value);
      }
    }
    return parts.join('').trim();
  }

  /**
   * Find the index of the next heading at the same or higher level.
   */
  private findBlockEnd(nodes: Root['children'], start: number): number {
    const startNode = nodes[start];
    if (startNode.type !== 'heading') {
      return nodes.length;
    }
    const startDepth = startNode.depth;
    for (let j = start + 1; j < nodes.length; j++) {
      const node = nodes[j];
      if (node.type === 'heading' && node.depth <= startDepth) {
        return j;
      }
    }
    return nodes.length;
  }

  /**
   * Approximate line number for a node by counting preceding newlines.
   */
  private lineForNode(node: Root['children'][number], markdown: string): number {
    const index = 'position' in node && node.position !== undefined ? node.position.start.offset ?? 0 : 0;
    return markdown.slice(0, index).split('\n').length;
  }

  /**
   * Convert a slice of mdast nodes back to raw Markdown text.
   */
  private nodesToMarkdown(nodes: Root['children'][number][], fullMarkdown: string): string {
    if (nodes.length === 0) {return '';}
    const firstNode = nodes[0];
    const start = 'position' in firstNode && firstNode.position !== undefined ? firstNode.position.start.offset ?? 0 : 0;
    const last = nodes[nodes.length - 1];
    const end = 'position' in last && last.position !== undefined ? last.position.end.offset ?? fullMarkdown.length : fullMarkdown.length;
    return fullMarkdown.slice(start, end);
  }

  /**
   * Parse the Markdown block under a single target heading into operations.
   */
  private parseBlock(block: string, targetPath: string, _fullMarkdown: string, _headingIndex: number): WikiDiffOperation[] {
    const ops: WikiDiffOperation[] = [];
    const sourceMatch = /Source:\s*(.+)/.exec(block);
    const source = sourceMatch !== null ? sourceMatch[1].trim() : '';

    const currentState = extractSectionsByHeading(block, 'Add to Current State');
    if (currentState !== null) {
      for (const line of currentState.split('\n')) {
        const m = /^-\s+(.+)$/.exec(line);
        if (m !== null) {
          ops.push({ type: 'add_current_state', target: targetPath, source, content: m[1].trim() });
        }
      }
    }

    const knowledge = extractSectionsByHeading(block, 'Add to Knowledge Timeline');
    if (knowledge !== null) {
      for (const line of knowledge.split('\n')) {
        const m = /^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/.exec(line);
        if (m !== null) {
          const chapter = m[1].trim();
          const knowledgeText = m[2].trim();
          if (chapter !== 'Chapter' && !/^[-]+$/.test(chapter) && !/^[-]+$/.test(knowledgeText)) {
            ops.push({ type: 'add_knowledge_timeline', target: targetPath, source, chapter, knowledge: knowledgeText });
          }
        }
      }
    }

    const relationship = extractSectionsByHeading(block, 'Update Relationship');
    if (relationship !== null) {
      const m = /(.+?)\s+and\s+(.+?)\s+are\s+now\s+(.+)/.exec(relationship);
      if (m !== null) {
        ops.push({ type: 'update_relationship', target: targetPath, source, relatedEntity: m[2].trim(), relationship: m[3].trim() });
      }
    }

    const threadStatus = extractSectionsByHeading(block, 'Update Thread Status');
    if (threadStatus !== null) {
      const statusMatch = /Status:\s*(\S+)/.exec(threadStatus);
      const evidenceMatches = threadStatus.match(/New evidence:\s*(.+)/g);
      const evidence = evidenceMatches !== null ? evidenceMatches.map((s) => s.replace(/New evidence:\s*/, '').trim()) : undefined;
      if (statusMatch !== null) {
        const rawStatus = statusMatch[1].trim();
        const validStatuses = new Set(['open', 'advanced', 'resolved']);
        if (!validStatuses.has(rawStatus)) {
          throw new WikiDiffParseError(`Invalid thread status: "${rawStatus}" — must be one of: open, advanced, resolved`);
        }
        const status = rawStatus as 'open' | 'advanced' | 'resolved';
        ops.push({ type: 'update_thread_status', target: targetPath, source, status, evidence });
      }
    }

    const evidenceSection = extractSectionsByHeading(block, 'Add Evidence');
    if (evidenceSection !== null) {
      for (const line of evidenceSection.split('\n')) {
        const m = /^-\s+(.+)$/.exec(line);
        if (m !== null) {
          ops.push({ type: 'add_evidence', target: targetPath, source, evidence: m[1].trim() });
        }
      }
    }

    const contradiction = extractSectionsByHeading(block, 'Flag Contradiction');
    if (contradiction !== null) {
      const descMatch = /Description:\s*(.+)/.exec(contradiction);
      const sources: { page: string; claim: string }[] = [];
      for (const line of contradiction.split('\n')) {
        const m = /^-\s+(.+?):\s*(.+)$/.exec(line);
        if (m !== null) {sources.push({ page: m[1].trim(), claim: m[2].trim() });}
      }
      if (descMatch !== null) {
        ops.push({ type: 'flag_contradiction', target: targetPath, source, description: descMatch[1].trim(), sources, status: 'unresolved' });
      }
    }

    const fieldUpdate = extractSectionsByHeading(block, 'Update Field');
    if (fieldUpdate !== null) {
      const fm = /^([\w]+):\s*(.+)$/m.exec(fieldUpdate);
      if (fm !== null) {
        const rawValue = fm[2].trim();
        let value: unknown = rawValue;
        if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
          value = Number(rawValue);
        } else if (rawValue === 'true') {
          value = true;
        } else if (rawValue === 'false') {
          value = false;
        }
        ops.push({ type: 'update_field', target: targetPath, source, field: fm[1].trim(), value });
      }
    }

    // Validate that all #### headings are recognized sections
    const knownSections = [
      'Add to Current State',
      'Add to Knowledge Timeline',
      'Update Relationship',
      'Update Thread Status',
      'Add Evidence',
      'Flag Contradiction',
      'Update Field',
    ];
    const allSectionHeaders = block.match(/^####\s+(.+)$/gm);
    if (allSectionHeaders !== null) {
      for (const header of allSectionHeaders) {
        const name = header.replace(/^####\s+/, '').trim();
        if (!knownSections.includes(name)) {
          const headerIndex = _fullMarkdown.indexOf(header);
          const lineNum = headerIndex >= 0 ? _fullMarkdown.slice(0, headerIndex).split('\n').length : 0;
          throw new WikiDiffParseError(`Unrecognized section header: "${name}" at line ${String(lineNum)}`);
        }
      }
    }

    return ops;
  }
}

/**
 * Applies parsed wiki-diff operations to wiki pages.
 */
export class WikiDiffApplier {
  private readonly wikiEngine: WikiEngine;
  private readonly projectRoot: string;

  /**
   * @param projectRoot Absolute path to the project root.
   * @param wikiEngine  Wiki engine for reading and writing pages.
   */
  constructor(projectRoot: string, wikiEngine: WikiEngine) {
    this.projectRoot = projectRoot;
    this.wikiEngine = wikiEngine;
  }

  /**
   * Apply a parsed wiki-diff document to the project wiki.
   *
   * In dry-run mode, validates all operations and returns a summary of what
   * would change without writing any files. In apply mode, executes all
   * validated operations and writes files.
   *
   * @param document Parsed wiki-diff document.
   * @param dryRun   If true, do not write any files.
   * @returns Result describing applied / would-be changes.
   */
  async apply(document: WikiDiffDocument, dryRun = false): Promise<ApplyResult> {
    const warnings: string[] = [];
    const errors: string[] = [];

    for (const op of document.operations) {
      try {
        await this.validateOperation(op);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }

    if (errors.length > 0) {
      return {
        success: false,
        operationsApplied: 0,
        pagesModified: 0,
        contradictionsFlagged: 0,
        summary: `Validation failed with ${String(errors.length)} error(s): ${errors.join('; ')}`,
        warnings,
      };
    }

    const modifiedPages = new Set<string>();
    const pageChangeCounts = new Map<string, { count: number; details: string[] }>();
    let contradictionsFlagged = 0;

    if (!dryRun) {
      this.wikiEngine.beginBatch();
    }
    for (const op of document.operations) {
      try {
        const staleWarning = await this.checkIdempotency(op);
        if (staleWarning !== null) {warnings.push(staleWarning);}
      } catch (err) {
        console.warn('[WikiDiffApplier] Idempotency check failed:', err instanceof Error ? err.message : String(err));
      }

      if (!dryRun) {
        // Track page change counts for summary in non-dry-run mode (B21 fix)
        // Note: contradictionsFlagged is incremented in the switch case below
        if (op.type !== 'flag_contradiction') {
          modifiedPages.add(op.target);
          const existing = pageChangeCounts.get(op.target) ?? { count: 0, details: [] };
          existing.count++;
          if (op.type === 'update_thread_status') {
            let oldStatus = '?';
            try {
              const page = await this.wikiEngine.readPage(op.target);
              oldStatus = String(page.frontmatter.status ?? '?');
            } catch {
              // Keep '?' if page cannot be read
            }
            existing.details.push(`status: ${oldStatus}→${op.status}`);
          }
          pageChangeCounts.set(op.target, existing);
        }
        // Apply the operation
        switch (op.type) {
          case 'add_current_state':
            await this.applyAddCurrentState(op);
            modifiedPages.add(op.target);
            break;
          case 'add_knowledge_timeline':
            await this.applyAddKnowledgeTimeline(op);
            modifiedPages.add(op.target);
            break;
          case 'update_relationship':
            await this.applyUpdateRelationship(op);
            modifiedPages.add(op.target);
            break;
          case 'update_thread_status':
            await this.applyUpdateThreadStatus(op);
            modifiedPages.add(op.target);
            break;
          case 'add_evidence':
            await this.applyAddEvidence(op);
            modifiedPages.add(op.target);
            break;
          case 'flag_contradiction':
            await this.applyFlagContradiction(op);
            contradictionsFlagged++;
            break;
          case 'update_field':
            await this.applyUpdateField(op);
            modifiedPages.add(op.target);
            break;
        }
      } else {
        if (op.type === 'flag_contradiction') {
          contradictionsFlagged++;
        } else {
          modifiedPages.add(op.target);
          const existing = pageChangeCounts.get(op.target) ?? { count: 0, details: [] };
          existing.count++;
          if (op.type === 'update_thread_status') {
            let oldStatus = '?';
            try {
              const page = await this.wikiEngine.readPage(op.target);
              oldStatus = String(page.frontmatter.status ?? '?');
            } catch {
              // Keep '?' if page cannot be read
            }
            existing.details.push(`status: ${oldStatus}→${op.status}`);
          }
          pageChangeCounts.set(op.target, existing);
        }
      }
    }

    if (!dryRun) {
      await this.wikiEngine.endBatch();
    }

    const parts: string[] = [];
    for (const [page, info] of pageChangeCounts) {
      if (info.details.length > 0) {
        parts.push(`${page} (${info.details.join(', ')})`);
      } else {
        parts.push(`${page} (+${info.count} ${info.count === 1 ? 'entry' : 'entries'})`);
      }
    }
    if (contradictionsFlagged > 0) {
      parts.push(`contradictions.md (+${contradictionsFlagged} ${contradictionsFlagged === 1 ? 'entry' : 'entries'})`);
    }
    const detailStr = parts.length > 0 ? `: ${parts.join(', ')}` : '';
    const summary = dryRun
      ? `Would modify ${String(modifiedPages.size)} page(s)${detailStr}`
      : `Modified ${String(modifiedPages.size)} page(s)${detailStr}`;

    return {
      success: true,
      operationsApplied: document.operations.length,
      pagesModified: modifiedPages.size,
      contradictionsFlagged,
      summary,
      warnings,
    };
  }

  /**
   * Validate a single operation.
   *
   * Ensures the target page exists and the source citation is present.
   *
   * @param op Operation to validate.
   * @throws {TargetNotFoundError} If the target wiki page does not exist.
   * @throws {AdabError} If the source citation is missing.
   */
  private async validateOperation(op: WikiDiffOperation): Promise<void> {
    const targetPath = op.target;
    const absPath = resolveWithinBoundary(join(this.projectRoot, 'adab', 'wiki'), targetPath);
    if (!(await fileExists(absPath))) {
      throw new TargetNotFoundError(`Wiki page not found: ${targetPath}`);
    }
    if (op.source === '') {
      throw new MissingSourceError('Every wiki-diff operation must cite a manuscript or raw source path');
    }
  }

  /**
   * Check whether the target page has been updated more recently than the
   * operation's source chapter, indicating a potentially stale diff.
   *
   * @param op Operation to check.
   * @returns Warning string if stale, otherwise null.
   */
  private async checkIdempotency(op: WikiDiffOperation): Promise<string | null> {
    if (op.type === 'flag_contradiction') {return null;}
    try {
      const page = await this.wikiEngine.readPage(op.target);
      const lastUpdated = page.frontmatter.last_updated;
      if (typeof lastUpdated === 'string' && op.source !== '') {
        const sourceChapter = /ch-(\d+)/.exec(op.source);
        if (sourceChapter) {
          const pageChapter = /ch-(\d+)/.exec(lastUpdated);
          if (pageChapter) {
            const sourceNum = parseInt(sourceChapter[1], 10);
            const pageNum = parseInt(pageChapter[1], 10);
            if (pageNum > sourceNum) {
              return `Target page ${op.target} was updated by a later chapter — diff may be stale`;
            }
          }
        }
      }
    } catch (err) {
      console.warn('[WikiDiff] Idempotency check failed:', err instanceof Error ? err.message : String(err));
    }
    return null;
  }

  /**
   * Append an entry to the "## Current State" section of a character page.
   */
  private async applyAddCurrentState(op: Extract<WikiDiffOperation, { type: 'add_current_state' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    let body = page.body;
    const section = extractSectionsByHeading(body, 'Current State');
    if (section !== null) {
      const insertIndex = body.indexOf(section) + section.length;
      body = `${body.slice(0, insertIndex)}\n- ${op.content}\n${body.slice(insertIndex)}`;
    } else {
      body += `\n## Current State\n\n- ${op.content}\n`;
    }
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
  }

  /**
   * Append a row to the "Knowledge Timeline" table of a character page.
   */
  private async applyAddKnowledgeTimeline(op: Extract<WikiDiffOperation, { type: 'add_knowledge_timeline' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    let body = page.body;
    const section = extractSectionsByHeading(body, 'Knowledge Timeline');
    const row = `| ${op.chapter} | ${op.knowledge} |`;
    if (section !== null) {
      const insertIndex = body.indexOf(section) + section.length;
      body = `${body.slice(0, insertIndex)}\n${row}\n${body.slice(insertIndex)}`;
    } else {
      body += `\n## Knowledge Timeline\n\n| Chapter | Knowledge |\n|---------|-----------|\n${row}\n`;
    }
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
  }

  /**
   * Append or update a relationship entry in the "Relationships" section.
   */
  private async applyUpdateRelationship(op: Extract<WikiDiffOperation, { type: 'update_relationship' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    let body = page.body;
    const section = extractSectionsByHeading(body, 'Relationships');
    const entry = `- ${op.relatedEntity}: ${op.relationship}`;
    if (section !== null) {
      const existingIndex = body.indexOf(entry);
      if (existingIndex !== -1) {
        const start = body.lastIndexOf('\n', existingIndex) + 1;
        const end = body.indexOf('\n', existingIndex);
        body = body.slice(0, start) + entry + body.slice(end === -1 ? body.length : end);
      } else {
        const insertIndex = body.indexOf(section) + section.length;
        body = `${body.slice(0, insertIndex)}\n${entry}\n${body.slice(insertIndex)}`;
      }
    } else {
      body += `\n## Relationships\n\n${entry}\n`;
    }
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);

    // Bidirectional update: also update the related entity's page if it exists.
    try {
      const targetName = String(page.frontmatter.name ?? op.target.replace(/\.md$/, '').split('/').pop() ?? '');
      const allPages = await this.wikiEngine.listPages();
      let relatedPagePath: string | null = null;
      for (const p of allPages) {
        try {
          const candidate = await this.wikiEngine.readPage(p);
          if (String(candidate.frontmatter.name ?? '').toLowerCase() === op.relatedEntity.toLowerCase()) {
            relatedPagePath = p;
            break;
          }
        } catch (err) {
          console.warn('[WikiDiff] Skipping unreadable page during relationship lookup:', err instanceof Error ? err.message : String(err));
        }
      }
      if (relatedPagePath === null) {
        console.warn(`[WikiDiff] Related entity "${op.relatedEntity}" not found in wiki — skipping bidirectional update`);
        return;
      }
      const relatedPage = await this.wikiEngine.readPage(relatedPagePath);
      let relatedBody = relatedPage.body;
      const relatedSection = extractSectionsByHeading(relatedBody, 'Relationships');
      const relatedEntry = `- ${targetName}: ${op.relationship}`;
      if (relatedSection !== null) {
        const existingIndex = relatedBody.indexOf(relatedEntry);
        if (existingIndex !== -1) {
          const start = relatedBody.lastIndexOf('\n', existingIndex) + 1;
          const end = relatedBody.indexOf('\n', existingIndex);
          relatedBody = relatedBody.slice(0, start) + relatedEntry + relatedBody.slice(end === -1 ? relatedBody.length : end);
        } else {
          const insertIndex = relatedBody.indexOf(relatedSection) + relatedSection.length;
          relatedBody = `${relatedBody.slice(0, insertIndex)}\n${relatedEntry}\n${relatedBody.slice(insertIndex)}`;
        }
      } else {
        relatedBody += `\n## Relationships\n\n${relatedEntry}\n`;
      }
      relatedPage.frontmatter.last_updated = op.source;
      await this.wikiEngine.writePage(relatedPagePath, { ...relatedPage.frontmatter }, relatedBody);
    } catch (err) {
      console.warn(`[WikiDiff] Failed bidirectional update for ${op.relatedEntity}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Update a thread page's status field and append new evidence.
   */
  private async applyUpdateThreadStatus(op: Extract<WikiDiffOperation, { type: 'update_thread_status' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    const oldBody = page.body;
    const oldStatus = page.frontmatter.status;
    page.frontmatter.status = op.status;
    let body = page.body;
    if (op.evidence !== undefined && op.evidence.length > 0) {
      const section = extractSectionsByHeading(body, 'Evidence');
      const lines = op.evidence.map((e) => `- ${e}`).join('\n');
      if (section !== null) {
        const insertIndex = body.indexOf(section) + section.length;
        body = `${body.slice(0, insertIndex)}\n${lines}\n${body.slice(insertIndex)}`;
      } else {
        body += `\n## Evidence\n\n${lines}\n`;
      }
    }
    // Skip write if nothing changed (B9 fix)
    if (body === oldBody && oldStatus === op.status) {return;}
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
  }

  /**
   * Append evidence to a thread page's evidence list.
   */
  private async applyAddEvidence(op: Extract<WikiDiffOperation, { type: 'add_evidence' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    const oldBody = page.body;
    let body = page.body;
    const section = extractSectionsByHeading(body, 'Evidence');
    if (section !== null) {
      const insertIndex = body.indexOf(section) + section.length;
      body = `${body.slice(0, insertIndex)}\n- ${op.evidence}\n${body.slice(insertIndex)}`;
    } else {
      body += `\n## Evidence\n\n- ${op.evidence}\n`;
    }
    // Skip write if nothing changed (B9 fix)
    if (body === oldBody) {return;}
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
  }

  /**
   * Append a contradiction entry to `adab/wiki/contradictions.md`.
   */
  private async applyFlagContradiction(op: Extract<WikiDiffOperation, { type: 'flag_contradiction' }>): Promise<void> {
    const lines: string[] = [];
    lines.push(`## ${op.description}\n`);
    for (const src of op.sources) {
      lines.push(`- **${src.page}**: ${src.claim}`);
    }
    lines.push(`- Status: ${op.status}`);
    lines.push('');

    const contradictionsPath = resolveWithinBoundary(join(this.projectRoot, 'adab', 'wiki'), 'contradictions.md');
    let existing = '';
    try {
      existing = (await safeReadFile(contradictionsPath)) ?? '';
    } catch (err) {
      console.warn('[WikiDiff] Could not read contradictions.md, starting fresh:', err instanceof Error ? err.message : String(err));
    }
    const output = `${existing}\n${lines.join('\n')}`;
    await atomicWriteFile(contradictionsPath, `${output.trim()}\n`);
  }

  /**
   * Update a frontmatter field on a wiki page.
   */
  private async applyUpdateField(op: Extract<WikiDiffOperation, { type: 'update_field' }>): Promise<void> {
    const page = await this.wikiEngine.readPage(op.target);
    const existing = page.frontmatter[op.field];
    if (existing !== undefined && existing !== null) {
      const existingType = typeof existing;
      const newType = typeof op.value;
      if (existingType !== newType) {
        throw new AdabError(
          `Type mismatch for field '${op.field}' in ${op.target}: existing type is ${existingType}, but new value has type ${newType}`,
          'WIKI_DIFF_TYPE_MISMATCH',
        );
      }
      // Skip write if value unchanged (B9 fix)
      if (existing === op.value) {return;}
    }
    page.frontmatter[op.field] = op.value;
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, page.body);
  }
}
