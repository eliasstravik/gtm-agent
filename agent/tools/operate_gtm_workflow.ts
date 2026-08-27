import { defineTool } from "eve/tools";
import type { Approval } from "eve/tools/approval";
import { z } from "zod";

import { getConfiguration } from "../lib/config.ts";
import { WorkflowControl } from "../lib/workflow-control.ts";

const head = z
  .string()
  .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
  .describe("Exact committed workspace HEAD that owns this workflow input and definition.");
const workflowPath = z
  .string()
  .regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(240)
  .describe("Workflow path beneath workflows/workflows without the .ts suffix.");
const inputPath = z
  .string()
  .regex(/^workflows\/data\/[A-Za-z0-9][A-Za-z0-9._/-]*\.json$/)
  .max(240)
  .describe("Ignored repository-relative JSON input path beneath workflows/data/." );
const checkpoint = z
  .number()
  .int()
  .positive()
  .nullable()
  .describe("Accepted checkpoint row, or null for the full scope.");
const runKey = z
  .string()
  .regex(/^[0-9a-f]{32}$/)
  .describe("Stable public run key returned by start or status.");

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("preview"),
      expectedHead: head,
      workflowPath,
      inputPath,
      checkpoint,
    })
    .strict(),
  z
    .object({
      action: z.literal("start"),
      expectedHead: head,
      workflowPath,
      inputPath,
      checkpoint,
      summary: z.string().min(1).max(500),
    })
    .strict(),
  z.object({ action: z.literal("status"), runKey }).strict(),
  z
    .object({
      action: z.literal("approve"),
      runKey,
      approved: z.boolean(),
      comment: z.string().max(500).nullable(),
      summary: z.string().min(1).max(500),
    })
    .strict(),
]);

type Input = z.infer<typeof inputSchema>;

const operationApproval: Approval<Input> = ({ toolInput }) =>
  toolInput?.action === "start" || toolInput?.action === "approve"
    ? "user-approval"
    : "not-applicable";

export default defineTool({
  description:
    "Preview, start, inspect, or approve a workflow on the fixed protected Vercel production project. Preview and status are read-only. Start and approval require native approval. Production, OIDC, and hook tokens stay inside the trusted host runtime.",
  inputSchema,
  approval: operationApproval,
  async execute(input, ctx) {
    const configuration = getConfiguration();
    if (configuration.workspace === null || configuration.workflowControl === null) {
      return {
        status: "setup_required" as const,
        message:
          "Trusted Vercel workflow control is not fully configured for this connected workspace.",
      };
    }
    const control = new WorkflowControl(
      configuration.workflowControl,
      configuration.workspace,
    );
    if (input.action === "status") return control.getRun(input.runKey);
    if (input.action === "approve") {
      return control.approveRun({
        approved: input.approved,
        comment: input.comment,
        runKey: input.runKey,
      });
    }

    const sandbox = await ctx.getSandbox();
    const request = {
      checkpoint: input.checkpoint,
      expectedHead: input.expectedHead,
      inputPath: input.inputPath,
      sandbox,
      workflowPath: input.workflowPath,
    };
    return input.action === "preview"
      ? control.previewRun(request)
      : control.startRun(request);
  },
});
