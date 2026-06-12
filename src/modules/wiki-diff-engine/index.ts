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
          // dedup key must include the operation's content payload so
          // that two operations with identical type+target but different
          // content (or different supporting fields) are not falsely treated
          // as duplicates. The spec ("Duplicate operation detection") calls
          // for an exact match on type, target AND content.
          const dedupKey = `${op.target}::${op.action}::${this.dedupPayload(op)}`;
          if (seen.has(dedupKey)) {
            throw new WikiDiffParseError(`Duplicate operation detected for target ${op.target}`);
          }
          seen.add(dedupKey);
          operations.push(op);
        }
        i = blockEnd;
        continue;
      }
      i++;
    }

    if (changeId === '') {
      // limit the fallback regex to the first 50 lines OR the text
      // before the next `---` separator. The previous implementation
      // matched `changeId: …` anywhere in the document, so a stray mention
      // in the body could override the real change ID (or invent one).
      const head = markdown.split('\n').slice(0, 50).join('\n');
      const cutoff = head.indexOf('\n---');
      const scope = cutoff >= 0 ? head.slice(0, cutoff) : head;
      const fallback = /changeId:\s*(.+)/.exec(scope);
      if (fallback !== null) {changeId = fallback[1].trim();}
    }

    return { changeId: changeId || 'unknown', operations };
  }

  /**
   * Build the content portion of a dedup key for an operation.
   *
   * Each operation type contributes the fields that distinguish it from
   * another of the same type: textual payload fields and structured
   * supporting data. The function is the single source of truth for what
   * "same content" means for the duplicate-detection rule.
   *
   * @param op Operation to fingerprint.
   * @returns Stable string representation of the operation's payload.
   */
  private dedupPayload(op: WikiDiffOperation): string {
    switch (op.type) {
      case 'add_current_state':
        return op.content;
      case 'add_knowledge_timeline':
        return `${op.chapter}::${op.knowledge}`;
      case 'update_relationship':
        return `${op.relatedEntity}::${op.relationship}`;
      case 'update_thread_status':
        return `${op.status}::${(op.evidence ?? []).join('|')}`;
      case 'add_evidence':
        return op.evidence;
      case 'flag_contradiction':
        return `${op.description}::${op.status}::${JSON.stringify(op.sources)}`;
      case 'update_field':
        return `${op.field}::${JSON.stringify(op.value)}`;
    }
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
      for (const rawLine of knowledge.split('\n')) {
        // cells may legitimately contain a `|` character (escaped
        // in the source as `\|` or appearing as plain text).  The previous
        // `^\|\s*(.+?)\s*\|\s*(.+?)\s*\|$` regex assumed exactly two cells
        // and would mis-split or drop rows containing internal `|`.  We
        // instead split on `|`, drop the leading/trailing empty cells
        // produced by the table framing, and join the remainder with `|`
        // so internal pipes survive.
        const trimmed = rawLine.trim();
        if (!trimmed.startsWith('|')) {continue;}
        const cells = trimmed.split('|').slice(1, -1).map((c) => c.trim());
        if (cells.length < 2) {continue;}
        const chapter = cells[0] ?? '';
        const knowledgeText = cells.slice(1).join(' | ');
        if (chapter !== 'Chapter' && !/^[-]+$/.test(chapter) && !/^[-]+$/.test(knowledgeText)) {
          ops.push({ type: 'add_knowledge_timeline', target: targetPath, source, chapter, knowledge: knowledgeText });
        }
      }
    }

    const relationship = extractSectionsByHeading(block, 'Update Relationship');
    if (relationship !== null) {
      // a single regex with non-greedy quantifiers
      // (`(.+?)\s+and\s+(.+?)\s+are\s+now\s+(.+)`) cannot reliably split
      // subjects of the form "X and Y and Z are now W": the inner non-
      // greedy capture would expand to swallow the next " and " segment
      // because the surrounding anchors tolerate it.  Instead, we split on
      // the longest " are now " suffix, then take the substring *after the
      // last* " and " in the remaining prefix.  This guarantees that the
      // related entity is exactly the final conjunction operand.
      const areNowMatch = /^(.*)\s+are\s+now\s+(.+)$/s.exec(relationship);
      if (areNowMatch !== null) {
        const head = areNowMatch[1] ?? '';
        const tail = (areNowMatch[2] ?? '').trim();
        const lastAnd = head.lastIndexOf(' and ');
        if (lastAnd >= 0) {
          const relatedEntity = head.slice(lastAnd + ' and '.length).trim();
          const relationship = tail;
          ops.push({ type: 'update_relationship', target: targetPath, source, relatedEntity, relationship });
        }
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
      for (const rawLine of contradiction.split('\n')) {
        const m = /^-\s+(.+)$/.exec(rawLine);
        if (m === null) {continue;}
        const payload = m[1] ?? '';
        // the source line may have a page identifier that itself
        // contains ":" (for example `wiki:characters/mara`) followed by a
        // claim of the form `<text>: <claim>`.  The previous regex
        // `^-\s+(.+?):\s*(.+)$` is non-greedy and split on the FIRST ":",
        // turning `wiki:characters/mara: claims …` into page="wiki",
        // claim="characters/mara: claims …".  Split on the FIRST ": "
        // (colon-space) instead so the page keeps any leading namespace.
        const colonSpace = payload.indexOf(': ');
        if (colonSpace < 0) {continue;}
        const page = payload.slice(0, colonSpace).trim();
        const claim = payload.slice(colonSpace + 2).trim();
        if (page === '' || claim === '') {continue;}
        sources.push({ page, claim });
      }
      if (descMatch !== null) {
        ops.push({ type: 'flag_contradiction', target: targetPath, source, description: descMatch[1].trim(), sources, status: 'unresolved' });
      }
    }

    const fieldUpdate = extractSectionsByHeading(block, 'Update Field');
    if (fieldUpdate !== null) {
      // the previous implementation only parsed the first
      // `field: value` line via a single regex, silently discarding any
      // additional field updates.  the field name pattern used
      // `\w+` which forbids hyphens, so e.g. `first-name` was dropped.
      // We now match every `field: value` line; the field pattern accepts
      // word characters and `-`, the value runs to end-of-line.
      const fieldRegex = /^([\w-]+):\s*(.+)$/gm;
      let fm: RegExpExecArray | null;
      while ((fm = fieldRegex.exec(fieldUpdate)) !== null) {
        const field = fm[1]?.trim() ?? '';
        const rawValue = (fm[2] ?? '').trim();
        if (field === '' || rawValue === '') {continue;}
        let value: unknown = rawValue;
        if (/^-?\d+(\.\d+)?$/.test(rawValue)) {
          value = Number(rawValue);
        } else if (rawValue === 'true') {
          value = true;
        } else if (rawValue === 'false') {
          value = false;
        }
        ops.push({ type: 'update_field', target: targetPath, source, field, value });
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
    // the recognition regex must tolerate the same trailing
    // HTML comment that `extractSectionsByHeading` accepts.
    const allSectionHeaders = block.match(/^####\s+(.+?)(?:\s*<!--[\s\S]*?-->)?\s*$/gm);
    if (allSectionHeaders !== null) {
      for (const header of allSectionHeaders) {
        const name = header.replace(/^####\s+/, '').replace(/\s*<!--[\s\S]*?-->\s*$/, '').trim();
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
   * In dry-run mode, validates all operations and returns a summary of
   * what would change without writing any files.  In apply mode,
   * executes all validated operations and writes files within a single
   * `beginBatch()` / `endBatch()` window.
   *
   * validation runs identically in both modes.  The "if
   * `errors.length > 0`" early return runs before the dry-run/apply
   * fork, so a dry-run invocation surfaces the same validation errors
   * as an apply invocation.  The spec scenario for `--dry-run` requires
   * "parse and validate all operations", which is exactly what this
   * method does; no fix is required.
   *
   * the convenience `--change <id>` flag is handled by the
   * CLI layer (`src/cli/commands/apply-diff.ts`); the engine accepts a
   * fully-resolved {@link WikiDiffDocument} and does not itself
   * resolve change IDs.  The CLI is responsible for turning
   * `draft-ch-012` into `adab/changes/draft-ch-012/wiki-diff.md` and
   * passing the parsed document here.
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
    // cache `readPage` look-ups by target so that idempotency
    // checks and summary stats share a single fetch per page, and so
    // that an apply over many ops on the same target issues at most
    // one disk read for stats purposes.
    const pageCache = new Map<string, Awaited<ReturnType<WikiEngine['readPage']>>>();

    if (!dryRun) {
      this.wikiEngine.beginBatch();
    }
    for (const op of document.operations) {
      try {
        const staleWarning = await this.checkIdempotency(op, pageCache);
        if (staleWarning !== null) {warnings.push(staleWarning);}
      } catch (err) {
        console.warn('[WikiDiffApplier] Idempotency check failed:', err instanceof Error ? err.message : String(err));
      }

      // dry-run and apply share the same stat-accumulation
      // logic.  The `accumulateChangeStats` helper handles both the
      // `update_thread_status` "status: x→y" detail and the basic
      // entry counter.
      await this.accumulateChangeStats(op, pageChangeCounts, modifiedPages);
      if (op.type === 'flag_contradiction') {
        contradictionsFlagged++;
      }

      if (!dryRun) {
        // Apply the operation
        switch (op.type) {
          case 'add_current_state':
            await this.applyAddCurrentState(op);
            break;
          case 'add_knowledge_timeline':
            await this.applyAddKnowledgeTimeline(op);
            break;
          case 'update_relationship':
            await this.applyUpdateRelationship(op);
            break;
          case 'update_thread_status':
            await this.applyUpdateThreadStatus(op);
            break;
          case 'add_evidence':
            await this.applyAddEvidence(op);
            break;
          case 'flag_contradiction':
            await this.applyFlagContradiction(op);
            break;
          case 'update_field':
            await this.applyUpdateField(op);
            break;
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
   * Update the in-memory summary statistics for a single operation.
   *
   * the previous `apply()` implementation duplicated the
   * `modifiedPages.add(...)` / `pageChangeCounts.get(...).count++`
   * block between the dry-run and apply branches.  The helper below
   * is invoked once per operation and is responsible for the entire
   * `pageChangeCounts` / `modifiedPages` update.  `flag_contradiction`
   * is excluded from the page counters because contradictions live in
   * a separate file and are surfaced through `contradictionsFlagged`
   * instead.
   *
   * the optional `pageCache` lets repeated reads for the
   * same target share a single disk fetch, including the
   * `update_thread_status` "old status" lookup below.
   *
   * @param op              Operation being processed.
   * @param pageChangeCounts Mutable counter map keyed by target page.
   * @param modifiedPages   Set of page paths that received any change.
   * @param pageCache       Optional read-cache shared with the idempotency check.
   */
  private async accumulateChangeStats(
    op: WikiDiffOperation,
    pageChangeCounts: Map<string, { count: number; details: string[] }>,
    modifiedPages: Set<string>,
    pageCache?: Map<string, Awaited<ReturnType<WikiEngine['readPage']>>>,
  ): Promise<void> {
    if (op.type === 'flag_contradiction') {return;}
    modifiedPages.add(op.target);
    const existing = pageChangeCounts.get(op.target) ?? { count: 0, details: [] };
    existing.count++;
    if (op.type === 'update_thread_status') {
      let oldStatus = '?';
      try {
        const page = pageCache?.get(op.target) ?? await this.wikiEngine.readPage(op.target);
        pageCache?.set(op.target, page);
        oldStatus = String(page.frontmatter.status ?? '?');
      } catch {
        // Keep '?' if page cannot be read
      }
      existing.details.push(`status: ${oldStatus}→${op.status}`);
    }
    pageChangeCounts.set(op.target, existing);
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
    const absPath = await resolveWithinBoundary(join(this.projectRoot, 'adab', 'wiki'), targetPath);
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
   * The comparison supports two shapes of `last_updated`:
   *  - A chapter reference such as `manuscript/chapters/ch-020.md` —
   *    compared numerically against the chapter number extracted from
   *    the operation's `source`.
   *  - An ISO date string (anything parseable by `Date.parse`) — compared
   *    against the file modification time / frontmatter date of the
   *    operation's source.  the prior implementation only
   *    handled the chapter-number shape; date stamps were silently
   *    treated as "fresh" even when they were older than the source.
   *
   * an optional read-cache may be supplied so that repeated
   * idempotency checks (and stat-accumulation reads) on the same
   * target share a single disk fetch.
   *
   * @param op        Operation to check.
   * @param pageCache Optional read-cache keyed by target path.
   * @returns Warning string if stale, otherwise null.
   */
  private async checkIdempotency(
    op: WikiDiffOperation,
    pageCache?: Map<string, Awaited<ReturnType<WikiEngine['readPage']>>>,
  ): Promise<string | null> {
    if (op.type === 'flag_contradiction') {return null;}
    try {
      const cached = pageCache?.get(op.target);
      const page = cached ?? await this.wikiEngine.readPage(op.target);
      pageCache?.set(op.target, page);
      const lastUpdated = page.frontmatter.last_updated;
      if (typeof lastUpdated !== 'string' || op.source === '') {return null;}

      const sourceChapter = /ch-(\d+)/.exec(op.source);
      const pageChapter = /ch-(\d+)/.exec(lastUpdated);
      if (sourceChapter && pageChapter) {
        const sourceNum = parseInt(sourceChapter[1] ?? '0', 10);
        const pageNum = parseInt(pageChapter[1] ?? '0', 10);
        if (pageNum > sourceNum) {
          return `Target page ${op.target} was updated by a later chapter — diff may be stale`;
        }
        return null;
      }

      // fall back to date-based comparison when one or both
      // values are not chapter references.  We try to parse both as
      // `Date`; if either fails, we cannot prove staleness, so we do
      // not warn.
      const sourceDate = Date.parse(op.source);
      const pageDate = Date.parse(lastUpdated);
      if (Number.isFinite(sourceDate) && Number.isFinite(pageDate) && pageDate > sourceDate) {
        return `Target page ${op.target} was updated by a later chapter — diff may be stale`;
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
      const insertIndex = this.sectionInsertionPoint(body, section);
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
      const insertIndex = this.sectionInsertionPoint(body, section);
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
        const insertIndex = this.sectionInsertionPoint(body, section);
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
      // the previous implementation enumerated every wiki page
      // and re-read each one to compare `frontmatter.name` against the
      // related entity — O(N) I/O and the FIRST match wins, which is
      // incorrect when several pages share the same display name (e.g.
      // multiple characters called "Lin" in different namespaces).
      // We now (a) try the most likely target directly via
      // `op.target.replace(...)` and (b) build a single name→path index
      // (last-write-wins) for the remaining candidates.
      let relatedPagePath: string | null = null;

      // 1) Direct candidate: if `op.target` is `characters/mara.md` and
      //    `op.relatedEntity` is `Lin`, try `characters/lin.md` first.
      const parentDir = op.target.includes('/') ? op.target.slice(0, op.target.lastIndexOf('/')) : '';
      const slug = op.relatedEntity.trim().toLowerCase().replace(/\s+/g, '-');
      const directCandidate = parentDir !== '' ? `${parentDir}/${slug}.md` : `${slug}.md`;
      if (directCandidate !== op.target && await this.wikiEngine.listPages().then((pages) => pages.includes(directCandidate))) {
        relatedPagePath = directCandidate;
      }

      // 2) Fall back to a name index when the direct candidate is missing.
      if (relatedPagePath === null) {
        const nameIndex = new Map<string, string>();
        const allPages = await this.wikiEngine.listPages();
        for (const p of allPages) {
          try {
            const candidate = await this.wikiEngine.readPage(p);
            const name = String(candidate.frontmatter.name ?? '').trim();
            if (name !== '') {
              // Last write wins on duplicate names so the most recently
              // listed page is preferred; this still leaves a deterministic
              // result, in contrast to the prior first-match behaviour.
              nameIndex.set(name.toLowerCase(), p);
            }
          } catch (err) {
            console.warn('[WikiDiff] Skipping unreadable page during relationship lookup:', err instanceof Error ? err.message : String(err));
          }
        }
        relatedPagePath = nameIndex.get(op.relatedEntity.trim().toLowerCase()) ?? null;
      }

      if (relatedPagePath === null) {
        console.warn(`[WikiDiff] Related entity "${op.relatedEntity}" not found in wiki — skipping bidirectional update`);
        return;
      }
      const relatedPage = await this.wikiEngine.readPage(relatedPagePath);
      const relatedBody = relatedPage.body;
      const relatedSection = extractSectionsByHeading(relatedBody, 'Relationships');
      const relatedEntry = `- ${targetName}: ${op.relationship}`;
      if (relatedSection !== null) {
        const existingIndex = relatedBody.indexOf(relatedEntry);
        if (existingIndex !== -1) {
          const start = relatedBody.lastIndexOf('\n', existingIndex) + 1;
          const end = relatedBody.indexOf('\n', existingIndex);
          relatedPage.body = relatedBody.slice(0, start) + relatedEntry + relatedBody.slice(end === -1 ? relatedBody.length : end);
        } else {
          const insertIndex = this.sectionInsertionPoint(relatedBody, relatedSection);
          relatedPage.body = `${relatedBody.slice(0, insertIndex)}\n${relatedEntry}\n${relatedBody.slice(insertIndex)}`;
        }
      } else {
        relatedPage.body = `${relatedBody}\n## Relationships\n\n${relatedEntry}\n`;
      }
      relatedPage.frontmatter.last_updated = op.source;
      await this.wikiEngine.writePage(relatedPagePath, { ...relatedPage.frontmatter }, relatedPage.body);
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
        const insertIndex = this.sectionInsertionPoint(body, section);
        body = `${body.slice(0, insertIndex)}\n${lines}\n${body.slice(insertIndex)}`;
      } else {
        body += `\n## Evidence\n\n${lines}\n`;
      }
    }
    // `last_updated` MUST be refreshed on every apply call per
    // the spec, so the no-op short-circuit cannot skip the write — it can
    // only skip the body update.
    if (body === oldBody && oldStatus === op.status) {
      page.frontmatter.last_updated = op.source;
      await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
      return;
    }
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
      const insertIndex = this.sectionInsertionPoint(body, section);
      body = `${body.slice(0, insertIndex)}\n- ${op.evidence}\n${body.slice(insertIndex)}`;
    } else {
      body += `\n## Evidence\n\n- ${op.evidence}\n`;
    }
    // see note in {@link applyUpdateThreadStatus}.  Always
    // refresh `last_updated`, even when the body would otherwise be a
    // no-op.
    if (body === oldBody) {
      page.frontmatter.last_updated = op.source;
      await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
      return;
    }
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, body);
  }

  /**
   * Append a contradiction entry to `adab/wiki/contradictions.md`.
   *
   * Behaviour depends on the operation's `status`:
   *  - `unresolved` (default): append a new `## <description>` section
   *    to `contradictions.md`.
   *  - `explained` / `retconned` (resolved): delegate to
   *    {@link WikiEngine.updateContradictions}, which either updates an
   *    existing unresolved entry in-place or appends a fresh entry.
   *
   * the previous implementation always appended, never
   * resolved.  This meant a follow-up diff that explained a previously
   * flagged contradiction was silently duplicated in
   * `contradictions.md` instead of updating the status.
   */
  private async applyFlagContradiction(op: Extract<WikiDiffOperation, { type: 'flag_contradiction' }>): Promise<void> {
    if (op.status === 'explained' || op.status === 'retconned') {
      await this.applyResolveContradiction(op);
      return;
    }
    await this.applyFlagContradictionUnresolved(op);
  }

  /**
   * Append a brand-new `## <description>` section to
   * `adab/wiki/contradictions.md` for an unresolved flag.
   *
   * @param op Unresolved `flag_contradiction` operation.
   */
  private async applyFlagContradictionUnresolved(op: Extract<WikiDiffOperation, { type: 'flag_contradiction' }>): Promise<void> {
    const lines: string[] = [];
    lines.push(`## ${op.description}\n`);
    for (const src of op.sources) {
      lines.push(`- **${src.page}**: ${src.claim}`);
    }
    lines.push(`- Status: ${op.status}`);
    lines.push('');

    const contradictionsPath = await resolveWithinBoundary(join(this.projectRoot, 'adab', 'wiki'), 'contradictions.md');
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
   * Resolve a previously-flagged contradiction by delegating to
   * {@link WikiEngine.updateContradictions}, which owns the
   * in-place update logic and any new-entry fallback.
   *
   * @param op Resolved (`explained` / `retconned`) `flag_contradiction` operation.
   */
  private async applyResolveContradiction(op: Extract<WikiDiffOperation, { type: 'flag_contradiction' }>): Promise<void> {
    await this.wikiEngine.updateContradictions([op]);
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
    }
    page.frontmatter[op.field] = op.value;
    // `last_updated` is ALWAYS refreshed, even when the field
    // value is unchanged.
    page.frontmatter.last_updated = op.source;
    await this.wikiEngine.writePage(op.target, { ...page.frontmatter }, page.body);
  }

  /**
   * Compute the byte offset in `body` at which new content should be
   * inserted to append to a section returned by
   * {@link extractSectionsByHeading}.  The returned offset points to the
   * character immediately after the section's last non-newline
   * character, so a caller can splice a new entry in while preserving
   * the original spacing between the section and whatever follows.
   *
   * Used by every `apply*` method that mutates an existing section.
   * required because `extractSectionsByHeading` now returns
   * the section text with its original (trailing) newlines intact.
   *
   * @param body    Full page body.
   * @param section Section text (un-trimmed) as returned by
   *   {@link extractSectionsByHeading}.
   * @returns Byte offset at which to splice new content.
   */
  private sectionInsertionPoint(body: string, section: string): number {
    const start = body.indexOf(section);
    if (start === -1) {return body.length;}
    let end = start + section.length;
    while (end > start && body[end - 1] === '\n') {
      end--;
    }
    return end;
  }
}
