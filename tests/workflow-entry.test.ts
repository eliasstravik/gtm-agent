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

test("oversized model labels become a valid workflow button and retain the fallback URL", () => {
  const origin = "https://workflows.example";
  const url = `${origin}/viewer?workflow=3aeb1f21-183b-487d-a009-8586e93cda33`;
  for (const label of [url, `<${url}|Open GTM Workflows>`, `[Open Workflows](${url})`]) {
    const message = workflowEntryReply({ text: "Here's the GTM Workflows UI:", blocks: [{ type: "actions", elements: [{ type: "button", text: { type: "mrkdwn", text: label }, url }] }] }, origin);
    const button = (message.blocks[0] as any).elements[0];
    assert.deepEqual(button.text, { type: "plain_text", text: "Open GTM Workflows" });
    assert.equal(button.style, "primary");
    assert.equal(button.url, url);
    assert.ok(message.text.includes(url));
    assert.deepEqual(workflowEntryReply(message, origin), message);
  }
});

test("unrelated long action labels also obey Slack limits and keep their URLs", () => {
  const url = "https://example.com/article";
  const message = workflowEntryReply({ text: "Source:", blocks: [{ type: "actions", elements: [{ type: "button", text: { type: "plain_text", text: "A".repeat(120) }, url }] }] });
  const button = (message.blocks[0] as any).elements[0];
  assert.ok(button.text.text.length <= 75);
  assert.equal(button.url, url);
  assert.ok(message.text.includes(url));
  assert.equal(button.style, undefined);
});
