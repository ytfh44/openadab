/**
 * Unit tests for WikiDiffOperationSchema and WikiDiffDocumentSchema.
 */
import { describe, it, expect } from "vitest";

import { WikiDiffOperationSchema, WikiDiffDocumentSchema } from "./wiki-diff.js";

describe("WikiDiffOperationSchema", () => {
  it("parses add_current_state", () => {
    const input = {
      type: "add_current_state",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      content: "Mara now knows the east gate was opened from inside.",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("add_current_state");
    expect(result.target).toBe("characters/mara");
  });

  it("parses add_knowledge_timeline", () => {
    const input = {
      type: "add_knowledge_timeline",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      chapter: "ch-012",
      knowledge: "Knows about the east gate.",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("add_knowledge_timeline");
    expect((result as any).chapter).toBe("ch-012");
  });

  it("parses update_relationship", () => {
    const input = {
      type: "update_relationship",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      relatedEntity: "characters/lin",
      relationship: "allies",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("update_relationship");
    expect((result as any).relatedEntity).toBe("characters/lin");
  });

  it("parses update_thread_status", () => {
    const input = {
      type: "update_thread_status",
      target: "threads/east-gate-betrayal",
      source: "manuscript/chapters/ch-012.md",
      status: "advanced",
      evidence: ["east gate opened from inside"],
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("update_thread_status");
    expect((result as any).status).toBe("advanced");
    expect((result as any).evidence).toEqual(["east gate opened from inside"]);
  });

  it("parses add_evidence", () => {
    const input = {
      type: "add_evidence",
      target: "threads/east-gate-betrayal",
      source: "manuscript/chapters/ch-012.md",
      evidence: "The guard saw nothing.",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("add_evidence");
  });

  it("parses flag_contradiction", () => {
    const input = {
      type: "flag_contradiction",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      description: "Mara cannot know this yet.",
      sources: [{ page: "characters/mara", claim: "Does not know about the gate." }],
      status: "unresolved",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("flag_contradiction");
    expect((result as any).status).toBe("unresolved");
  });

  it("parses update_field", () => {
    const input = {
      type: "update_field",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      field: "status",
      value: "active",
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect(result.type).toBe("update_field");
    expect((result as any).value).toBe("active");
  });

  it("rejects unknown operation type", () => {
    const input = {
      type: "delete_page",
      target: "characters/mara",
      source: "x",
    };
    expect(() => WikiDiffOperationSchema.parse(input)).toThrow();
  });

  it("rejects missing required field for add_current_state", () => {
    const input = {
      type: "add_current_state",
      target: "characters/mara",
      source: "x",
    };
    expect(() => WikiDiffOperationSchema.parse(input)).toThrow();
  });

  it("rejects invalid thread status", () => {
    const input = {
      type: "update_thread_status",
      target: "threads/t",
      source: "x",
      status: "closed",
    };
    expect(() => WikiDiffOperationSchema.parse(input)).toThrow();
  });

  it("rejects invalid contradiction status", () => {
    const input = {
      type: "flag_contradiction",
      target: "c",
      source: "x",
      description: "d",
      sources: [],
      status: "ignored",
    };
    expect(() => WikiDiffOperationSchema.parse(input)).toThrow();
  });

  // `update_field.value` is declared as `z.unknown()` so that
  // callers may store arbitrary JSON-shaped values.  The schema MUST
  // accept every primitive and the two container shapes that round-trip
  // through gray-matter (arrays and objects), as well as the literal
  // `null`, which is a legitimate "clear this field" signal.
  it("accepts update_field with array value", () => {
    const input = {
      type: "update_field",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      field: "tags",
      value: ["spy", "ally"],
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect((result as any).value).toEqual(["spy", "ally"]);
  });

  it("accepts update_field with object value", () => {
    const input = {
      type: "update_field",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      field: "metadata",
      value: { rank: 3, oath: "until the end" },
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect((result as any).value).toEqual({ rank: 3, oath: "until the end" });
  });

  it("accepts update_field with null value", () => {
    const input = {
      type: "update_field",
      target: "characters/mara",
      source: "manuscript/chapters/ch-012.md",
      field: "status",
      value: null,
    };
    const result = WikiDiffOperationSchema.parse(input);
    expect((result as any).value).toBeNull();
  });

  it("accepts update_field with numeric boolean and string values", () => {
    expect((WikiDiffOperationSchema.parse({
      type: "update_field",
      target: "x",
      source: "s",
      field: "f",
      value: 42,
    }) as any).value).toBe(42);
    expect((WikiDiffOperationSchema.parse({
      type: "update_field",
      target: "x",
      source: "s",
      field: "f",
      value: true,
    }) as any).value).toBe(true);
    expect((WikiDiffOperationSchema.parse({
      type: "update_field",
      target: "x",
      source: "s",
      field: "f",
      value: "alive",
    }) as any).value).toBe("alive");
  });
});

describe("WikiDiffDocumentSchema", () => {
  it("accepts a document with mixed operations", () => {
    const input = {
      changeId: "draft-ch-012",
      operations: [
        {
          type: "add_current_state",
          target: "characters/mara",
          source: "manuscript/chapters/ch-012.md",
          content: "Mara knows.",
        },
        {
          type: "update_field",
          target: "characters/mara",
          source: "manuscript/chapters/ch-012.md",
          field: "status",
          value: "active",
        },
      ],
    };
    const result = WikiDiffDocumentSchema.parse(input);
    expect(result.operations).toHaveLength(2);
  });

  it("accepts empty operations", () => {
    const input = {
      changeId: "draft-ch-012",
      operations: [],
    };
    const result = WikiDiffDocumentSchema.parse(input);
    expect(result.operations).toEqual([]);
  });

  it("rejects missing changeId", () => {
    const input = {
      operations: [],
    };
    expect(() => WikiDiffDocumentSchema.parse(input)).toThrow();
  });
});
