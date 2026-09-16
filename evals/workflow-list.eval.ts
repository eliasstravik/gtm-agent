import assert from "node:assert/strict";
import { defineEval } from "eve/evals";

export default defineEval({
  description: "Listing available workflows reads the workspace without any confirmation question.",
  async test(t) {
    const result = await t.send("list available workflows");
    result.expectOk();
    assert.equal(result.inputRequests.length, 0);
    t.notCalledTool("confirm_action");
    t.notCalledTool("ask_question");
    assert.ok(result.message?.trim(), "Return the workflow list or a concrete workspace blocker.");
    t.succeeded();
  },
});
