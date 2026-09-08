import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const instructions = await readFile(
  new URL("../agent/instructions.md", import.meta.url),
  "utf8",
);

test("standing instructions define the fixed Slack and workspace mechanics", () => {
  for (const pattern of [
    /GTM Agent/,
    /careful, evidence-backed GTM teammate/i,
    /Slack/i,
    /\$HOME\/\.gtm/,
    /GitHub is durable/i,
    /per-session checkout/i,
    /do not add.*remote/i,
    /do not.*fetch.*pull.*push/is,
    /do not modify.*before approval/i,
    /apply_gtm_workspace_changes/,
    /native approval control.*accept step/is,
    /`summary` is the entire proposal/,
    /2,500 characters/,
    /bullet lines starting `- `/,
    /only through the approval control.*or a numbered choice block/is,
    /never define a confirmation phrase/i,
    /do not announce that research is complete/i,
    /first line `For <root display name>:`/,
    /last line `Approve to save, or Cancel and tell me what to change\.`/,
    /renders only that text with Approve and Cancel/,
    /no proposal message before the tool call/i,
    /no numbered accept/i,
    /contains no text and no other tool call/,
    /denies a summary whose last line is wrong/i,
    /split it along the skills' batching boundaries/i,
    /Reply with a number, or type your answer\./,
    /ask_question/,
    /then `Saved\.`/,
    /It will be live in production in a few minutes; ask me to check\./,
    /Report no commit URL, hash, path list, or repository reference/,
    /approval message shows only `summary`/i,
    /\*\*What would you like me to change\?\*\*/,
    /no remote and no repo-local Git identity/i,
    /web_search|web_fetch/,
    /nothing was saved/i,
    /private.*public web search/is,
    /create.*import.*sharing.*whole-(?:repository|workspace) deletion/is,
    /\/gtm-workspace.*keyboard/is,
    /not set up yet/i,
    /connected-repo substitutions/i,
    /ORG\.md[\s\S]*AGENTS\.md[\s\S]*CLAUDE\.md[\s\S]*\.gitignore/,
    /refuses any other write until root `ORG\.md` exists/i,
    /create a different (?:workspace )?repository/i,
  ]) {
    assert.match(instructions, pattern);
  }
  assert.doesNotMatch(instructions, /two steps/i);
  assert.doesNotMatch(instructions, /saved to history/i);
  assert.doesNotMatch(instructions, /GitHub commit URL/i);
  assert.doesNotMatch(instructions, /report every affected path/i);
});

test("standing instructions declare the sandbox workflow runtime and its limits", () => {
  for (const pattern of [
    /GTM_SANDBOX=1/,
    /GTM_AGENT_BACKEND=api/,
    /TURSO_DATABASE_URL/,
    /\$HOME\/\.gtm-scratch\/<repo>\/workflows\//,
    /node_modules\/[\s\S]*\.env\b[\s\S]*\.env\.turso[\s\S]*\.workflow-data\/[\s\S]*\.nitro\/[\s\S]*\.output\/[\s\S]*data\//,
    /without approval/i,
    /apply_gtm_workspace_changes[\s\S]*workflows\//,
    /Runs: on this computer/,
    /Runs: on Vercel/,
    /never starts a real run|starts no real run/i,
    /read-only/i,
    /TURSO_READ_ONLY_AUTH_TOKEN|read-only (?:Turso )?token/i,
    /migrations[\s\S]*destructive/i,
    /expectedRows[\s\S]*expectedProjectedCostUsd/,
    /cancel action/i,
    /already applied/i,
    /no Vercel CLI|Vercel CLI is not/i,
    /operate_gtm_workflow/,
    /Saving this also puts it live in production\./,
    /read-only deployment action/i,
    /`Live\.` or `Not yet live\.`/,
    /Approve to run, or Cancel and tell me what to change\./,
    /Approve to continue the run, or Cancel to leave it paused and tell me what to do\./,
    /Approve to stop the run here, or Cancel to leave it paused\./,
    /Approve to stop the run, or Cancel to leave it running\./,
    /applies accepted workflow migrations.*verifies their ledger hashes before/i,
    /exact commit SHA/i,
    /read-only run preview/i,
    /hook token/i,
    /expose no (?:sandbox )?port|no (?:sandbox )?port/i,
    /npm run gtm -- query/,
    /firewall|brokered/i,
    /never (?:print|paste|echo)[\s\S]*(?:token|secret|key)/i,
    /same session/i,
  ]) {
    assert.match(instructions, pattern);
  }
  assert.doesNotMatch(instructions, /starts production deployment/i);
  assert.doesNotMatch(instructions, /deploying, not live/i);
  assert.doesNotMatch(instructions, /db:studio/);
  assert.doesNotMatch(instructions, /GTM_RUN_SECRET/);
  assert.doesNotMatch(instructions, /AI_GATEWAY_API_KEY/);
  assert.doesNotMatch(instructions, /npm run gtm -- runs get|npx workflow inspect/);
});

test("instructions leave domain workflows and no-workspace behavior to skills", () => {
  assert.match(instructions, /skills govern/i);
  assert.match(instructions, /do not invent.*alternate/i);
  assert.doesNotMatch(instructions, /scoring rubric|ICP definition|persona definition/i);
});

test("agent-source changes stay outside the workspace writer", () => {
  for (const pattern of [
    /not GTM workspace changes/i,
    /never send them to `apply_gtm_workspace_changes`/i,
    /source_editor/i,
    /complete trusted diff/i,
    /integrity hash/i,
    /same parked `source_editor` child/i,
    /Accept and open a draft PR/i,
    /native tool approval.*second durable authorization/is,
    /sandbox edit.*(?:GitHub|deployed agent)/is,
    /starts in `gtm-skills`/i,
    /draft pull request/i,
    /never merges or deploys/i,
    /already_absent.*no_changes/is,
    /Relay every source-editor outcome/i,
  ]) {
    assert.match(instructions, pattern);
  }
});
