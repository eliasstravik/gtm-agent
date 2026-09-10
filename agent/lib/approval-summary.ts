/**
 * Hosted conversation contract for the vendored GTM skills.
 *
 * On a surface with a native approval control, the approval-gated tool's
 * `summary` is the entire proposal a person sees. The host declares the
 * plain-text limit to the skills, renders only that text with Approve and
 * Cancel, and checks the action's closing line deterministically before it
 * asks anyone to approve. See `docs/gtm-agent-requirements.md` in gtm-skills.
 */

/** Longest approval text the Slack surface renders in one message. */
export const APPROVAL_SUMMARY_MAX_LENGTH = 2_500;

/** Required last line of the approval text, by the action it gates. */
export const APPROVAL_CLOSING_LINES = {
  save: "Approve to save, or Cancel and tell me what to change.",
  "run-start": "Approve to run, or Cancel and tell me what to change.",
  "checkpoint-continue":
    "Approve to continue the run, or Cancel to leave it paused and tell me what to do.",
  "stop-paused-run": "Approve to stop the run here, or Cancel to leave it paused.",
  "cancel-live-run": "Approve to stop the run, or Cancel to leave it running.",
} as const;

export type ApprovalAction = keyof typeof APPROVAL_CLOSING_LINES;

export function describePlainApprovalTextProblem(text: unknown): string | null {
  if (typeof text !== "string" || !text.trim()) return "The approval text is empty.";
  if (/^Approve\s+[^\n]+\?$/i.test(text.trim())) return "Replace the default approval prompt with a plain description of the action, effects, and cost.";
  if (/```|^\s*[\[{]|^\s*"[^"\n]+"\s*:/m.test(text)) return "Approval text must describe the action in plain words, without JSON or code.";
  return null;
}

/** The last non-empty line of a text, trimmed; empty when there is none. */
export function lastLine(text: string): string {
  const lines = text
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  return lines.at(-1) ?? "";
}

/**
 * One actionable sentence when the approval text cannot be put in front of
 * a person for this action, or `null` when it can. Never echoes the text.
 */
export function describeApprovalSummaryProblem(
  summary: unknown,
  action: ApprovalAction,
): string | null {
  const plainProblem = describePlainApprovalTextProblem(summary);
  if (plainProblem !== null) return plainProblem;
  if (typeof summary !== "string") return "The approval text is empty.";
  if (summary.length > APPROVAL_SUMMARY_MAX_LENGTH) {
    return `The approval text is ${summary.length} characters and the limit is ${APPROVAL_SUMMARY_MAX_LENGTH}; split the proposal into parts.`;
  }
  const required = APPROVAL_CLOSING_LINES[action];
  if (lastLine(summary) !== required) {
    return `The approval text must end with the line "${required}".`;
  }
  return null;
}
