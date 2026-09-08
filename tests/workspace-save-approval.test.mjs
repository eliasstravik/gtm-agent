import assert from "node:assert/strict";
import test from "node:test";

import saveTool from "../agent/tools/apply_gtm_workspace_changes.ts";

const BASE = {
  summary:
    "For Acme:\nUpdate the workflow project settings and remove an old workflow file.\nApprove to save, or Cancel and tell me what to change.",
  manifest: [
    { path: "workflows/package.json", operation: "write" },
    { path: "workflows/old.ts", operation: "delete" },
  ],
  expectedHead: "a".repeat(40),
  message: "Update workflow configuration",
  additions: [{ path: "workflows/package.json", content: "PRIVATE_FILE_CONTENT" }],
  deletions: [{ path: "workflows/old.ts" }],
  migrations: [],
  destructive: false,
};

const approve = (toolInput) => saveTool.approval({
  toolInput,
  toolName: "apply_gtm_workspace_changes",
  callId: "test-save",
  approvedTools: new Set(["apply_gtm_workspace_changes"]),
});

test("an incomplete save is denied before human approval with a correction", async () => {
  const input = { ...BASE, manifest: [BASE.manifest[0]] };
  const before = structuredClone(input);
  const result = await approve(input);
  assert.equal(result.type, "denied");
  assert.match(result.reason, /missing.*delete.*workflows\/old\.ts/i);
  assert.match(result.reason, /resubmit/i);
  assert.doesNotMatch(result.reason, /PRIVATE_FILE_CONTENT/);
  assert.deepEqual(input, before);
});

test("same-sized stale manifests report missing and extra entries", async () => {
  const result = await approve({
    ...BASE,
    manifest: [BASE.manifest[0], { path: "workflows/stale.ts", operation: "delete" }],
  });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /missing.*workflows\/old\.ts/i);
  assert.match(result.reason, /unexpected.*workflows\/stale\.ts/i);
});

test("incorrect manifest operations identify the expected operation", async () => {
  const result = await approve({
    ...BASE,
    manifest: [BASE.manifest[0], { ...BASE.manifest[1], operation: "write" }],
  });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /expected.*delete.*workflows\/old\.ts/i);
});

test("duplicate entries and unsafe paths never reach human approval", async () => {
  for (const input of [
    { ...BASE, manifest: [BASE.manifest[0], BASE.manifest[0]] },
    { ...BASE, additions: [{ path: "../secret", content: "PRIVATE_FILE_CONTENT" }] },
    undefined,
  ]) {
    const result = await approve(input);
    assert.equal(result.type, "denied");
    assert.doesNotMatch(result.reason, /PRIVATE_FILE_CONTENT/);
  }
});

test("a corrected save still requires fresh human approval", async () => {
  assert.equal(await approve(BASE), "user-approval");
  assert.equal(await approve({ ...BASE, manifest: [...BASE.manifest].reverse() }), "user-approval");
});

test("a summary without the save closing line is denied before human approval", async () => {
  const result = await approve({
    ...BASE,
    summary: "For Acme:\nPRIVATE_SUMMARY_TEXT\nSave this?",
  });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /must end with the line "Approve to save, or Cancel and tell me what to change\."/);
  assert.match(result.reason, /resubmit/i);
  assert.doesNotMatch(result.reason, /PRIVATE_SUMMARY_TEXT|PRIVATE_FILE_CONTENT/);
});

test("a summary over the declared approval-text limit is denied with a split instruction", async () => {
  const result = await approve({
    ...BASE,
    summary: `For Acme:\n${"x".repeat(2500)}\nApprove to save, or Cancel and tell me what to change.`,
  });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /limit is 2500/);
  assert.match(result.reason, /split/i);
});

test("migration validation also runs before approval", async () => {
  const result = await approve({ ...BASE, migrations: ["workflows/drizzle/0001_missing.sql"] });
  assert.equal(result.type, "denied");
  assert.match(result.reason, /declared migrations/i);
});
