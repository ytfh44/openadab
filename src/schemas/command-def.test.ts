/**
 * Unit tests for CommandDefSchema.
 */
import { describe, it, expect } from "vitest";

import { CommandDefSchema, CommandStepSchema, CommandParameterSchema } from "./command-def.js";

describe("CommandParameterSchema", () => {
  it("accepts a valid parameter", () => {
    const input = {
      name: "change",
      type: "string",
      required: true,
      description: "Change identifier",
    };
    const result = CommandParameterSchema.parse(input);
    expect(result.name).toBe("change");
    expect(result.required).toBe(true);
  });

  it("defaults required to false", () => {
    const input = { name: "artifact", type: "string" };
    const result = CommandParameterSchema.parse(input);
    expect(result.required).toBe(false);
  });

  it("rejects missing name", () => {
    const input = { type: "string" };
    expect(() => CommandParameterSchema.parse(input)).toThrow();
  });
});

describe("CommandStepSchema", () => {
  it("accepts a cli step", () => {
    const input = {
      action: "cli",
      command: "openadab status --change {{change}} --json",
      capture: "status_output",
    };
    const result = CommandStepSchema.parse(input);
    expect(result.action).toBe("cli");
    expect(result.capture).toBe("status_output");
  });

  it("accepts a read step", () => {
    const input = {
      action: "read",
      paths: "{{context_pack.mustRead}}",
    };
    const result = CommandStepSchema.parse(input);
    expect(result.action).toBe("read");
  });

  it("rejects invalid action", () => {
    const input = { action: "delete" };
    expect(() => CommandStepSchema.parse(input)).toThrow();
  });

  it("accepts step with no optional fields", () => {
    const input = { action: "llm" };
    const result = CommandStepSchema.parse(input);
    expect(result.command).toBeUndefined();
  });
});

describe("CommandDefSchema", () => {
  it("accepts a valid command definition", () => {
    const input = {
      name: "draft",
      description: "Write chapter draft using context pack and scene plan",
      category: "writing",
      parameters: [
        { name: "change", type: "string", required: true },
        { name: "artifact", type: "string", default: "draft" },
      ],
      steps: [
        { action: "cli", command: "openadab context pack --change {{change}} --artifact {{artifact}} --json", capture: "context_pack" },
        { action: "read", paths: "{{context_pack.mustRead}}" },
        { action: "write", path: "{{instructions.outputPath}}", content: "{{llm_output}}" },
      ],
    };
    const result = CommandDefSchema.parse(input);
    expect(result.name).toBe("draft");
    expect(result.steps).toHaveLength(3);
  });

  it("defaults parameters to empty array", () => {
    const input = {
      name: "explore",
      description: "Explore story state",
      category: "utility",
      steps: [{ action: "cli", command: "openadab status --json" }],
    };
    const result = CommandDefSchema.parse(input);
    expect(result.parameters).toEqual([]);
  });

  it("rejects missing name", () => {
    const input = {
      description: "Explore",
      category: "utility",
      steps: [],
    };
    expect(() => CommandDefSchema.parse(input)).toThrow();
  });

  it("rejects missing steps", () => {
    const input = {
      name: "explore",
      description: "Explore",
      category: "utility",
    };
    expect(() => CommandDefSchema.parse(input)).toThrow();
  });

  it("rejects empty steps array", () => {
    const input = {
      name: "explore",
      description: "Explore",
      category: "utility",
      steps: [],
    };
    const result = CommandDefSchema.parse(input);
    expect(result.steps).toEqual([]);
  });
});