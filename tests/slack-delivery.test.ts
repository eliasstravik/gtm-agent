import { test } from "node:test";
import assert from "node:assert/strict";
import { parseBlocksReply } from "../agent/lib/blocks.ts";
import { workflowEntryReply } from "../agent/lib/workflow-entry.ts";
import { postRichReply } from "../agent/lib/slack-delivery.ts";

const origin = "https://workflows.example";
const url = `${origin}/viewer?workflow=3aeb1f21-183b-487d-a009-8586e93cda33`;
const modelReply = JSON.stringify({ text: "Here's the GTM Workflows UI:", blocks: [{ type: "actions", elements: [{ type: "button", text: { type: "mrkdwn", text: `<${url}|Open GTM Workflows>` }, url }] }] });

test("final reply delivery sends a Slack-valid button despite a malformed model label", async () => {
  const posts: any[] = [];
  const channel = { thread: { async post(message: any) {
    if (typeof message !== "string") {
      const button = message.blocks[0].elements[0];
      assert.equal(button.text.type, "plain_text");
      assert.ok(button.text.text.length <= 75);
    }
    posts.push(message);
  } } };
  await postRichReply(channel as any, workflowEntryReply(parseBlocksReply(modelReply)!, origin));
  assert.equal(posts.length, 1);
  assert.equal(posts[0].blocks[0].elements[0].text.text, "Open GTM Workflows");
  assert.equal(posts[0].blocks[0].elements[0].url, url);
});

test("a Slack rejection still delivers the workflow link in the same thread", async (t) => {
  t.mock.method(console, "error", () => {});
  const posts: unknown[] = [];
  const channel = { thread: { async post(message: unknown) {
    posts.push(message);
    if (typeof message !== "string") throw new Error("invalid_blocks");
  } } };
  await postRichReply(channel as any, workflowEntryReply(parseBlocksReply(modelReply)!, origin));
  assert.equal(posts.length, 2);
  assert.equal(typeof posts[1], "string");
  assert.ok((posts[1] as string).includes(url));
});
