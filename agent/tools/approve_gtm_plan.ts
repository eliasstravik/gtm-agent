import { defineTool } from "eve/tools";
import { z } from "zod";
import { acceptedPlan, planCallDigest } from "../lib/approval-plan.ts";
import { describeApprovalSummaryProblem, describePlainApprovalTextProblem } from "../lib/approval-summary.ts";
import { validateWorkspaceMutation } from "../lib/workspace-paths.ts";
import { inputSchema as workspaceSchema } from "./apply_gtm_workspace_changes.ts";
import { inputSchema as operationSchema, approvalActionFor } from "./operate_gtm_workflow.ts";
import { MONID_EFFECTFUL_TOOLS } from "../lib/connection-approval.ts";

const inputSchema = z.object({
  summary: z.string().min(1).max(2500),
  totalCostUsd: z.number().nonnegative(),
  calls: z.array(z.object({
    toolName: z.enum(["apply_gtm_workspace_changes", "operate_gtm_workflow", ...MONID_EFFECTFUL_TOOLS]),
    input: z.record(z.string(), z.unknown()),
    summary: z.string().min(1).max(2500).optional().describe("Required for a connection call whose schema cannot carry approval text. Name the inspected provider, destination, calls, and effects."),
    estimatedCostUsd: z.number().nonnegative().optional().describe("Required for connection calls; copy the inspected price for the exact scope. Use zero for free effectful actions."),
  }).strict()).min(1).max(8),
}).strict();

export function validatePlan(value: unknown) {
  const plan = inputSchema.parse(value);
  let cost = 0;
  for (const call of plan.calls) {
    if (!call.toolName.startsWith("monid__") && (call.summary !== undefined || call.estimatedCostUsd !== undefined)) throw new Error("GTM calls use their own approval summary and preview cost; do not override them.");
    if (call.toolName === "apply_gtm_workspace_changes") {
      validateWorkspaceMutation(workspaceSchema.parse(call.input));
      const problem = describeApprovalSummaryProblem(call.input.summary, "save");
      if (problem) throw new Error(problem);
    } else if (call.toolName === "operate_gtm_workflow") {
      const operation = operationSchema.parse(call.input);
      const action = approvalActionFor(operation);
      if (!action) throw new Error("Free checks do not belong in a paid approval plan.");
      if (operation.action !== "start") throw new Error("Checkpoint, callback and cancellation decisions need their own current run approval.");
      const problem = describeApprovalSummaryProblem(operation.summary, action);
      if (problem) throw new Error(problem);
      cost += operation.expectedProjectedCostUsd;
    } else {
      const problem = describePlainApprovalTextProblem(call.summary);
      if (problem) throw new Error(problem);
      if (call.estimatedCostUsd === undefined) throw new Error("Each connection call needs its inspected estimated cost.");
      cost += call.estimatedCostUsd;
    }
  }
  if (Math.abs(cost - plan.totalCostUsd) > 0.000001) throw new Error("The total cost must equal the sum of all listed calls.");
  const problem = describePlainApprovalTextProblem(plan.summary);
  if (problem) throw new Error(problem);
  return plan;
}

export default defineTool({
  description: "Request one approval for a fully specified GTM plan or configured Monid connection calls. Include every exact input, plain-language summary, and summed total cost. Monid calls need a separate summary naming provider, destination, calls and effects, plus estimatedCostUsd copied from inspected pricing. Each accepted call may execute once in order in this session; changed input requires a new approval. Source editing is excluded. Free checks run without approval. Prefer one ordinary run-start approval for a smoke run.",
  inputSchema,
  approval: ({ toolInput }) => {
    try { validatePlan(toolInput); return "user-approval"; }
    catch (error) { return { type: "denied", reason: `${error instanceof Error ? error.message : "Invalid plan."} Correct the plan and request approval again.` }; }
  },
  execute(input, ctx) {
    const plan = validatePlan(input);
    const principalId = ctx.session.auth.current?.principalId;
    if (!principalId) throw new Error("A plan needs an authenticated requester.");
    acceptedPlan.update(() => plan.calls.map(call => ({ digest: planCallDigest(call), principalId, callId: null })));
    return { status: "approved", calls: plan.calls.length, totalCostUsd: plan.totalCostUsd };
  },
});
