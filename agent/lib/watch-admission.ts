import { defineState } from "eve/context";
import type { ApprovalContext } from "eve/tools/approval";

const admitted = defineState<Record<string, string>>("gtm-agent.watches", () => ({}));

/** Session-local admission survives foreground return and suppresses duplicate watchers. */
export function admitWatch(ctx: ApprovalContext<Record<string, unknown>>) {
  const input = ctx.toolInput ?? {};
  const key = ctx.toolName === "watch_gtm_deployment"
    ? `deployment:${input.expectedHead}:${input.workflowPath}`
    : `run:${input.runKey}:${input.afterCheckpoint ?? "initial"}`;
  const existing = admitted.get()[key];
  if (existing && existing !== ctx.callId) {
    return { type: "denied" as const, reason: "A follow-up already covers this version or run checkpoint in this thread. Do not start a duplicate watch." };
  }
  admitted.update(state => ({ ...state, [key]: ctx.callId }));
  return "not-applicable" as const;
}
