/**
 * Zod schema for `ContextPack` output.
 *
 * Represents the result of the context packing algorithm, including
 * must-read, optional-read, and excluded files with selection reasons.
 */
import { z } from "zod";

export const ContextPackSchema = z.object({
  mustRead: z.array(z.string()),
  optionalRead: z.array(z.string()),
  excluded: z.array(z.string()),
  reasons: z.record(z.string()),
});

export type ContextPack = z.infer<typeof ContextPackSchema>;
