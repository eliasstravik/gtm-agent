import assert from "node:assert/strict";
import test from "node:test";
import { createSlackChannelConfig } from "../agent/channels/slack.ts";
import { createDiagramEvents, rememberDiagramLinks } from "../agent/lib/slack-diagram-message.ts";
import operateTool from "../agent/tools/operate_gtm_workflow.ts";

const links = {
  diagram: "https://workflows.example/gtm/diagram/qualify?exp=123&sig=secret",
  runs: "https://vercel.com/team/workflows/observability/workflows",
  data: "https://app.turso.tech/team/databases/leads",
};
const output = {
  action: "diagram", status: "ready", workflowPath: "qualify",
  url: links.diagram, imageUrl: "https://workflows.example/api/diagram-image/qualify?sig=secret", links,
};
const events = createDiagramEvents({
  fetch: async () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } }),
});
const resultHandler = events["action.result"];
const messageHandler = events["message.completed"];
function context(reject = () => false) {
  const posts = [];
  let attempts = 0;
  const channel = {
    state: { pendingToolCallMessage: null },
    thread: {
      post: async (value) => {
        if (reject(value, ++attempts)) throw new Error("post rejected");
        posts.push(value);
      },
      startTyping: async () => {},
    },
  };
  return { channel, posts };
}
const result = (value = output) => ({ turnId: "turn-1", result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: value } });
const completed = (message, turnId = "turn-1") => ({ message, turnId, finishReason: "stop", sequence: 2, stepIndex: 1 });

test("the image and links are delivered once even if the model repeats the screenshot's link blocks", async () => {
  for (const fallback of [false, true]) {
    const { channel, posts } = context(value => fallback && !!value.files);
    await resultHandler(result(), channel);
    assert.deepEqual(posts, [], "The diagram must wait for the caption");
    // Eve persists the channel state between action and message events.
    channel.state = JSON.parse(JSON.stringify(channel.state));
    await messageHandler(completed([
      "Qualifies LinkedIn profiles against the saved personas.", "",
      `[Open the diagram](${links.diagram})`, "",
      `Diagram: [Open the diagram](${links.diagram})`,
      `Runs: <${links.runs}|Vercel workflow observability>`,
      `Data: ${links.data}`,
    ].join("\n")), channel);
    assert.equal(posts.length, 1);
    assert.match(posts[0].text, /Diagram:.*\nRuns:.*\nData:/);
    assert.ok(fallback ? posts[0].blocks.some(block => block.type === "image") : posts[0].files.length);
    assert.match(posts[0].text, /^Qualifies LinkedIn profiles against the saved personas\.\n\nDiagram:/);
    assert.doesNotMatch(JSON.stringify(channel.state), /secret|exp=/);
  }
});

test("plain-link fallback also suppresses a links-only follow-up", async () => {
  const { channel, posts } = context(value => !!value.files || !!value.blocks);
  await resultHandler(result(), channel);
  await messageHandler(completed(`<${links.diagram}|Open the diagram>`), channel);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /The picture could not be displayed/);
});

test("failed delivery reports failure instead of silently losing the combined message", async () => {
  const { channel } = context(() => true);
  await resultHandler(result(), channel);
  await assert.rejects(messageHandler(completed("Workflow caption."), channel), /could not be delivered/);
  assert.equal(channel.state.diagramLinkDelivery, undefined);
});

test("duplicate matching ignores signature changes but preserves unrelated links and later turns", async () => {
  const { channel, posts } = context();
  rememberDiagramLinks(channel.state, "turn-1", links);
  const differentSignature = links.diagram.replace("secret", "new-signature");
  const unrelated = "https://docs.example/workflow";
  await messageHandler(completed(`Diagram: [Open](${differentSignature})\n[Documentation](${unrelated})`), channel);
  assert.deepEqual(posts, [`[Documentation](${unrelated})`]);
  await messageHandler(completed(links.diagram, "turn-2"), channel);
  assert.equal(posts[1], links.diagram);
});

test("multiple diagrams accumulate only within the current turn", async () => {
  const { channel, posts } = context();
  rememberDiagramLinks(channel.state, "turn-1", links);
  const second = { ...links, diagram: "https://workflows.example/gtm/diagram/reddit?sig=secret" };
  rememberDiagramLinks(channel.state, "turn-1", second);
  await messageHandler(completed(`${links.diagram}\n${second.diagram}`), channel);
  assert.deepEqual(posts, []);
  rememberDiagramLinks(channel.state, "turn-2", second);
  await messageHandler(completed(links.diagram, "turn-2"), channel);
  assert.deepEqual(posts, [links.diagram]);
});

test("ordinary replies and tool-call messages retain Eve's existing behavior", async () => {
  const { channel, posts } = context();
  await messageHandler({ ...completed("\nChecking the workflow.\nMore details."), finishReason: "tool-calls" }, channel);
  assert.equal(channel.state.pendingToolCallMessage, "Checking the workflow.");
  assert.deepEqual(posts, []);
  await messageHandler(completed("Workflow is live."), channel);
  assert.equal(channel.state.pendingToolCallMessage, null);
  assert.deepEqual(posts, ["Workflow is live."]);
});

test("the model sees caption instructions while channel handlers keep the original diagram URLs", async () => {
  const before = structuredClone(output);
  const projected = await operateTool.toModelOutput(output);
  assert.equal(projected.type, "json");
  assert.doesNotMatch(JSON.stringify(projected), /https:|secret/);
  assert.match(projected.value.message, /Do not repeat or reconstruct links/);
  assert.deepEqual(output, before);
  const other = { action: "deployment", status: "live", expectedHead: "a".repeat(40) };
  assert.deepEqual(await operateTool.toModelOutput(other), { type: "json", value: other });
});

test("the configured Slack channel queues diagrams and flushes when a turn has no final message", async () => {
  const configured = createSlackChannelConfig({ allowedChannelIds: [], allowedUserIds: [], connector: "slack/gtm-agent" }).events;
  assert.equal(typeof configured["turn.completed"], "function");
  const { channel, posts } = context();
  await resultHandler(result(), channel);
  await messageHandler({ ...completed("Checking."), finishReason: "tool-calls" }, channel);
  assert.equal(posts.length, 0);
  await events["turn.completed"]({ turnId: "turn-1" }, channel);
  assert.equal(posts.length, 1);
  await events["turn.completed"]({ turnId: "turn-1" }, channel);
  assert.equal(posts.length, 1);
});

test("a missing caption still produces exactly one diagram message", async () => {
  const { channel, posts } = context();
  await resultHandler(result(), channel);
  await messageHandler(completed(null), channel);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /^Diagram:/);
});

test("two diagrams use one caption and do not leak their queue into the next turn", async () => {
  const { channel, posts } = context();
  await resultHandler(result(), channel);
  await resultHandler(result({ ...output, workflowPath: "reddit", links: { ...links, diagram: "https://workflows.example/gtm/diagram/reddit" } }), channel);
  await messageHandler(completed("Both current workflows."), channel);
  assert.equal(posts.length, 2);
  assert.match(posts[0].text, /^Both current workflows/);
  assert.doesNotMatch(posts[1].text, /Both current workflows/);
  assert.equal(channel.state.pendingDiagrams, undefined);
  await messageHandler(completed("Next request.", "turn-2"), channel);
  assert.equal(posts[2], "Next request.");
});

test("a protected diagram produces one useful error message without a duplicate model reply", async () => {
  const { channel, posts } = context();
  await resultHandler(result({ action: "diagram", status: "protected", message: "The diagram is protected.", links }), channel);
  await messageHandler(completed("The diagram is protected."), channel);
  assert.deepEqual(posts, [{ text: "The diagram is protected." }]);
});
