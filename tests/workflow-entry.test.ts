import { test } from "node:test";
import assert from "node:assert/strict";
import { workflowEntryReply } from "../agent/lib/workflow-entry.ts";
test("one primary workflow URL button and a usable fallback, preserving unrelated actions", () => {
  const button = { type: "button", text: { type: "plain_text", text: "Open GTM Workflows" }, url: "https://workflows.example/viewer?workflow=stable" };
  const source = { ...button, text: { type: "plain_text", text: "View source" }, url: "https://example.com/source" };
  const message = workflowEntryReply({ text: "Saved.", blocks: [{ type: "actions", elements: [button, button, source] }] });
  const elements = (message.blocks[0] as any).elements;
  assert.equal(elements.length, 2); assert.equal(elements[0].style, "primary"); assert.equal(elements[0].action_id, "open_gtm_workflows");
  assert.deepEqual(elements[1], source); assert.ok(message.text.includes(button.url));
  assert.deepEqual(workflowEntryReply(message), message);
});
test("an ordinary run reply gets no automatic entry", () => {
  const message = { text: "Done. 5 records saved.", blocks: [{ type: "markdown", text: "Done. 5 records saved." }] };
  assert.deepEqual(workflowEntryReply(message), message);
});
