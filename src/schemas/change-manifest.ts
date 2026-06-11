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

export const ChangeManifestSchema = _ChangeManifestBase.passthrough().refine((data) => {
  for (const key of Object.keys(data as Record<string, unknown>)) {
    if (!(key in _changeManifestShape)) {
      // eslint-disable-next-line no-console
      console.warn(`[ChangeManifestSchema] Unknown manifest field: ${key}`);
    }
  }
  return true;
});

export type ChangeManifest = z.infer<typeof ChangeManifestSchema>;
export type ArtifactStatus = z.infer<typeof ArtifactStatusSchema>;
