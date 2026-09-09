import assert from "node:assert/strict";
import test from "node:test";

import { createDiagramResultHandler } from "../agent/lib/slack-diagram-post.ts";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const READY = {
  action: "diagram",
  status: "ready",
  workflowPath: "nested/account-scoring",
  runKey: null,
  url: "https://acme-workflows.vercel.app/gtm/diagram/nested/account-scoring?exp=1&sig=s",
  imageUrl: "https://acme-workflows.vercel.app/api/diagram-image/nested/account-scoring?exp=1&sig=s",
  expiresAt: "2027-01-15T08:00:00.000Z",
  links: { diagram: "https://d/1", runs: "https://r/2", data: "https://t/3" },
};

function channelSpy() {
  const posts = [];
  return { posts, channel: { thread: { async post(input) { posts.push(input); return { id: "1", raw: {} }; } } } };
}

test("uploads the PNG with the where-to-look block for a ready diagram", async () => {
  const fetched = [];
  const handler = createDiagramResultHandler({
    fetch: async (url, init) => {
      fetched.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, READY.imageUrl);
  assert.equal(fetched[0].headers.authorization, undefined);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "Diagram: <https://d/1|Open the diagram>\nRuns (needs Vercel access): <https://r/2|Open the runs>\nData: <https://t/3|Open the data>");
  assert.equal(posts[0].files.length, 1);
  assert.equal(posts[0].files[0].filename, "account-scoring.png");
  assert.deepEqual([...posts[0].files[0].data], [...PNG]);
});

test("posts the protected message without a file", async () => {
  const handler = createDiagramResultHandler({ fetch: async () => { throw new Error("must not fetch"); } });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: { ...READY, status: "protected", message: "The diagram link is blocked by deployment protection." } } }, channel);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "The diagram link is blocked by deployment protection.");
  assert.equal(posts[0].files, undefined);
});

test("ignores other tools, other actions, failed downloads, and oversized images", async () => {
  const { posts, channel } = channelSpy();
  const handler = createDiagramResultHandler({ fetch: async () => new Response("nope", { status: 500 }) });
  await handler({ result: { kind: "tool-result", toolName: "apply_gtm_workspace_changes", output: READY } }, channel);
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: { action: "status", status: "running" } } }, channel);
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  const big = createDiagramResultHandler({
    fetch: async () => new Response(new Uint8Array(5 * 1024 * 1024), { status: 200, headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) } }),
  });
  await big({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  // The other tool and the other action post nothing. A failed download and an
  // oversized image each fall back to the block plus a plain explanation, and
  // neither uploads a file.
  assert.equal(posts.length, 2);
  for (const post of posts) {
    assert.match(post.text, /could not be downloaded/);
    assert.match(post.text, /^Diagram: <https:\/\/d\/1\|Open the diagram>/);
    assert.equal(post.files, undefined);
  }
});
