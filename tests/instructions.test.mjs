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
    /approval.*how acceptance is expressed/is,
    /after the skill.*accept.*loop.*never instead/is,
    /two steps/i,
    /Reply with a number/,
    /ask_question/,
    /commit URL.*(?:overrides|replaces|instead of).*saved to history|saved to history.*commit URL/is,
    /no remote and no repo-local Git identity/i,
    /web_search|web_fetch/,
    /approval.*truncate/is,
    /no durable change was made/i,
    /GitHub commit URL/i,
    /private.*public web search/is,
    /create.*import.*sharing.*whole-(?:repository|workspace) deletion/is,
    /\/gtm-workspace.*keyboard/is,
  ]) {
    assert.match(instructions, pattern);
  }
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
    /commit.*`main`.*starts production deployment/i,
    /applies any accepted workflow migrations before/i,
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
