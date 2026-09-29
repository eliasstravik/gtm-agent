import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// Slack renders a tool or connection approval as a bare "Approve tool call: <name>" card on every call. A costly
// job asks once through ask_question instead (see the instructions), so no tool or connection may set approval.
test("no tool or connection asks approval per call", () => {
  const files = ["agent/tools", "agent/connections"].filter(existsSync)
    .flatMap(dir => readdirSync(dir).filter(f => f.endsWith(".ts")).map(f => join(dir, f)));
  assert.ok(files.length > 0);
  for (const file of files) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /\bapproval\s*:|needsApproval|eve\/tools\/approval/, file);
  }
});
