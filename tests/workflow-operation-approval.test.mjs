import assert from "node:assert/strict";
import test from "node:test";

import operateTool, { approvalActionFor } from "../agent/tools/operate_gtm_workflow.ts";

const RUN_KEY = "b".repeat(32);
const HEAD = "a".repeat(40);

const approve = (toolInput) =>
  operateTool.approval({
    toolInput,
    toolName: "operate_gtm_workflow",
    callId: "test-operate",
    approvedTools: new Set(),
  });

const START = {
  action: "start",
  expectedHead: HEAD,
  workflowPath: "score-leads",
  inputPath: "workflows/data/leads.json",
  checkpoint: null,
  expectedRows: 120,
  expectedProjectedCostUsd: 3,
  summary: "For Acme:\nRun Score new leads on 120 rows for about $3.\nApprove to run, or Cancel and tell me what to change.",
};

test("read-only actions need no approval", async () => {
  assert.equal(await approve({ ...START, action: "preview", summary: undefined }), "not-applicable");
  assert.equal(await approve({ action: "status", runKey: RUN_KEY }), "not-applicable");
  assert.equal(await approve({ action: "deployment", expectedHead: HEAD }), "not-applicable");
  assert.equal(await approve(undefined), "not-applicable");
});

test("each gated action maps to its closing line", () => {
  assert.equal(approvalActionFor({ action: "start" }), "run-start");
  assert.equal(approvalActionFor({ action: "cancel" }), "cancel-live-run");
  assert.equal(approvalActionFor({ action: "approve", approved: true }), "checkpoint-continue");
  assert.equal(approvalActionFor({ action: "approve", approved: false }), "stop-paused-run");
  assert.equal(approvalActionFor({ action: "preview" }), null);
  assert.equal(approvalActionFor(undefined), null);
});

test("a gated action with the right closing line asks a person", async () => {
  assert.equal(await approve(START), "user-approval");
  assert.equal(
    await approve({
      action: "cancel",
      runKey: RUN_KEY,
      reason: null,
      summary: "For Acme:\nStop Score new leads now; 40 of 120 rows are done.\nApprove to stop the run, or Cancel to leave it running.",
    }),
    "user-approval",
  );
  assert.equal(
    await approve({
      action: "approve",
      runKey: RUN_KEY,
      approved: true,
      comment: null,
      summary: "For Acme:\n40 rows done, 0 failed, $1 spent, about $2 more.\nApprove to continue the run, or Cancel to leave it paused and tell me what to do.",
    }),
    "user-approval",
  );
  assert.equal(
    await approve({
      action: "approve",
      runKey: RUN_KEY,
      approved: false,
      comment: null,
      summary: "For Acme:\nStop Score new leads at 40 rows.\nApprove to stop the run here, or Cancel to leave it paused.",
    }),
    "user-approval",
  );
});

test("a gated action with the wrong closing line is denied before any person sees it", async () => {
  const result = await approve({ ...START, summary: "For Acme:\nPRIVATE\nApprove to save, or Cancel and tell me what to change." });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /Approve to run, or Cancel and tell me what to change\./);
  assert.match(result.reason, /Nothing was started/);
  assert.doesNotMatch(result.reason, /PRIVATE/);

  const stop = await approve({
    action: "approve",
    runKey: RUN_KEY,
    approved: false,
    comment: null,
    summary: "For Acme:\nStop here.\nApprove to continue the run, or Cancel to leave it paused and tell me what to do.",
  });
  assert.equal(stop.type, "denied");
  assert.match(stop.reason, /Approve to stop the run here, or Cancel to leave it paused\./);
});
