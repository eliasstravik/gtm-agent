import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const instructions = await readFile(
  new URL("../agent/instructions.md", import.meta.url),
  "utf8",
);

test("standing instructions define the fixed Slack and context mechanics", () => {
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
    /apply_gtm_context_changes/,
    /do not ask for.*extra.*acceptance/is,
    /approval.*truncate/is,
    /no durable change was made/i,
    /GitHub commit URL/i,
    /private.*public web search/is,
    /create.*import.*sharing.*whole-repository deletion/is,
  ]) {
    assert.match(instructions, pattern);
  }
});

test("instructions leave domain workflows and no-context behavior to skills", () => {
  assert.match(instructions, /skills govern/i);
  assert.match(instructions, /do not invent.*alternate/i);
  assert.doesNotMatch(instructions, /scoring rubric|ICP definition|persona definition/i);
});
