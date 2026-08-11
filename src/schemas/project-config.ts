/**
 * Zod schema for `ProjectConfig` (adab/config.yaml validation).
 *
 * Validates and provides defaults for all project configuration fields.
 * Unknown keys are preserved at every object level (the top level and the
 * nested `project`, `context`, and `archive` objects all use
 * `.passthrough()`) so user custom fields survive `config set` round-trips
 * instead of being silently stripped and re-written.
 */
import { z } from "zod";

export const ProjectConfigSchema = z.object({
  schema: z.string().default("chapter-draft"),
  version: z.number().default(1),
  project: z.object({
    title: z.string().default("Untitled Novel"),
    language: z.enum(["zh-CN", "en-US", "ja-JP"]).default("zh-CN"),
    genre: z.string().default("fantasy"),
    tense: z.enum(["past", "present"]).default("past"),
    pov: z.enum(["first-person", "limited-third", "omniscient-third"]).default("limited-third"),
  }).passthrough().default({ title: "Untitled Novel" }),
  context: z.object({
    maxTokens: z.number().min(1000).max(200000).default(18000),
    alwaysInclude: z.array(z.string()).default([]),
    tokenHeuristic: z.enum(["chars-per-token"]).default("chars-per-token"),
    excludePatterns: z.array(z.string()).default([]),
  }).passthrough().default({}),
  rules: z.record(z.array(z.string())).default({}),
  archive: z.object({
    backupOnOverwrite: z.boolean().default(false),
  }).passthrough().default({ backupOnOverwrite: false }),
}).passthrough();

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
