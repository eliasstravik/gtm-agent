import { createHash } from "node:crypto";

export type ReplayState = { retries: Record<string, number> };
export type ApprovalInput = { command: string; summary?: string };
export type ApprovalDecision = {
  kind: "not-applicable" | "denied" | "approved" | "user-approval";
  reason?: string;
  state: ReplayState;
};

const DENIAL = "Say in plain words what this does and what it costs";
const SILENT_RETRIES = 2;
const CARD_LIMIT = 700;

/** The replay identity: the exact command and the exact card text. Either changing means a new card. */
export function replayKey(input: ApprovalInput): string {
  return createHash("sha256").update(`${input.command}\0${input.summary ?? ""}`).digest("hex");
}

/**
 * Allow-listed commands run without asking. Anything else needs plain card text,
 * then one user approval; the identical step may replay silently twice after that.
 */
export function decideApproval(input: ApprovalInput, state: ReplayState, allow: (command: string) => boolean): ApprovalDecision {
  if (allow(input.command)) return { kind: "not-applicable", state };
  if (!input.summary?.trim()) return { kind: "denied", reason: DENIAL, state };
  const id = replayKey(input);
  const left = state.retries[id] ?? 0;
  if (left > 0) return { kind: "approved", state: { retries: { ...state.retries, [id]: left - 1 } } };
  return { kind: "user-approval", state };
}

/** Remember a user-approved step so the same command and text may replay silently. */
export function recordApproved(input: ApprovalInput, state: ReplayState): ReplayState {
  return { retries: { ...state.retries, [replayKey(input)]: SILENT_RETRIES } };
}

/** The card shows only the tool's plain summary, never the command or its JSON. */
export function approvalCardText(request: { kind: string; prompt: string; action?: { input?: Record<string, unknown> } }): string {
  const summary = request.kind === "tool-approval" && typeof request.action?.input?.summary === "string"
    ? request.action.input.summary.trim()
    : request.kind === "tool-approval" ? "" : request.prompt.trim();
  return (summary || "Approve this action?").slice(0, CARD_LIMIT);
}
