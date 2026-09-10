import type { ApprovalContext } from "eve/tools/approval";
import { planApproval } from "./approval-plan.ts";

export const MONID_EFFECTFUL_TOOLS = [
  "monid__monid_run", "monid__monid_stop_run",
  "monid__monid_get_resource_external", "monid__monid_release_resource",
] as const;
const READ_ONLY = new Set([
  "monid__monid_discover", "monid__monid_inspect", "monid__monid_get_run",
  "monid__monid_list_runs", "monid__monid_list_resources", "monid__monid_get_resource",
  "monid__monid_list_resource_events", "monid__monid_balance",
]);

/** Deployments attach this to their existing Monid connection; it adds no connection. */
export function connectionApproval(ctx: ApprovalContext) {
  if (READ_ONLY.has(ctx.toolName)) return "not-applicable" as const;
  if (!MONID_EFFECTFUL_TOOLS.some(name => name === ctx.toolName)) {
    return { type: "denied" as const, reason: "This connection tool has no reviewed approval policy." };
  }
  if (planApproval(ctx) === "approved") return "approved" as const;
  return { type: "denied" as const, reason: "Request approve_gtm_plan first with this exact call, a plain description of its provider, destination, effects, and the inspected cost. Then execute the accepted call once. No external action ran." };
}
