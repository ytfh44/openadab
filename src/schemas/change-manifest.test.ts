/**
 * Unit tests for ChangeManifestSchema.
 */
import { describe, it, expect } from "vitest";

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