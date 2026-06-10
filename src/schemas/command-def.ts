/**
 * Zod schema for core command definitions (used by host-adapters).
 *
 * Defines the structure of CLI command definitions stored as YAML
 * in `src/commands/` and consumed by adapter generators.
 */
import { z } from "zod";

export const CommandStepSchema = z.object({
  action: z.enum(["cli", "read", "read_optional", "write", "llm"]),
  command: z.string().optional(),
  paths: z.string().optional(),
  path: z.string().optional(),
  content: z.string().optional(),
  capture: z.string().optional(),
});

export const CommandParameterSchema = z.object({
  name: z.string(),
  type: z.string(),
  required: z.boolean().default(false),
  default: z.string().optional(),
  description: z.string().optional(),
});

export const CommandDefSchema = z.object({
  name: z.string(),
  description: z.string(),
  category: z.string(),
  parameters: z.array(CommandParameterSchema).default([]),
  steps: z.array(CommandStepSchema),
});

export type CommandDef = z.infer<typeof CommandDefSchema>;
export type CommandStep = z.infer<typeof CommandStepSchema>;
export type CommandParameter = z.infer<typeof CommandParameterSchema>;
