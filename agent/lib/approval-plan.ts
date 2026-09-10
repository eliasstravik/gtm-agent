import { createHash } from "node:crypto";
import { defineState } from "eve/context";
import { once, type ApprovalContext } from "eve/tools/approval";

export type PlanCall = { toolName: string; input: Record<string, unknown> };
type Grant = { digest: string; principalId: string; callId: string | null };
export const acceptedPlan = defineState<Grant[]>("gtm-agent.accepted-plan", () => []);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, canonical(item)]),
  );
  return value;
}

export function planCallDigest(call: PlanCall): string {
  return createHash("sha256").update(JSON.stringify(canonical({ toolName: call.toolName, input: call.input }))).digest("hex");
}

/** One execution per accepted call, tied to the initiating principal and full input. */
export function claimPlanCall(grants: readonly Grant[], call: PlanCall, principalId: string, callId: string): Grant[] | null {
  const digest = planCallDigest(call);
  const replay = grants.findIndex(grant => grant.callId === callId && grant.digest === digest && grant.principalId === principalId);
  const index = replay >= 0 ? replay : grants.findIndex(grant => grant.callId === null);
  if (index < 0 || grants[index]?.digest !== digest || grants[index]?.principalId !== principalId) return null;
  return grants.map((grant, i) => i === index ? { ...grant, callId } : grant);
}

export function planApproval(ctx: ApprovalContext<unknown>) {
  const principalId = ctx.session?.auth.current?.principalId;
  if (!principalId || !ctx.toolInput || typeof ctx.toolInput !== "object") return "user-approval" as const;
  const claimed = claimPlanCall(acceptedPlan.get(), { toolName: ctx.toolName, input: ctx.toolInput as Record<string, unknown> }, principalId, ctx.callId);
  if (!claimed) return "user-approval" as const;
  acceptedPlan.update(() => claimed);
  return "approved" as const;
}

/** Only use for explicitly classified safe operations; never paid calls or writes. */
export const repeatedSafeApproval = once();
