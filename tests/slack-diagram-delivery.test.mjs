import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { createDiagramEvents } from "../agent/lib/slack-diagram-message.ts";

// Exercise the pinned Eve adapter, including its upload and message encoding.
// Only the HTTP boundary is fake; a thread.post spy cannot catch lost fallbacks.
const require = createRequire(import.meta.url);
const { buildSlackBinding } = await import(
  new URL("./api.js", pathToFileURL(require.resolve("eve/channels/slack"))).href
);
const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const READY = {
  action: "diagram", status: "ready", workflowPath: "qualify-linkedin-leads",
  imageUrl: "https://example.test/image?sig=private-signature",
  links: {
    diagram: "https://example.test/diagram?sig=private-signature",
    runs: "https://example.test/runs", data: "https://example.test/data",
  },
};

async function deliver(t, { failAt, rejectImage = false, rejectText = false } = {}) {
  const calls = [];
  const warnings = [];
  t.mock.method(console, "warn", (...args) => warnings.push(args));
  t.mock.method(globalThis, "fetch", async (url, init) => {
    const method = new URL(url).pathname.split("/").at(-1);
    const body = method === "upload" ? init.body : Object.fromEntries(new URLSearchParams(init.body));
    calls.push({ method, body });
    if (method === failAt) {
      if (method === "upload") return new Response("rejected", { status: 403 });
      return Response.json({ ok: false, error: "missing_scope", needed: "files:write", extra: READY.imageUrl });
    }
    if (method === "files.getUploadURLExternal") {
      return Response.json({ ok: true, file_id: "F_TEST", upload_url: "https://files.example.test/upload" });
    }
    if (method === "upload") return new Response("ok");
    if (method === "files.completeUploadExternal") return Response.json({ ok: true, files: [{ id: "F_TEST" }] });
    if (method === "chat.postMessage") {
      if ((body.blocks && rejectImage) || (!body.blocks && rejectText)) {
        return Response.json({ ok: false, error: body.blocks ? "invalid_blocks" : "channel_not_found" });
      }
      return Response.json({ ok: true, ts: "123.456", channel: "C_TEST" });
    }
    throw new Error(`Unexpected API request: ${method}`);
  });
  const channel = { ...buildSlackBinding({ botToken: "fake-token", channelId: "C_TEST", threadTs: "123.000" }), state: {} };
  const handlers = createDiagramEvents({
    fetch: async () => new Response(PNG, { headers: { "content-type": "image/png" } }),
  });
  await handlers["action.result"]({ turnId: "turn-1", result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(calls.length, 0);
  const complete = () => handlers["message.completed"]({ turnId: "turn-1", finishReason: "stop", message: "LinkedIn qualification workflow." }, channel);
  if (rejectText) await assert.rejects(complete, /could not be delivered/);
  else await complete();
  return { calls, warnings };
}

test("uploads a diagram and its links into the original thread through Eve", async (t) => {
  const { calls, warnings } = await deliver(t);
  assert.deepEqual(calls.map(c => c.method), ["files.getUploadURLExternal", "upload", "files.completeUploadExternal"]);
  const complete = calls.at(-1).body;
  assert.equal(complete.channel_id, "C_TEST");
  assert.equal(complete.thread_ts, "123.000");
  assert.ok(complete.initial_comment.includes(READY.links.diagram));
  assert.match(complete.initial_comment, /^LinkedIn qualification workflow\./);
  assert.deepEqual(warnings, []);
});

for (const failAt of ["files.getUploadURLExternal", "upload", "files.completeUploadExternal"]) {
  test(`a failure at ${failAt} still sends the image and links`, async (t) => {
    const { calls, warnings } = await deliver(t, { failAt });
    const post = calls.find(c => c.method === "chat.postMessage");
    assert.ok(post, "No fallback message was sent after Slack rejected the attachment");
    assert.equal(post.body.channel, "C_TEST");
    assert.equal(post.body.thread_ts, "123.000");
    assert.ok(post.body.text.includes(READY.links.diagram));
    assert.match(post.body.text, /^LinkedIn qualification workflow\./);
    assert.equal(calls.filter(c => c.method === "chat.postMessage").length, 1);
    const blocks = JSON.parse(post.body.blocks);
    assert.equal(blocks.find(b => b.type === "image").image_url, READY.imageUrl);
    assert.ok(blocks.find(b => b.type === "section").text.text.includes(READY.links.diagram));
    assert.equal(warnings.length, 1);
    assert.doesNotMatch(JSON.stringify(warnings), /private-signature|fake-token|example\.test/);
    assert.match(JSON.stringify(warnings), failAt === "upload" ? /403/ : /missing_scope/);
  });
}

test("falls back to plain links when Slack also rejects the image block", async (t) => {
  const { calls, warnings } = await deliver(t, { failAt: "files.getUploadURLExternal", rejectImage: true });
  const posts = calls.filter(c => c.method === "chat.postMessage");
  assert.equal(posts.length, 2);
  assert.equal(posts[1].body.blocks, undefined);
  assert.ok(posts[1].body.text.includes(READY.links.diagram));
  assert.match(posts[1].body.text, /could not be displayed/);
  assert.equal(warnings.length, 2);
});

test("reports exhausted delivery without leaking signed URLs", async (t) => {
  const { warnings } = await deliver(t, { failAt: "files.getUploadURLExternal", rejectImage: true, rejectText: true });
  assert.equal(warnings.length, 3);
  assert.match(JSON.stringify(warnings), /channel_not_found/);
  assert.doesNotMatch(JSON.stringify(warnings), /private-signature|fake-token|example\.test/);
});
