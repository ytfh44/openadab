import { z } from "zod";

export const ArtifactDefSchema = z.object({
  id: z.string(),
  generates: z.string(),
  requires: z.array(z.string()).default([]),
  template: z.string().optional(),
  instruction: z.string().optional(),
  instructionFile: z.string().optional(),
  contextBudget: z.number().optional(),
  required: z.boolean().default(true),
  validation: z.object({
    mechanical: z.array(z.string()).optional(),
    semantic: z.array(z.string()).optional(),
  }).optional(),
});

export const SchemaDefSchema = z.object({
  name: z.string(),
  version: z.number(),
  description: z.string().optional(),
  context: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
  artifacts: z.array(ArtifactDefSchema),
  apply: z.object({
    requires: z.array(z.string()),
    target: z.string(),
    action: z.enum(["copy", "move"]).default("copy"),
  }).optional(),
});

export type SchemaDef = z.infer<typeof SchemaDefSchema>;
export type ArtifactDef = z.infer<typeof ArtifactDefSchema>;
