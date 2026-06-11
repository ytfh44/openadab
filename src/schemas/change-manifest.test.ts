/**
 * Unit tests for ChangeManifestSchema.
 */
import { afterEach, describe, it, expect, vi } from "vitest";

import { ChangeManifestSchema, ArtifactStatusSchema } from "./change-manifest.js";

describe("ArtifactStatusSchema", () => {
  it("accepts all valid statuses", () => {
    expect(ArtifactStatusSchema.parse("blocked")).toBe("blocked");
    expect(ArtifactStatusSchema.parse("ready")).toBe("ready");
    expect(ArtifactStatusSchema.parse("done")).toBe("done");
  });

  it("rejects invalid status", () => {
    expect(() => ArtifactStatusSchema.parse("in_progress")).toThrow();
    expect(() => ArtifactStatusSchema.parse("archived")).toThrow();
  });
});

describe("ChangeManifestSchema", () => {
  it("accepts a valid manifest", () => {
    const input = {
      changeId: "draft-ch-012",
      schema: "chapter-draft",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "in_progress",
      currentArtifact: "brief",
      artifacts: {
        brief: "done",
        "scene-plan": "ready",
        draft: "blocked",
      },
      chapter: "012",
      metadata: { author: "test" },
    };
    const result = ChangeManifestSchema.parse(input);
    expect(result.changeId).toBe("draft-ch-012");
    expect(result.artifacts["scene-plan"]).toBe("ready");
  });

  it("accepts minimal manifest without optional fields", () => {
    const input = {
      changeId: "draft-ch-001",
      schema: "chapter-draft",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "synced",
      artifacts: {},
    };
    const result = ChangeManifestSchema.parse(input);
    expect(result.currentArtifact).toBeUndefined();
    expect(result.chapter).toBeUndefined();
    expect(result.metadata).toBeUndefined();
  });

  it("rejects missing changeId", () => {
    const input = {
      schema: "chapter-draft",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "in_progress",
      artifacts: {},
    };
    expect(() => ChangeManifestSchema.parse(input)).toThrow();
  });

  it("rejects invalid status", () => {
    const input = {
      changeId: "x",
      schema: "s",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "unknown",
      artifacts: {},
    };
    expect(() => ChangeManifestSchema.parse(input)).toThrow();
  });

  it("rejects wrong type for version", () => {
    const input = {
      changeId: "x",
      schema: "s",
      version: "1",
      created: "2026-06-06T10:00:00Z",
      status: "in_progress",
      artifacts: {},
    };
    expect(() => ChangeManifestSchema.parse(input)).toThrow();
  });

  it("rejects artifact status not in enum", () => {
    const input = {
      changeId: "x",
      schema: "s",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "in_progress",
      artifacts: { brief: "pending" },
    };
    expect(() => ChangeManifestSchema.parse(input)).toThrow();
  });
});

describe("ChangeManifestSchema — unknown field warnings", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /**
   * Build a minimal valid manifest payload and attach an unknown top-level
   * key so the refine callback fires.
   */
  function makeInputWithUnknownField(): Record<string, unknown> {
    return {
      changeId: "draft-ch-099",
      schema: "chapter-draft",
      version: 1,
      created: "2026-06-06T10:00:00Z",
      status: "in_progress",
      artifacts: {},
      surpriseUnknownKey: "should-warn",
    };
  }

  it("does not call process.emitWarning when an unknown field is present", () => {
    const emitWarningSpy = vi.spyOn(process, "emitWarning");
    const result = ChangeManifestSchema.safeParse(makeInputWithUnknownField());
    expect(result.success).toBe(true);
    expect(emitWarningSpy).not.toHaveBeenCalled();
  });

  it("calls console.warn when an unknown field is present", () => {
    const consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const result = ChangeManifestSchema.safeParse(makeInputWithUnknownField());
    expect(result.success).toBe(true);
    expect(consoleWarnSpy).toHaveBeenCalled();
    const warnedMessage = consoleWarnSpy.mock.calls.map((call) => String(call[0])).join("\n");
    expect(warnedMessage).toContain("Unknown manifest field");
    expect(warnedMessage).toContain("surpriseUnknownKey");
  });
});