/**
 * Unit tests for ProjectConfigSchema.
 */
import { describe, it, expect } from "vitest";

import { ProjectConfigSchema } from "./project-config.js";

describe("ProjectConfigSchema", () => {
  it("accepts a fully valid config", () => {
    const input = {
      schema: "chapter-draft",
      version: 1,
      project: {
        title: "The Black Library",
        language: "en-US",
        genre: "fantasy",
        tense: "past",
        pov: "limited-third",
      },
      context: {
        maxTokens: 18000,
        alwaysInclude: ["adab/wiki/index.md"],
        tokenHeuristic: "chars-per-token",
        excludePatterns: ["**/*.tmp"],
      },
      rules: {
        draft: ["Maintain POV discipline."],
      },
      archive: {
        backupOnOverwrite: true,
      },
    };
    const result = ProjectConfigSchema.parse(input);
    expect(result.project.title).toBe("The Black Library");
    expect(result.context.maxTokens).toBe(18000);
    expect(result.archive.backupOnOverwrite).toBe(true);
  });

  it("applies defaults for missing optional fields", () => {
    const input = {
      schema: "chapter-draft",
      project: {
        title: "Test Novel",
      },
    };
    const result = ProjectConfigSchema.parse(input);
    expect(result.version).toBe(1);
    expect(result.project.language).toBe("zh-CN");
    expect(result.project.genre).toBe("fantasy");
    expect(result.project.tense).toBe("past");
    expect(result.project.pov).toBe("limited-third");
    expect(result.context.maxTokens).toBe(18000);
    expect(result.context.alwaysInclude).toEqual([]);
    expect(result.context.excludePatterns).toEqual([]);
    expect(result.rules).toEqual({});
    expect(result.archive.backupOnOverwrite).toBe(false);
  });

  it("applies default for project.title when missing", () => {
    const input = {
      schema: "chapter-draft",
      project: {},
    };
    const result = ProjectConfigSchema.parse(input);
    expect(result.project.title).toBe("Untitled Novel");
  });

  it("rejects invalid language enum", () => {
    const input = {
      schema: "chapter-draft",
      project: {
        title: "Test",
        language: "fr-FR",
      },
    };
    expect(() => ProjectConfigSchema.parse(input)).toThrow();
  });

  it("rejects invalid pov enum", () => {
    const input = {
      schema: "chapter-draft",
      project: {
        title: "Test",
        pov: "omniscient-god",
      },
    };
    expect(() => ProjectConfigSchema.parse(input)).toThrow();
  });

  it("rejects maxTokens below minimum", () => {
    const input = {
      schema: "chapter-draft",
      project: { title: "Test" },
      context: { maxTokens: 500 },
    };
    expect(() => ProjectConfigSchema.parse(input)).toThrow();
  });

  it("rejects maxTokens above maximum", () => {
    const input = {
      schema: "chapter-draft",
      project: { title: "Test" },
      context: { maxTokens: 300000 },
    };
    expect(() => ProjectConfigSchema.parse(input)).toThrow();
  });

  it("accepts empty objects with defaults", () => {
    const input = {};
    const result = ProjectConfigSchema.parse(input);
    expect(result.schema).toBe("chapter-draft");
    expect(result.project.title).toBe("Untitled Novel");
  });

  it("rejects non-boolean archive.backupOnOverwrite", () => {
    const input = {
      schema: "chapter-draft",
      project: { title: "Test" },
      archive: { backupOnOverwrite: "yes" },
    };
    expect(() => ProjectConfigSchema.parse(input)).toThrow();
  });
});