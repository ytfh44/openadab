/**
 * Unit tests for SchemaDefSchema and ArtifactDefSchema.
 */
import { describe, it, expect } from "vitest";

import { SchemaDefSchema, ArtifactDefSchema } from "./schema-def.js";

describe("ArtifactDefSchema", () => {
  it("accepts a minimal artifact", () => {
    const input = { id: "brief", generates: "brief.md", requires: [] };
    const result = ArtifactDefSchema.parse(input);
    expect(result.id).toBe("brief");
    expect(result.requires).toEqual([]);
  });

  it("accepts a full artifact", () => {
    const input = {
      id: "draft",
      generates: "draft.md",
      requires: ["brief", "scene-plan"],
      template: "templates/draft.md",
      instruction: "Write the draft.",
      instructionFile: "instructions/draft.txt",
      contextBudget: 12000,
      validation: {
        mechanical: ["wordCount > 1000"],
        semantic: ["POV consistent"],
      },
    };
    const result = ArtifactDefSchema.parse(input);
    expect(result.contextBudget).toBe(12000);
    expect(result.validation?.mechanical).toEqual(["wordCount > 1000"]);
  });

  it("rejects missing id", () => {
    const input = { generates: "x.md", requires: [] };
    expect(() => ArtifactDefSchema.parse(input)).toThrow();
  });

  it("rejects missing generates", () => {
    const input = { id: "x", requires: [] };
    expect(() => ArtifactDefSchema.parse(input)).toThrow();
  });

  it("defaults requires to empty array", () => {
    const input = { id: "x", generates: "x.md" };
    const result = ArtifactDefSchema.parse(input);
    expect(result.requires).toEqual([]);
  });
});

describe("SchemaDefSchema", () => {
  it("accepts a valid schema", () => {
    const input = {
      name: "chapter-draft",
      version: 1,
      description: "Standard chapter draft workflow",
      context: { chapter: "001" },
      artifacts: [
        { id: "brief", generates: "brief.md", requires: [] },
        { id: "scene-plan", generates: "scene-plan.md", requires: ["brief"] },
      ],
      apply: {
        requires: ["revision"],
        target: "manuscript/chapters/{{chapter}}.md",
        action: "copy",
      },
    };
    const result = SchemaDefSchema.parse(input);
    expect(result.name).toBe("chapter-draft");
    expect(result.artifacts).toHaveLength(2);
    expect(result.apply?.action).toBe("copy");
  });

  it("defaults apply.action to copy", () => {
    const input = {
      name: "test",
      version: 1,
      artifacts: [{ id: "a", generates: "a.md", requires: [] }],
      apply: { requires: ["a"], target: "out.md" },
    };
    const result = SchemaDefSchema.parse(input);
    expect(result.apply?.action).toBe("copy");
  });

  it("rejects missing name", () => {
    const input = {
      version: 1,
      artifacts: [{ id: "a", generates: "a.md", requires: [] }],
    };
    expect(() => SchemaDefSchema.parse(input)).toThrow();
  });

  it("rejects missing version", () => {
    const input = {
      name: "test",
      artifacts: [{ id: "a", generates: "a.md", requires: [] }],
    };
    expect(() => SchemaDefSchema.parse(input)).toThrow();
  });

  it("rejects empty artifacts array", () => {
    const input = {
      name: "test",
      version: 1,
      artifacts: [],
    };
    const result = SchemaDefSchema.parse(input);
    expect(result.artifacts).toEqual([]);
  });

  it("rejects invalid apply action", () => {
    const input = {
      name: "test",
      version: 1,
      artifacts: [{ id: "a", generates: "a.md", requires: [] }],
      apply: { requires: ["a"], target: "out.md", action: "delete" },
    };
    expect(() => SchemaDefSchema.parse(input)).toThrow();
  });
});