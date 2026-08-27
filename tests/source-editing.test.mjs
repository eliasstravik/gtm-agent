import assert from "node:assert/strict";
import test from "node:test";

import { applyExactSourceEdits } from "../agent/lib/source-editing.ts";

test("exact source edits apply unique non-overlapping replacements", () => {
  assert.equal(
    applyExactSourceEdits("alpha beta gamma\n", [
      { oldText: "alpha", newText: "one" },
      { oldText: "gamma", newText: "three" },
    ]),
    "one beta three\n",
  );
});

test("exact source edits reject missing, ambiguous, and overlapping matches", () => {
  assert.throws(
    () => applyExactSourceEdits("same same", [{ oldText: "same", newText: "x" }]),
    /more than once/i,
  );
  assert.throws(
    () => applyExactSourceEdits("alpha", [{ oldText: "beta", newText: "x" }]),
    /not found/i,
  );
  assert.throws(
    () =>
      applyExactSourceEdits("alpha beta", [
        { oldText: "alpha beta", newText: "x" },
        { oldText: "beta", newText: "y" },
      ]),
    /overlap/i,
  );
});
