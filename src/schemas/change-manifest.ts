/**
 * Zod schema for `.openadab.yaml` change manifest.
 *
 * Tracks change metadata and per-artifact status.
 */
import { z } from "zod";

export const ArtifactStatusSchema = z.enum(["blocked", "ready", "done"]);

// Base object schema (before passthrough/refine wrapping)
const _ChangeManifestBase = z.object({
  changeId: z.string(),
  schema: z.string(),
  version: z.number(),
  created: z.string(),
  status: z.enum(["in_progress", "synced", "archived"]),
  currentArtifact: z.string().optional(),
  artifacts: z.record(ArtifactStatusSchema),
  chapter: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const _changeManifestShape = _ChangeManifestBase.shape;

/**
 * Unwrap Zod's "transparent" outer wrappers (optional, nullable, default,
 * readonly, ...) that do not change the underlying record/object shape.
 * Returns the inner schema, or the input if there is nothing to unwrap.
 */
function unwrapSchema(schema: z.ZodType<unknown>): z.ZodType<unknown> {
  let current: z.ZodType<unknown> = schema;
  for (;;) {
    const def = (current as { _def?: { innerType?: z.ZodType<unknown>; schema?: z.ZodType<unknown> } })._def;
    const inner = def?.innerType ?? def?.schema;
    if (!inner) {
      return current;
    }
    current = inner;
  }
}

/**
 * Recursively walk `node` and emit a `console.warn` for every key that is
 * not in `shape`. Recurses through plain objects, `z.record` values, and
 * arrays so unknown fields hidden inside `metadata` or `artifacts` are
 * surfaced for forward-compatibility audits.
 *
 * For `z.record(z.unknown())` (an open record with no defined per-value
 * schema), every key is treated as unknown and warned, because the schema
 * does not commit to any particular key set and any persisted key is
 * therefore a potential drift signal.
 */
function warnUnknownKeys(node: unknown, shape: Record<string, z.ZodType<unknown>>, prefix: string): void {
  if (!node || typeof node !== "object" || Array.isArray(node)) {
    return;
  }
  for (const key of Object.keys(node as Record<string, unknown>)) {
    const dotted = prefix ? `${prefix}.${key}` : key;
    if (!(key in shape)) {
      // eslint-disable-next-line no-console
      console.warn(`[ChangeManifestSchema] Unknown manifest field: ${dotted}`);
      continue;
    }
    const value = (node as Record<string, unknown>)[key];
    const fieldSchema = unwrapSchema(shape[key]!);
    if (value === null || value === undefined) {
      continue;
    }
    if (fieldSchema instanceof z.ZodObject) {
      warnUnknownKeys(value, fieldSchema.shape as Record<string, z.ZodType<unknown>>, dotted);
    } else if (fieldSchema instanceof z.ZodRecord) {
      const valueSchema = fieldSchema._def.valueType;
      // Only recurse into record values whose value type is a `z.unknown()`
      // (no committed shape → every persisted key is treated as unknown) or
      // a `ZodObject` (committed shape → check inner fields). For other value
      // types (enums, primitives, etc.) the keys are intentional data
      // entries and are not flagged, so a `z.record(z.enum(...))` map of
      // artifact statuses does not produce spurious warnings for each
      // artifact id.
      if (valueSchema instanceof z.ZodUnknown) {
        warnUnknownKeys(value, {}, dotted);
      } else if (valueSchema instanceof z.ZodObject) {
        warnUnknownKeys(value, valueSchema.shape as Record<string, z.ZodType<unknown>>, dotted);
      }
    } else if (fieldSchema instanceof z.ZodArray) {
      const elementSchema = fieldSchema._def.type;
      if (elementSchema instanceof z.ZodObject) {
        for (const entry of value as unknown[]) {
          warnUnknownKeys(entry, elementSchema.shape as Record<string, z.ZodType<unknown>>, dotted);
        }
      }
    }
  }
}

export const ChangeManifestSchema = _ChangeManifestBase.passthrough().refine((data) => {
  warnUnknownKeys(data, _changeManifestShape, "");
  return true;
});

export type ChangeManifest = z.infer<typeof ChangeManifestSchema>;
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
