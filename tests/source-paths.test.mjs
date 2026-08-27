import assert from "node:assert/strict";
import test from "node:test";

import {
  assertSourceDeletion,
  assertSourceWrite,
  classifySourcePath,
} from "../agent/lib/source-paths.ts";

test("source allowlist contains only instructions and direct native schedules", () => {
  assert.equal(classifySourcePath("agent/instructions.md"), "instructions");
  assert.equal(classifySourcePath("agent/schedules/daily-joke.ts"), "schedule");
  assert.equal(classifySourcePath("agent/schedules/morning.md"), "schedule");
  for (const path of [
    "agent/agent.ts",
    "agent/tools/publish_source_change.ts",
    "agent/skills/gtm-workflow/SKILL.md",
    "agent/schedules/nested/joke.ts",
    "package.json",
    "../agent/instructions.md",
  ]) {
    assert.throws(() => classifySourcePath(path), /allowlist/i, path);
  }
});

test("instructions can be edited but only schedules can be deleted", () => {
  assert.equal(assertSourceWrite("agent/instructions.md", "# Instructions\n"), "instructions");
  assert.doesNotThrow(() => assertSourceDeletion("agent/schedules/joke.ts"));
  assert.throws(() => assertSourceDeletion("agent/instructions.md"), /cannot delete/i);
  assert.throws(
    () => assertSourceWrite("agent/schedules/joke.ts", "bad\0content"),
    /UTF-8 text/i,
  );
});
