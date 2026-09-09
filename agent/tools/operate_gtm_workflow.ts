import { defineTool } from "eve/tools";
import type { Approval } from "eve/tools/approval";
import { z } from "zod";

import {
  APPROVAL_SUMMARY_MAX_LENGTH,
  type ApprovalAction,
  describeApprovalSummaryProblem,
} from "../lib/approval-summary.ts";
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
const summary = (closingLine: string) =>
  z
    .string()
    .min(1)
    .max(APPROVAL_SUMMARY_MAX_LENGTH)
    .describe(
      `The entire approval text a person sees; nothing else of this request is shown. Plain text up to 2,500 characters: first line \`For <root display name>:\`, then the plain-language proposal, then the last line \`${closingLine}\``,
    );

const inputSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("deployment"),
      expectedHead: head,
    })
    .strict(),
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
      expectedRows: z
        .number()
        .int()
        .nonnegative()
        .describe("Row count from the preview the user accepted; start refuses when the fresh dry run differs."),
      expectedProjectedCostUsd: z
        .number()
        .nonnegative()
        .describe("Projected cost in USD from the preview the user accepted; start refuses when the fresh dry run differs."),
      summary: summary("Approve to run, or Cancel and tell me what to change."),
    })
    .strict(),
  z.object({ action: z.literal("status"), runKey }).strict(),
  z
    .object({
      action: z.literal("diagram"),
      workflowPath,
      runKey: runKey
        .nullable()
        .describe("Run key to overlay status and spend, or null for the workflow shape."),
    })
    .strict(),
  z
    .object({
      action: z.literal("cancel"),
      runKey,
      reason: z.string().max(500).nullable(),
      summary: summary("Approve to stop the run, or Cancel to leave it running."),
    })
    .strict(),
  z
    .object({
      action: z.literal("approve"),
      runKey,
      approved: z.boolean(),
      comment: z.string().max(500).nullable(),
      summary: summary(
        "Approve to continue the run, or Cancel to leave it paused and tell me what to do. (when approved is true) or Approve to stop the run here, or Cancel to leave it paused. (when approved is false)",
      ),
    })
    .strict(),
]);

type Input = z.infer<typeof inputSchema>;

/** The closing line an approval-gated action must carry, or null when it needs no approval. */
export function approvalActionFor(
  input: { readonly action?: unknown; readonly approved?: unknown } | undefined,
): ApprovalAction | null {
  switch (input?.action) {
    case "start":
      return "run-start";
    case "cancel":
      return "cancel-live-run";
    case "approve":
      return input.approved === false ? "stop-paused-run" : "checkpoint-continue";
    default:
      return null;
  }
}

const operationApproval: Approval<Input> = ({ toolInput }) => {
  const action = approvalActionFor(toolInput);
  if (action === null) return "not-applicable";
  const problem = describeApprovalSummaryProblem(
    (toolInput as { summary?: unknown } | undefined)?.summary,
    action,
  );
  if (problem !== null) {
    return {
      type: "denied",
      reason: `${problem} Correct the request and resubmit it for approval. Nothing was started, changed, or stopped.`,
    };
  }
  return "user-approval";
};

export default defineTool({
  description:
    "Check deployment, preview, start, inspect, approve, or cancel a workflow on the fixed protected Vercel production project. Deployment, preview, and status are read-only; deployment reports whether production serves the given workspace commit. Start repeats the dry run, refuses when its rows or projected cost differ from the accepted values, and waits for the exact connected-workspace Git SHA to be live. Start, approval, and cancel require native approval. Production, OIDC, and hook tokens stay inside the trusted host runtime. Diagram is read-only: it returns a signed link to the workflow picture, the image link the channel attempts to deliver, and the where-to-look links. Ready confirms URL availability, not Slack delivery. Include the returned diagram page URL in your reply; it reports protected when deployment protection blocks the link.",
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
    if (input.action === "deployment") return control.getDeployment(input.expectedHead);
    if (input.action === "status") return control.getRun(input.runKey);
    if (input.action === "cancel") {
      return control.cancelRun({ reason: input.reason, runKey: input.runKey });
    }
    if (input.action === "approve") {
      return control.approveRun({
        approved: input.approved,
        comment: input.comment,
        runKey: input.runKey,
      });
    }

    if (input.action === "diagram") {
      return control.getDiagram({
        workflowPath: input.workflowPath,
        runKey: input.runKey,
        databaseUrl: configuration.workflow?.databaseUrl ?? null,
        sandbox: await ctx.getSandbox(),
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
      : control.startRun({
          ...request,
          expectedProjectedCostUsd: input.expectedProjectedCostUsd,
          expectedRows: input.expectedRows,
        });
  },
});
