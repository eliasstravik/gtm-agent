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
      fetched.push({ url: String(url), headers: init?.headers });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, READY.imageUrl);
  // No headers object at all, so no credential can ride along.
  assert.equal(fetched[0].headers, undefined);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "Diagram: <https://d/1|Open the diagram>\nRuns (needs Vercel access): <https://r/2|Open the runs>\nData: <https://t/3|Open the data>");
  assert.equal(posts[0].files.length, 1);
  assert.equal(posts[0].files[0].filename, "account-scoring.png");
  assert.deepEqual([...posts[0].files[0].data], [...PNG]);
});

test("stops reading a chunked body that has no declared length once it passes the cap", async () => {
  const CHUNK = 64 * 1024;
  const TOTAL_CHUNKS = (5 * 1024 * 1024) / CHUNK;
  let served = 0;
  let cancelled = false;
  const handler = createDiagramResultHandler({
    fetch: async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            if (served === TOTAL_CHUNKS) {
              controller.close();
              return;
            }
            served += 1;
            controller.enqueue(new Uint8Array(CHUNK));
          },
          cancel() {
            cancelled = true;
          },
        }),
        // A chunked response declares no content-length, so only the running
        // byte count can stop it.
        { status: 200, headers: { "content-type": "image/png" } },
      ),
  });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(cancelled, true);
  // The reader stops just past the 4 MB cap instead of draining all 80 chunks.
  assert.ok(served < TOTAL_CHUNKS, `served ${served} of ${TOTAL_CHUNKS} chunks`);
  assert.ok(served * CHUNK < 4.5 * 1024 * 1024, `materialised ${served * CHUNK} bytes`);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /could not be downloaded/);
  assert.equal(posts[0].files, undefined);
});

test("refuses a 200 that is not a PNG", async () => {
  const handler = createDiagramResultHandler({
    fetch: async () =>
      new Response("<html>sign in</html>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } }),
  });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /could not be downloaded/);
  assert.equal(posts[0].files, undefined);
});

test("a failing Slack post is logged, not thrown", async () => {
  const warnings = [];
  const warn = console.warn;
  console.warn = (message) => warnings.push(message);
  try {
    const handler = createDiagramResultHandler({
      fetch: async () => new Response(PNG, { status: 200, headers: { "content-type": "image/png" } }),
    });
    const channel = { thread: { async post() { throw new Error("channel_not_found"); } } };
    await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
    await handler(
      { result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: { ...READY, status: "protected", message: "blocked" } } },
      channel,
    );
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, [
    "The workflow diagram could not be posted to the Slack thread.",
    "The workflow diagram could not be posted to the Slack thread.",
  ]);
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
