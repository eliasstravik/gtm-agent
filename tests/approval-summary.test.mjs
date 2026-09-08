import assert from "node:assert/strict";
import test from "node:test";

import {
  APPROVAL_CLOSING_LINES,
  APPROVAL_SUMMARY_MAX_LENGTH,
  describeApprovalSummaryProblem,
  lastLine,
} from "../agent/lib/approval-summary.ts";

const SAVE = APPROVAL_CLOSING_LINES.save;

test("the approval text limit and closing lines match the hosted contract", () => {
  assert.equal(APPROVAL_SUMMARY_MAX_LENGTH, 2500);
  assert.equal(SAVE, "Approve to save, or Cancel and tell me what to change.");
  assert.equal(
    APPROVAL_CLOSING_LINES["run-start"],
    "Approve to run, or Cancel and tell me what to change.",
  );
  assert.equal(
    APPROVAL_CLOSING_LINES["checkpoint-continue"],
    "Approve to continue the run, or Cancel to leave it paused and tell me what to do.",
  );
  assert.equal(
    APPROVAL_CLOSING_LINES["stop-paused-run"],
    "Approve to stop the run here, or Cancel to leave it paused.",
  );
  assert.equal(
    APPROVAL_CLOSING_LINES["cancel-live-run"],
    "Approve to stop the run, or Cancel to leave it running.",
  );
});

test("a summary that ends with the action's closing line is accepted", () => {
  const summary = `For Acme:\nRevenue Leader (Acme)\n- role: VP Sales\n${SAVE}`;
  assert.equal(describeApprovalSummaryProblem(summary, "save"), null);
  assert.equal(describeApprovalSummaryProblem(`${summary}\n\n  \n`, "save"), null);
});

test("a wrong or missing closing line is named without echoing the text", () => {
  const problem = describeApprovalSummaryProblem(
    "For Acme:\nPRIVATE_SUMMARY_TEXT\nSave this?",
    "save",
  );
  assert.match(problem, /must end with the line "Approve to save, or Cancel and tell me what to change\."/);
  assert.doesNotMatch(problem, /PRIVATE_SUMMARY_TEXT/);

  const runProblem = describeApprovalSummaryProblem(`For Acme:\nRun it\n${SAVE}`, "run-start");
  assert.match(runProblem, /Approve to run, or Cancel and tell me what to change\./);
});

test("empty, non-string, and oversized summaries are refused", () => {
  assert.match(describeApprovalSummaryProblem("", "save"), /empty/i);
  assert.match(describeApprovalSummaryProblem("   \n", "save"), /empty/i);
  assert.match(describeApprovalSummaryProblem(undefined, "save"), /empty/i);
  assert.match(describeApprovalSummaryProblem(42, "save"), /empty/i);

  const oversized = `${"x".repeat(APPROVAL_SUMMARY_MAX_LENGTH)}\n${SAVE}`;
  const problem = describeApprovalSummaryProblem(oversized, "save");
  assert.match(problem, /limit is 2500/);
  assert.match(problem, /split/i);

  const exact = `${"x".repeat(APPROVAL_SUMMARY_MAX_LENGTH - SAVE.length - 1)}\n${SAVE}`;
  assert.equal(exact.length, APPROVAL_SUMMARY_MAX_LENGTH);
  assert.equal(describeApprovalSummaryProblem(exact, "save"), null);
});

test("lastLine ignores trailing blank lines and surrounding whitespace", () => {
  assert.equal(lastLine("a\n  b  \n\n"), "b");
  assert.equal(lastLine("\n\n"), "");
  assert.equal(lastLine("only"), "only");
});
