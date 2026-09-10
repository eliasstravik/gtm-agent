import { z } from "zod";

export const workflowExecutionSchema = z.object({
  concurrency: z.number().int().min(1).max(16),
  checkpoint: z.number().int().positive().nullable(),
  batch: z.object({
    childWorkflow: z.string().regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/),
    table: z.string().min(1),
    batchSize: z.number().int().min(1).max(300),
    count: z.number().int().min(0).max(100),
    timeoutMs: z.number().int().positive(),
  }).strict().nullable(),
}).strict();

export type WorkflowExecution = z.infer<typeof workflowExecutionSchema>;

export function previewExecution(
  dryRun: Record<string, unknown>, rows: number, checkpoint: number | null,
): WorkflowExecution | null {
  // Older workspace generations have no execution metadata.
  if (dryRun.concurrency === undefined && dryRun.batch === undefined) return null;
  if (dryRun.batch != null && checkpoint !== null) {
    throw new Error("Batch parents require a small-input preview instead of a row checkpoint. No run was started.");
  }
  const parsed = workflowExecutionSchema.parse({
    concurrency: dryRun.concurrency,
    checkpoint: null,
    batch: dryRun.batch ?? null,
  });
  if (parsed.batch && parsed.batch.count !== Math.ceil(rows / parsed.batch.batchSize)) {
    throw new Error("The workflow dry run reported an inconsistent batch count. No run was started.");
  }
  return { ...parsed, checkpoint: checkpoint === null || rows === 0 ? null
    : Math.min(rows, Math.ceil(checkpoint / parsed.concurrency) * parsed.concurrency) };
}
