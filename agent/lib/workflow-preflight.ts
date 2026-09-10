import { z } from "zod";

export const paidStagesSchema = z.array(z.object({
  label: z.string().min(1).max(300),
  provider: z.string().min(1).max(150),
  model: z.string().min(1).max(150).optional(),
  unitCostUsd: z.number().nonnegative().optional(),
}).strict()).max(100);

export const preflightSchema = z.object({
  ok: z.boolean(),
  head: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
  missing: z.array(z.string().max(500)).max(200),
  auth: z.array(z.object({
    provider: z.string().max(200),
    status: z.enum(["verified", "unavailable", "failed"]),
  })).max(100),
  modelDefaults: z.object({ backend: z.literal("api"), model: z.string().regex(/^[A-Za-z0-9._/-]+$/).max(150) }),
});

export type WorkflowPreflight = z.infer<typeof preflightSchema>;
export type PaidStages = z.infer<typeof paidStagesSchema>;

export function previewPaidStages(value: unknown): PaidStages {
  const stages = paidStagesSchema.parse(value);
  if (stages.some(stage => (stage.provider === "model" && !stage.model) ||
      (stage.model && (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(stage.model) || /dynamic|unknown|unresolved/i.test(stage.model))))) {
    throw new Error("Choose a fixed model for every paid stage before requesting approval.");
  }
  return stages;
}
