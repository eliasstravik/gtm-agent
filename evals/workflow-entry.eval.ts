import assert from "node:assert/strict";
import { defineEval } from "eve/evals";

// Uses the real consuming agent. Opening reads its configured workspace; no workflow is started.
export default ["/gtm-workflow", "/gtm-workflows"].map(command => defineEval({
  description: `${command} asks for intent, then opens the existing viewer.`,
  async test(t) {
    const menu = await t.send(command);
    menu.expectOk();
    const request = menu.session.requireInputRequest({ toolName: "ask_question" });
    for (const label of ["Open GTM Workflows", "Create a workflow", "Manage a workflow"])
      assert.ok(request.options?.some(option => option.label.includes(label)), `Missing ${label}`);
    const open = request.options!.find(option => option.label.includes("Open GTM Workflows"))!;
    const result = await menu.session.respond([{ requestId: request.requestId, optionId: open.id }]);
    result.expectOk();
    assert.match(result.message ?? "", /Open GTM Workflows/);
    assert.match(result.message ?? "", /https:\/\/[^\s"<>]+\/viewer/);
    t.notCalledTool("slack_send_message");
    t.succeeded();
  },
}));
