/**
 * Tests for Timeline workspace command construction and error handling.
 *
 * Covers:
 *  - buildTimelineIndexRefreshArgs with/without optional changeId
 *  - buildTimelineSyncArgs with valid changeId
 *  - buildTimelineSyncArgs throws on empty/missing changeId
 *  - Verifies sync is never constructed without required --change argument
 */

import { describe, expect, it } from "vitest";
import {
  buildTimelineIndexRefreshArgs,
  buildTimelineSyncArgs,
} from "../renderer/src/routes/TimelineWorkspace.js";

describe("buildTimelineIndexRefreshArgs", () => {
  it("returns wiki index args without --change when no changeId given", () => {
    expect(buildTimelineIndexRefreshArgs()).toEqual([
      "wiki",
      "index",
      "--json",
    ]);
  });

  it("returns wiki index args with --change when changeId is provided", () => {
    expect(buildTimelineIndexRefreshArgs("ch-001")).toEqual([
      "wiki",
      "index",
      "--json",
      "--change",
      "ch-001",
    ]);
  });

  it("trims whitespace from changeId", () => {
    expect(buildTimelineIndexRefreshArgs("  ch-002  ")).toEqual([
      "wiki",
      "index",
      "--json",
      "--change",
      "ch-002",
    ]);
  });

  it("does not build sync or include --full", () => {
    expect(buildTimelineIndexRefreshArgs()[0]).not.toBe("sync");
    expect(buildTimelineIndexRefreshArgs()).not.toContain("--full");
    expect(buildTimelineIndexRefreshArgs("ch-003")[0]).not.toBe("sync");
  });
});

describe("buildTimelineSyncArgs", () => {
  it("returns sync command with required --change argument", () => {
    expect(buildTimelineSyncArgs("ch-001")).toEqual([
      "sync",
      "--change",
      "ch-001",
      "--json",
    ]);
  });

  it("trims whitespace from changeId", () => {
    expect(buildTimelineSyncArgs("  ch-005  ")).toEqual([
      "sync",
      "--change",
      "ch-005",
      "--json",
    ]);
  });

  it("throws when changeId is empty string", () => {
    expect(() => buildTimelineSyncArgs("")).toThrow("changeId");
  });

  it("throws when changeId is whitespace-only", () => {
    expect(() => buildTimelineSyncArgs("   ")).toThrow("changeId");
  });

  it("does not include --full flag", () => {
    expect(buildTimelineSyncArgs("ch-007")).not.toContain("--full");
  });
});
