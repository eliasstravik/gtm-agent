import assert from "node:assert/strict";
import { defineEval } from "eve/evals";

export default defineEval({
  description: "An explicit Open request returns the viewer without the intent menu.",
  async test(t) {
    const result = await t.send("Open GTM Workflows");
    result.expectOk();
    assert.match(result.message ?? "", /Open GTM Workflows/);
    assert.match(result.message ?? "", /https:\/\/[^\s"<>]+\/viewer/);
    assert.equal(result.inputRequests.length, 0);
    t.notCalledTool("slack_send_message");
    t.succeeded();
  },
});
