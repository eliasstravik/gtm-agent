import assert from "node:assert/strict";
import test from "node:test";
import { claimPlanCall, planCallDigest } from "../agent/lib/approval-plan.ts";
import { connectionApproval } from "../agent/lib/connection-approval.ts";
import { validatePlan } from "../agent/tools/approve_gtm_plan.ts";

const call = { toolName: "monid__monid_run", input: { destination: "approved-table", rows: 1 } };
const grant = { digest: planCallDigest(call), principalId: "alice", callId: null };

test("a plan covers exact input, principal, order, and one execution", () => {
  assert.equal(claimPlanCall([grant], { ...call, input: { ...call.input, rows: 2 } }, "alice", "one"), null);
  assert.equal(claimPlanCall([grant], { ...call, input: { ...call.input, destination: "elsewhere" } }, "alice", "one"), null);
  assert.equal(claimPlanCall([grant], call, "bob", "one"), null);
  const used = claimPlanCall([grant], call, "alice", "one");
  assert.equal(used[0].callId, "one");
  assert.deepEqual(claimPlanCall(used, call, "alice", "one"), used);
  assert.equal(claimPlanCall(used, call, "alice", "two"), null);
  const second = { ...call, input: { ...call.input, rows: 3 } };
  const grants = [grant, { ...grant, digest: planCallDigest(second) }];
  assert.equal(claimPlanCall(grants, second, "alice", "two"), null);
  assert.ok(claimPlanCall(claimPlanCall(grants, call, "alice", "one"), second, "alice", "two"));
  assert.equal(planCallDigest(call), planCallDigest({ ...call, input: { rows: 1, destination: "approved-table" }, summary: "Visible description" }));
});

test("connection plans require human text, inspected costs, and an accurate total", () => {
  const plan = { summary: "Enrich one account and save the result.", totalCostUsd: 0.1,
    calls: [{ ...call, summary: "Enrich one account using the selected provider for an estimated $0.10.", estimatedCostUsd: 0.1 }] };
  assert.deepEqual(validatePlan(plan), plan);
  assert.throws(() => validatePlan({ ...plan, totalCostUsd: 0 }), /total cost/);
  assert.throws(() => validatePlan({ ...plan, calls: [{ ...call, estimatedCostUsd: 0.1 }] }), /empty/);
  assert.throws(() => validatePlan({ ...plan, calls: [{ ...plan.calls[0], summary: "Approve monid_run?" }] }), /default approval/);
  assert.throws(() => validatePlan({ ...plan, calls: [{ ...plan.calls[0], toolName: "publish_source_change" }] }));
});

test("connection policy never prompts for reads and refuses unplanned effects", () => {
  assert.equal(connectionApproval({ toolName: "monid__monid_inspect" }), "not-applicable");
  assert.equal(connectionApproval({ toolName: "monid__monid_balance" }), "not-applicable");
  const result = connectionApproval({ toolName: call.toolName });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /approve_gtm_plan/);
  assert.equal(connectionApproval({ toolName: "monid__future_tool" }).type, "denied");
});
