/**
 * Continuity Linter — generates structured LLM validation prompts for
 * semantic story continuity checks.
 *
 * The CLI does NOT invoke LLMs directly.  This module produces prompts
 * that the AI host executes.
 */
import { join } from 'node:path';

import type { ProjectConfig } from '../../schemas/types.js';
import { safeReadFile } from '../../utils/fs.js';
import { extractFrontmatter, extractSectionsByHeading } from '../../utils/markdown.js';
import type { WikiEngine } from '../wiki-engine/index.js';

/**
 * Severity level for a continuity issue.
 */
export type Severity = 'error' | 'warning' | 'info';

/**
 * A single continuity issue detected by a check.
 */
export interface ContinuityIssue {
  /** Check type that produced the issue. */
  check: string;
  /** Human-readable description. */
  description: string;
  /** Severity level. */
  severity: Severity;
}

/**
 * Structured output expected from the LLM for a validation prompt.
 */
export interface ValidationOutputSchema {
  /** Whether the check passed. */
  passed: boolean;
  /** List of issues found. */
  issues: {
    /** Affected entity or field. */
    character?: string;
    /** Chapter where knowledge was acquired. */
    knownAt?: string;
    /** Chapter where knowledge was acted upon. */
    actedOnAt?: string;
    /** Human-readable issue description. */
    description: string;
  }[];
}

/**
 * A validation prompt with its expected JSON output schema.
 */
export interface ValidationPrompt {
  /** The full prompt text to send to the LLM. */
  prompt: string;
  /** Expected JSON output structure description. */
  expectedOutput: string;
}

/**
 * Per-artifact validation profile defining which checks to run.
 */
export interface ValidationProfile {
  /** Set of check names enabled for this artifact. */
  checks: Set<string>;
}

/**
 * Generates semantic validation prompts for story continuity.
 */
export class ContinuityLinter {
  private readonly projectConfig: ProjectConfig;
  private readonly wikiEngine: WikiEngine;
  private readonly projectRoot: string;

  /**
   * @param projectConfig Loaded project configuration.
   * @param wikiEngine    Wiki engine for reading pages.
   * @param projectRoot   Absolute path to the project root.
   */
  constructor(projectConfig: ProjectConfig, wikiEngine: WikiEngine, projectRoot: string) {
    this.projectConfig = projectConfig;
    this.wikiEngine = wikiEngine;
    this.projectRoot = projectRoot;
  }

  /**
   * Generate the full validation prompt for an artifact.
   *
   * Selects checks based on the per-artifact validation profile, gathers
   * context from wiki and manuscript, and assembles a structured prompt.
   *
   * @param changeDir   Change directory name (e.g. `ch-012`).
   * @param artifactId  Artifact identifier (e.g. `draft`).
   * @returns A {@link ValidationPrompt} with prompt text and expected output schema.
   */
  async generateValidationPrompt(changeDir: string, artifactId: string): Promise<ValidationPrompt> {
    const profile = this.resolveProfile(artifactId);
    const parts: string[] = [];

    parts.push(`# Semantic Validation: ${artifactId}\n`);
    parts.push(`Change: ${changeDir}\n`);

    const rules = this.projectConfig.rules[artifactId] ?? [];
    if (rules.length > 0) {
      parts.push('## Project Rules\n');
      for (const rule of rules) {
        parts.push(`- ${rule}`);
      }
      parts.push('');
    }

    const chapterContent = await this.loadChapterContent(changeDir, artifactId);
    if (chapterContent !== null) {
      parts.push('## Chapter Content\n');
      parts.push(chapterContent);
      parts.push('');
    }

    for (const check of profile.checks) {
      const promptPart = await this.buildCheckPrompt(check, changeDir, artifactId);
      if (promptPart !== null) {
        parts.push(promptPart);
      }
    }

    const expectedOutput = JSON.stringify(
      {
        passed: true,
        issues: [
          {
            character: 'string',
            knownAt: 'chapter-id',
            actedOnAt: 'chapter-id',
            description: 'string',
          },
        ],
      } satisfies ValidationOutputSchema,
      null,
      2,
    );

    return { prompt: parts.join('\n'), expectedOutput };
  }

  /**
   * Build the prompt section for a single check type.
   *
   * @param check      Check name.
   * @param changeDir  Change directory name.
   * @param artifactId Artifact identifier.
   * @returns Prompt section string, or `null` if the check has no applicable context.
   */
  private async buildCheckPrompt(check: string, changeDir: string, _artifactId: string): Promise<string | null> {
    switch (check) {
      case 'characterKnowledge':
        return this.buildCharacterKnowledgePrompt(changeDir);
      case 'timeline':
        return this.buildTimelinePrompt(changeDir);
      case 'povDiscipline':
        return this.buildPovDisciplinePrompt(changeDir);
      case 'foreshadowing':
        return this.buildForeshadowingPrompt(changeDir);
      case 'voiceBlending':
        return this.buildVoiceBlendingPrompt(changeDir);
      case 'worldRules':
        return this.buildWorldRulesPrompt(changeDir);
      case 'wikiDiffSource':
        return this.buildWikiDiffSourcePrompt(changeDir);
      case 'wikiDiffContradiction':
        return this.buildWikiDiffContradictionPrompt(changeDir);
      default:
        return null;
    }
  }

  /**
   * Resolve the validation profile for an artifact.
   *
   * @param artifactId Artifact identifier.
   * @returns A {@link ValidationProfile} with enabled checks.
   */
  private resolveProfile(artifactId: string): ValidationProfile {
    switch (artifactId) {
      case 'draft':
        return { checks: new Set(['povDiscipline', 'voiceBlending', 'worldRules']) };
      case 'revision':
        return {
          checks: new Set([
            'povDiscipline',
            'voiceBlending',
            'worldRules',
            'characterKnowledge',
            'timeline',
            'foreshadowing',
          ]),
        };
      case 'wiki-diff':
        return { checks: new Set(['wikiDiffSource', 'wikiDiffContradiction']) };
      default:
        return { checks: new Set() };
    }
  }

  /**
   * Build the character knowledge consistency check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildCharacterKnowledgePrompt(_changeDir: string): Promise<string | null> {
    const charPages = await this.wikiEngine.listPages('character');
    const sections: string[] = [];
    for (const page of charPages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const name = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : '';
        if (name === '') {continue;}
        const timelineRaw = extractSectionsByHeading(wikiPage.body, 'Knowledge Timeline');
        const knowledgeTimeline = timelineRaw !== null ? timelineRaw.trim() : '';
        if (knowledgeTimeline) {
          sections.push(`Character: ${name}\n\nKnowledge Timeline:\n${knowledgeTimeline}`);
        } else {
          sections.push(`Character "${name}" is newly introduced — no prior knowledge constraints apply.`);
        }
      } catch (err) {
        console.warn('[ContinuityLinter] Skipped unreadable page in character knowledge check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (sections.length === 0) {
      return null;
    }

    return `## Character Knowledge Consistency\n\n${sections.join('\n\n')}\n\nInstruction: Verify the character does not act on knowledge they have not yet acquired.\n\nExpected Output:\n\`\`\`json\n{\n  \"passed\": true,\n  \"issues\": [\n    {\n      \"character\": \"string\",\n      \"knownAt\": \"chapter-id\",\n      \"actedOnAt\": \"chapter-id\",\n      \"description\": \"string\"\n    }\n  ]\n}\n\`\`\`\n`;
  }

  /**
   * Build the timeline contradiction check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildTimelinePrompt(_changeDir: string): Promise<string | null> {
    const timelinePages = await this.wikiEngine.listPages('timeline');
    const sections: string[] = [];
    for (const page of timelinePages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const displayName = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : page;
        sections.push(`### ${displayName}\n${wikiPage.body}`);
      } catch (err) {
        console.warn('[ContinuityLinter] Skipped unreadable page in timeline check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (sections.length === 0) {
      return null;
    }

    return `## Timeline Contradiction Check\n\nAbsolute Timeline:\n${sections.join('\n\n')}\n\nInstruction: Verify events occur in logical temporal order. Flag events that reference future events without justification.\n`;
  }

  /**
   * Build the POV discipline check prompt.
   *
   * Per spec, the check is always generated: when a POV character is declared
   * the prompt embeds the declared name, and when none is declared it embeds
   * a note explaining that and still produces the full head-hopping check.
   * The function therefore always returns a non-null prompt section.
   *
   * If the declared POV value is malformed (non-string), the upper layer is
   * expected to catch the error and treat it as "no POV declared" so the
   * spec-mandated fallback section is still emitted.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildPovDisciplinePrompt(changeDir: string): Promise<string> {
    let pov: string | null;
    try {
      pov = await this.extractPov(changeDir);
    } catch (err) {
      console.warn('[ContinuityLinter] POV extraction failed, falling back to no-POV note:', err instanceof Error ? err.message : String(err));
      pov = null;
    }
    if (pov === null) {
      return `## POV Discipline Check\n\nNo POV character declared in scene-plan or brief.\n\nInstruction: Verify the narrative stays within the declared POV — no head-hopping. Detect paragraphs that reveal non-POV character internal states.\n`;
    }

    return `## POV Discipline Check\n\nDeclared POV Character: ${pov}\n\nInstruction: Verify the narrative stays within the declared POV — no head-hopping. Detect paragraphs that reveal non-POV character internal states.\n`;
  }

  /**
   * Build the foreshadowing integrity check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildForeshadowingPrompt(_changeDir: string): Promise<string | null> {
    const threadPages = await this.wikiEngine.listPages('thread');
    const activePromises: string[] = [];
    for (const page of threadPages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const status = typeof wikiPage.frontmatter.status === 'string' ? wikiPage.frontmatter.status : '';
        if (status === 'open' || status === 'advanced') {
          const displayName = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : page;
          activePromises.push(`${displayName} (${status})`);
        }
      } catch (err) {
        console.warn('[ContinuityLinter] Skipped unreadable page in foreshadowing check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (activePromises.length === 0) {
      return null;
    }

    return `## Foreshadowing Integrity Check\n\nActive Promises:\n${activePromises.map((p) => `- ${p}`).join('\n')}\n\nInstruction: Verify no active promise was accidentally resolved without acknowledgment, and no new promise contradicts existing ones.\n`;
  }

  /**
   * Build the voice blending check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildVoiceBlendingPrompt(_changeDir: string): Promise<string | null> {
    const stylePages = await this.wikiEngine.listPages('style');
    const voices: string[] = [];
    for (const page of stylePages) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const displayName = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : page;
        voices.push(`### ${displayName}\n${wikiPage.body}`);
      } catch (err) {
        console.warn('[ContinuityLinter] Skipped unreadable page in voice blending check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (voices.length === 0) {
      return null;
    }

    return `## Voice Blending Check\n\nCharacter Voice Examples:\n${voices.join('\n\n')}\n\nInstruction: Verify each character's dialogue maintains their established voice.\n`;
  }

  /**
   * Build the world rule compliance check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildWorldRulesPrompt(_changeDir: string): Promise<string | null> {
    const worldPages = await this.wikiEngine.listPages('location');
    const factionPages = await this.wikiEngine.listPages('faction');
    const rules: string[] = [];

    for (const page of [...worldPages, ...factionPages]) {
      try {
        const wikiPage = await this.wikiEngine.readPage(page);
        const displayName = typeof wikiPage.frontmatter.name === 'string' ? wikiPage.frontmatter.name : page;
        rules.push(`### ${displayName}\n${wikiPage.body}`);
      } catch (err) {
        console.warn('[ContinuityLinter] Skipped unreadable page in world rules check:', err instanceof Error ? err.message : String(err));
      }
    }

    if (rules.length === 0) {
      return null;
    }

    return `## World Rule Compliance Check\n\nEstablished World Rules:\n${rules.join('\n\n')}\n\nInstruction: Flag any violation of established world rules that lacks a wiki-diff entry explaining the change.\n`;
  }

  /**
   * Build the wiki-diff source citation validity check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildWikiDiffSourcePrompt(changeDir: string): Promise<string | null> {
    const diffPath = join(this.projectRoot, 'adab', 'changes', changeDir, 'wiki-diff.md');
    const raw = await safeReadFile(diffPath);
    if (raw === null) {
      return `## Wiki-Diff Source Citation Check\n\nNo wiki-diff.md found for this change.\n\nInstruction: Verify every operation includes a valid source citation and references an existing wiki page.\n`;
    }

    return `## Wiki-Diff Source Citation Check\n\nWiki-Diff Content:\n${raw}\n\nInstruction: Verify every operation includes a valid source citation and references an existing wiki page.\n`;
  }

  /**
   * Build the wiki-diff contradiction flagging completeness check prompt.
   *
   * @param changeDir Change directory name.
   * @returns Prompt section.
   */
  private async buildWikiDiffContradictionPrompt(changeDir: string): Promise<string | null> {
    const diffPath = join(this.projectRoot, 'adab', 'changes', changeDir, 'wiki-diff.md');
    const raw = await safeReadFile(diffPath);
    if (raw === null) {
      return `## Wiki-Diff Contradiction Flagging Check\n\nNo wiki-diff.md found for this change.\n\nInstruction: Verify that any operation introducing a contradiction is accompanied by a flag_contradiction entry, and that all flagged contradictions have sufficient source evidence.\n`;
    }

    return `## Wiki-Diff Contradiction Flagging Check\n\nWiki-Diff Content:\n${raw}\n\nInstruction: Verify that any operation introducing a contradiction is accompanied by a flag_contradiction entry, and that all flagged contradictions have sufficient source evidence.\n`;
  }

  /**
   * Extract the POV character name from scene-plan or brief frontmatter.
   *
   * Walks the candidate files in order and returns the first frontmatter
   * `pov` value that is a non-empty string.  If a candidate file declares
   * `pov` as a non-string value (e.g. an array, number, or object), an
   * explicit error is thrown so the upper layer can fall back to the
   * "no POV declared" prompt section.
   *
   * @param changeDir Change directory name.
   * @returns POV character name, or `null` when no candidate declares one.
   */
  private async extractPov(changeDir: string): Promise<string | null> {
    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const candidates = ['scene-plan.md', 'brief.md'];
    for (const file of candidates) {
      const raw = await safeReadFile(join(changePath, file));
      if (raw === null) {continue;}
      const { data } = extractFrontmatter(raw);
      if (data.pov === undefined || data.pov === null) {continue;}
      if (typeof data.pov !== 'string') {
        throw new Error(`POV frontmatter in "${file}" must be a string, got ${typeof data.pov}`);
      }
      return data.pov;
    }
    return null;
  }

  /**
   * Load the manuscript chapter content for the given artifact.
   *
   * For draft/revision artifacts, reads the artifact file. For others,
   * returns `null`.
   *
   * @param changeDir  Change directory name.
   * @param artifactId Artifact identifier.
   * @returns File content, or `null`.
   */
  private async loadChapterContent(changeDir: string, artifactId: string): Promise<string | null> {
    const changePath = join(this.projectRoot, 'adab', 'changes', changeDir);
    const fileMap: Record<string, string> = {
      draft: 'draft.md',
      revision: 'revision.md',
    };
    const fileName = fileMap[artifactId];
    if (!fileName) {
      return null;
    }
    return safeReadFile(join(changePath, fileName));
  }
}
