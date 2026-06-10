/**
 * Unit tests for ContextPackSchema.
 */
import { describe, it, expect } from "vitest";

import { ContextPackSchema } from "./context-pack.js";

describe("ContextPackSchema", () => {
  it("accepts a valid context pack", () => {
    const input = {
      mustRead: ["adab/wiki/characters/mara.md", "adab/changes/draft-ch-012/brief.md"],
      optionalRead: ["adab/manuscript/chapters/ch-011.md"],
      excluded: ["adab/wiki/locations/east-gate.md"],
      reasons: {
        "adab/wiki/characters/mara.md": "POV character",
        "adab/changes/draft-ch-012/brief.md": "artifact dependency",
        "adab/manuscript/chapters/ch-011.md": "previous chapter",
        "adab/wiki/locations/east-gate.md": "budget exceeded, priority 40 vs threshold 60",
      },
    };
    const result = ContextPackSchema.parse(input);
    expect(result.mustRead).toHaveLength(2);
    expect(result.optionalRead).toHaveLength(1);
    expect(result.excluded).toHaveLength(1);
    expect(Object.keys(result.reasons)).toHaveLength(4);
  });

  it("accepts empty arrays", () => {
    const input = {
      mustRead: [],
      optionalRead: [],
      excluded: [],
      reasons: {},
    };
    const result = ContextPackSchema.parse(input);
    expect(result.mustRead).toEqual([]);
    expect(result.reasons).toEqual({});
  });

  it("rejects non-array mustRead", () => {
    const input = {
      mustRead: "adab/wiki/index.md",
      optionalRead: [],
      excluded: [],
      reasons: {},
    };
    expect(() => ContextPackSchema.parse(input)).toThrow();
  });

  it("rejects non-string in arrays", () => {
    const input = {
      mustRead: [1, 2, 3],
      optionalRead: [],
      excluded: [],
      reasons: {},
    };
    expect(() => ContextPackSchema.parse(input)).toThrow();
  });

  it("rejects non-object reasons", () => {
    const input = {
      mustRead: [],
      optionalRead: [],
      excluded: [],
      reasons: ["reason1"],
    };
    expect(() => ContextPackSchema.parse(input)).toThrow();
  });

  it("rejects missing field", () => {
    const input = {
      mustRead: [],
      optionalRead: [],
      excluded: [],
    };
    expect(() => ContextPackSchema.parse(input)).toThrow();
  });
});