/**
 * Unit tests validating all built-in schemas against the SchemaDef zod schema.
 *
 * Loads each built-in schema YAML from the filesystem, parses it, and asserts
 * that it passes both zod parsing and structural validation (unique IDs,
 * valid dependencies, template existence, acyclic graph).
 */
import { readdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { SchemaLoader, SchemaValidator } from "../../modules/schema-engine/index.js";

const builtInDir = join(dirname(fileURLToPath(import.meta.url)));

/**
 * Return the names of all built-in schema directories.
 */
async function listBuiltInSchemaNames(): Promise<string[]> {
  const entries = await readdir(builtInDir, { withFileTypes: true });
  return entries.filter((d) => d.isDirectory()).map((d) => d.name);
}

describe("built-in schemas", () => {
  it("all built-in schemas pass zod parsing and structural validation", async () => {
    const names = await listBuiltInSchemaNames();
    expect(names.length).toBeGreaterThan(0);

    for (const name of names) {
      const schemaDir = join(builtInDir, name);
      const loader = new SchemaLoader(schemaDir);
      const schema = await loader.load();

      expect(schema.name).toBe(name);
      expect(typeof schema.version).toBe("number");
      expect(schema.artifacts.length).toBeGreaterThan(0);

      const validator = new SchemaValidator();
      const result = await validator.validate(schema, schemaDir);
      expect(result.passed).toBe(true);
      if (!result.passed) {
        // eslint-disable-next-line no-console
        console.error(`Validation errors for ${name}:`, result.errors);
      }
    }
  });

  it("chapter-draft schema has exactly 6 artifacts", async () => {
    const loader = new SchemaLoader(join(builtInDir, "chapter-draft"));
    const schema = await loader.load();
    expect(schema.artifacts).toHaveLength(6);
    const ids = schema.artifacts.map((a) => a.id);
    expect(ids).toEqual([
      "brief",
      "scene-plan",
      "draft",
      "revision",
      "continuity-report",
      "wiki-diff",
    ]);
  });

  it("chapter-draft apply targets manuscript chapter", async () => {
    const loader = new SchemaLoader(join(builtInDir, "chapter-draft"));
    const schema = await loader.load();
    expect(schema.apply).toBeDefined();
    expect(schema.apply?.requires).toContain("revision");
    expect(schema.apply?.requires).toContain("wiki-diff");
    expect(schema.apply?.target).toBe("manuscript/chapters/{{chapter}}.md");
    expect(schema.apply?.action).toBe("copy");
  });

  it("chapter-revision schema has 5 artifacts", async () => {
    const loader = new SchemaLoader(join(builtInDir, "chapter-revision"));
    const schema = await loader.load();
    expect(schema.artifacts).toHaveLength(5);
    const ids = schema.artifacts.map((a) => a.id);
    expect(ids).toEqual([
      "revision-brief",
      "revision-plan",
      "revision",
      "continuity-report",
      "wiki-diff",
    ]);
  });

  it("chapter-revision apply targets existing chapter", async () => {
    const loader = new SchemaLoader(join(builtInDir, "chapter-revision"));
    const schema = await loader.load();
    expect(schema.apply).toBeDefined();
    expect(schema.apply?.target).toBe("manuscript/chapters/{{chapter}}.md");
  });

  it("wiki-ingest schema has 2 artifacts and no apply", async () => {
    const loader = new SchemaLoader(join(builtInDir, "wiki-ingest"));
    const schema = await loader.load();
    expect(schema.artifacts).toHaveLength(2);
    expect(schema.apply).toBeUndefined();
  });

  it("placeholder schemas have at least 2 artifacts and no apply", async () => {
    for (const name of ["character-development", "worldbuilding", "series-planning"]) {
      const loader = new SchemaLoader(join(builtInDir, name));
      const schema = await loader.load();
      expect(schema.artifacts.length).toBeGreaterThanOrEqual(2);
      expect(schema.apply).toBeUndefined();
    }
  });
});
