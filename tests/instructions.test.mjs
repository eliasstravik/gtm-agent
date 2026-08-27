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
    /no Vercel CLI|Vercel CLI is not/i,
    /deploy_gtm_workflows/,
    /operate_gtm_workflow/,
    /commit to `main` does not deploy/i,
    /save, deploy, and run as separate states/i,
    /read-only deployment preview/i,
    /read-only run preview/i,
    /hook token/i,
    /expose no (?:sandbox )?port|no (?:sandbox )?port/i,
    /npm run gtm -- runs get/,
    /npm run gtm -- query/,
    /npx workflow inspect/,
    /firewall|brokered/i,
    /never (?:print|paste|echo)[\s\S]*(?:token|secret|key)/i,
    /same session/i,
  ]) {
    assert.match(instructions, pattern);
  }
  assert.doesNotMatch(instructions, /db:studio/);
});

test("instructions leave domain workflows and no-workspace behavior to skills", () => {
  assert.match(instructions, /skills govern/i);
  assert.match(instructions, /do not invent.*alternate/i);
  assert.doesNotMatch(instructions, /scoring rubric|ICP definition|persona definition/i);
});
