import { z } from "zod";

export const WikiDiffAddCurrentStateSchema = z.object({
  type: z.literal("add_current_state"),
  target: z.string(),
  source: z.string(),
  content: z.string(),
});

export const WikiDiffAddKnowledgeTimelineSchema = z.object({
  type: z.literal("add_knowledge_timeline"),
  target: z.string(),
  source: z.string(),
  chapter: z.string(),
  knowledge: z.string(),
});

export const WikiDiffUpdateRelationshipSchema = z.object({
  type: z.literal("update_relationship"),
  target: z.string(),
  source: z.string(),
  relatedEntity: z.string(),
  relationship: z.string(),
});

export const WikiDiffUpdateThreadStatusSchema = z.object({
  type: z.literal("update_thread_status"),
  target: z.string(),
  source: z.string(),
  status: z.enum(["open", "advanced", "resolved"]),
  evidence: z.array(z.string()).optional(),
});

export const WikiDiffAddEvidenceSchema = z.object({
  type: z.literal("add_evidence"),
  target: z.string(),
  source: z.string(),
  evidence: z.string(),
});

export const WikiDiffFlagContradictionSchema = z.object({
  type: z.literal("flag_contradiction"),
  target: z.string(),
  source: z.string(),
  description: z.string(),
  sources: z.array(z.object({ page: z.string(), claim: z.string() })),
  status: z.enum(["unresolved", "explained", "retconned"]),
});

export const WikiDiffUpdateFieldSchema = z.object({
  type: z.literal("update_field"),
  target: z.string(),
  source: z.string(),
  field: z.string(),
  value: z.unknown(),
});

export const WikiDiffOperationSchema = z.discriminatedUnion("type", [
  WikiDiffAddCurrentStateSchema,
  WikiDiffAddKnowledgeTimelineSchema,
  WikiDiffUpdateRelationshipSchema,
  WikiDiffUpdateThreadStatusSchema,
  WikiDiffAddEvidenceSchema,
  WikiDiffFlagContradictionSchema,
  WikiDiffUpdateFieldSchema,
]);

export const WikiDiffDocumentSchema = z.object({
  changeId: z.string(),
  operations: z.array(WikiDiffOperationSchema),
});

export type WikiDiffOperation = z.infer<typeof WikiDiffOperationSchema>;
export type WikiDiffDocument = z.infer<typeof WikiDiffDocumentSchema>;
