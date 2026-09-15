import { test } from "node:test";
import assert from "node:assert/strict";
import { SlackOperations, slackIdentity, destination, boundedBytes, slackFileUrl, FILE_LIMIT } from "../agent/lib/slack-operations.ts";
const identity = { channelId: "C123", threadTs: "1.001", userId: "U123", teamId: "T123" };
const publicChannel = { ok: true, channel: { id: "C123", is_private: false, is_member: true } };

test("here stays threaded, other channels and DMs start top-level, empty timestamp is explicit", () => {
  assert.deepEqual(destination({}, identity), { channelId: "C123", threadTs: "1.001" });
  assert.equal(destination({ channelId: "C456" }, identity).threadTs, "");
  assert.equal(destination({ userId: "U456" }, identity).threadTs, "");
  assert.equal(destination({ threadTs: "" }, identity).threadTs, "");
  assert.throws(() => destination({ channelId: "C456", userId: "U456" }, identity));
  assert.throws(() => slackIdentity({ authenticator: "web", attributes: { channel_id: "C123" } }));
});
test("private history requires the requesting user, not just the bot, with membership pagination", async () => {
  let page = 0; const calls: string[] = [];
  const service = new SlackOperations(identity, async (method) => {
    calls.push(method);
    if (method === "conversations.info") return { ok: true, channel: { is_private: true } };
    if (method === "conversations.members") return ++page === 1 ? { ok: true, members: ["UBOT"], response_metadata: { next_cursor: "next" } } : { ok: true, members: ["U123"] };
    return { ok: true, messages: [{ ts: "1", text: "hello", files: [{ id: "F1", url_private: "secret-url" }] }], response_metadata: { next_cursor: "older" } };
  });
  const result = await service.history({});
  assert.equal(page, 2); assert.equal(result.nextCursor, "older");
  assert.equal(JSON.stringify(result).includes("secret-url"), false);
  assert.ok(calls.includes("conversations.replies"));
  const denied = new SlackOperations(identity, async m => m === "conversations.info" ? { ok: true, channel: { is_im: true } } : { ok: true, members: ["UOTHER"] });
  await assert.rejects(denied.history({}), /not a member/);
});
test("channel listing filters inaccessible private conversations and keeps next cursor", async () => {
  const service = new SlackOperations(identity, async m => {
    if (m === "conversations.list") return { ok: true, channels: [{ id: "C123", name: "sales" }, { id: "G123", name: "sales-private", is_private: true }], response_metadata: { next_cursor: "next" } };
    if (m === "conversations.info") return { ok: true, channel: { is_private: true } };
    return { ok: true, members: ["OTHER"] };
  });
  const result = await service.find({ query: "#sales" });
  assert.deepEqual(result.conversations.map(c => c.id), ["C123"]); assert.equal(result.nextCursor, "next");
});
test("DM sends use resolved DM and stable message IDs; errors never report success", async () => {
  const posts: any[] = [];
  const service = new SlackOperations(identity, async (m, body) => {
    if (m === "conversations.open") return { ok: true, channel: { id: "D456" } };
    posts.push(body); return { ok: true, ts: "2.001" };
  });
  assert.equal((await service.send({ userId: "U456", text: "hello" }, "turn1")).channelId, "D456");
  await service.send({ userId: "U456", text: "hello" }, "turn1");
  assert.equal(posts[0].thread_ts, undefined); assert.equal(posts[0].client_msg_id, posts[1].client_msg_id);
  const refused = new SlackOperations(identity, async () => ({ ok: false, error: "missing_scope" }));
  await assert.rejects(refused.send({ text: "hello" }, "turn1"), /Reapprove/);
});
test("binary upload completes only after bytes reach Slack, in the intended thread", async () => {
  const calls: any[] = []; const bytes = Uint8Array.from([0, 255, 42]);
  const service = new SlackOperations(identity, async (m, b) => {
    calls.push([m, b]);
    if (m === "conversations.info") return publicChannel;
    if (m === "files.getUploadURLExternal") return { ok: true, upload_url: "https://files.slack.com/upload/v1/x", file_id: "F123" };
    return { ok: true };
  }, async (_url, options) => {
    assert.deepEqual(new Uint8Array(await (options!.body as Blob).arrayBuffer()), bytes);
    assert.equal(options!.redirect, "error"); return new Response("ok");
  });
  const sandbox = { readBinaryFile: async () => bytes, writeBinaryFile: async () => {} };
  const result = await service.upload({ path: "/workspace/report.pdf" }, sandbox);
  assert.equal(result.sent, true); assert.equal(result.fileId, "F123");
  assert.equal(calls.at(-1)[1].thread_ts, "1.001"); assert.equal(calls.at(-1)[1].channel_id, "C123");
  const broken = new SlackOperations(identity, service.call, async () => new Response("failed", { status: 500 }));
  const before = calls.filter(([m]) => m === "files.completeUploadExternal").length;
  await assert.rejects(broken.upload({ path: "report.pdf" }, sandbox), /upload failed/);
  assert.equal(calls.filter(([m]) => m === "files.completeUploadExternal").length, before);
});
test("file reads require a shared conversation, preserve bytes and hide credentials", async () => {
  let stored: any; let downloaded = false;
  const service = new SlackOperations(identity, async m => m === "conversations.info" ? publicChannel : { ok: true, file: { name: "../report.csv", channels: ["C123"], url_private: "https://files.slack.com/files-pri/x", size: 3 } }, async (_url, options) => {
    downloaded = true; assert.equal((options!.headers as any).authorization, "Bearer hidden"); return new Response("a,b");
  });
  const sandbox = { readBinaryFile: async () => null, writeBinaryFile: async (input: any) => { stored = input; } };
  const result = await service.download({ fileId: "F123" }, sandbox, async () => "hidden");
  assert.equal(result.path, "/workspace/attachments/F123-report.csv"); assert.equal(new TextDecoder().decode(stored.content), "a,b");
  assert.equal(JSON.stringify(result).includes("hidden"), false);
  downloaded = false;
  const denied = new SlackOperations(identity, async m => m === "conversations.info" ? publicChannel : { ok: true, file: { channels: ["COTHER"] } }, service.transfer);
  await assert.rejects(denied.download({ fileId: "F123" }, sandbox, async () => "hidden"), /not shared/); assert.equal(downloaded, false);
});
test("file transfers reject credential leaks, redirects and oversized streams", async () => {
  assert.throws(() => slackFileUrl("https://slack.com.attacker.example/file"));
  assert.throws(() => slackFileUrl("http://files.slack.com/file"));
  await assert.rejects(boundedBytes(new Response("", { status: 302 })), /transfer failed/);
  await assert.rejects(boundedBytes(new Response(new Uint8Array(FILE_LIMIT + 1))), /25 MB/);
});

test("group DM mentions and file shares start turns, ordinary chatter and bots do not", async () => {
  const { isAddressedGroupDM } = await import("../agent/lib/slack-routing.ts");
  assert.equal(isAddressedGroupDM({ channel_type: "mpim" }, true), true);
  assert.equal(isAddressedGroupDM({ channel_type: "mpim", subtype: "file_share" }, true), true);
  assert.equal(isAddressedGroupDM({ channel_type: "mpim" }, false), false);
  assert.equal(isAddressedGroupDM({ channel_type: "mpim", bot_id: "B123" }, true), false);
  assert.equal(isAddressedGroupDM({ channel_type: "im" }, true), false);
});
test("long response upload failure produces a bounded visible answer", async () => {
  const { postPlainReply } = await import("../agent/lib/slack-delivery.ts");
  const posts: string[] = []; let uploads = 0;
  const channel = { thread: { post: async (text: string) => posts.push(text) }, slack: { threadTs: "1.001", uploadFiles: async () => { uploads++; throw new Error("failed"); } } };
  await postPlainReply(channel as any, "a".repeat(13000));
  assert.equal(uploads, 1); assert.equal(posts.length, 1); assert.match(posts[0], /couldn't attach/); assert.ok(posts[0].length <= 12000);
});
