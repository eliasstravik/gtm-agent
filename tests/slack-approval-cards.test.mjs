import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGenericInputRequestPost,
  buildGtmApprovalPost,
  chunkForSections,
  createInputRequestedHandler,
  escapeMrkdwn,
  renderBulletLines,
} from "../agent/lib/slack-approval-cards.ts";

const SUMMARY = [
  "For Acme:",
  "Revenue Leader (Acme)",
  "- role: VP Sales, owns pipeline & forecast <quarterly>",
  "Approve to save, or Cancel and tell me what to change.",
].join("\n");

function saveRequest(overrides = {}) {
  return {
    kind: "tool-approval",
    requestId: "req-1",
    prompt: "Approve apply_gtm_workspace_changes?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "cancel", label: "Cancel" },
    ],
    action: {
      kind: "tool-call",
      callId: "call-1",
      toolName: "apply_gtm_workspace_changes",
      input: {
        summary: SUMMARY,
        manifest: [{ path: "members/rae-santos/MEMBER.md", operation: "write" }],
        additions: [{ path: "members/rae-santos/MEMBER.md", content: "PRIVATE_FILE_CONTENT" }],
        deletions: [],
        migrations: [],
        destructive: false,
        expectedHead: "a".repeat(40),
        message: "Update Rae Santos",
      },
    },
    ...overrides,
  };
}

function flatten(value) {
  return JSON.stringify(value);
}

test("a GTM approval renders only the summary with Cancel and Approve", () => {
  const post = buildGtmApprovalPost(saveRequest());
  assert.notEqual(post, null);
  const [section, actions] = post.blocks;
  assert.equal(post.blocks.length, 2);
  assert.equal(section.type, "section");
  assert.equal(section.text.type, "mrkdwn");
  assert.equal(section.text.verbatim, true);
  assert.equal(section.text.text, escapeMrkdwn(renderBulletLines(SUMMARY)));
  assert.match(section.text.text, /&amp; forecast &lt;quarterly&gt;/);

  assert.equal(actions.type, "actions");
  assert.deepEqual(
    actions.elements.map((element) => [element.text.text, element.value, element.style]),
    [
      ["Cancel", "cancel", undefined],
      ["Approve", "approve", "primary"],
    ],
  );
  assert.equal(actions.elements[0].action_id, "eve_input:tool-approval:req-1:button:0");
  assert.equal(actions.elements[1].action_id, "eve_input:tool-approval:req-1:button:1");

  const rendered = flatten(post);
  assert.doesNotMatch(rendered, /PRIVATE_FILE_CONTENT/);
  assert.doesNotMatch(rendered, /MEMBER\.md/);
  assert.doesNotMatch(rendered, /manifest|expectedHead|Tool input/);
  assert.equal(post.text, SUMMARY);
});

test("contract bullet lines render as bullets in the section and stay plain in the fallback", () => {
  const summary = "For Acme:\nCreate 3 ICPs:\n- SMB Law Firms (Acme)\n- SMB Real Estate (Acme)\n- SMB Car Dealers (Acme)\nAll: Swedish businesses with 1–49 employees.\nApprove to save, or Cancel and tell me what to change.";
  const post = buildGtmApprovalPost(
    saveRequest({ action: { ...saveRequest().action, input: { summary } } }),
  );
  const [section] = post.blocks;
  assert.match(section.text.text, /\n\u2022 SMB Law Firms \(Acme\)\n\u2022 SMB Real Estate \(Acme\)\n\u2022 SMB Car Dealers \(Acme\)\n/);
  assert.doesNotMatch(section.text.text, /^- /m);
  assert.equal(post.text, summary);
  assert.equal(renderBulletLines("a\n- b\n -c\n--d"), "a\n\u2022 b\n -c\n--d");
});

test("operate_gtm_workflow approvals use the same summary-only shape", () => {
  const post = buildGtmApprovalPost(
    saveRequest({
      action: {
        kind: "tool-call",
        callId: "call-2",
        toolName: "operate_gtm_workflow",
        input: {
          action: "start",
          summary: "For Acme:\nRun Score new leads on 120 rows for about $3.\nApprove to run, or Cancel and tell me what to change.",
          expectedRows: 120,
          expectedProjectedCostUsd: 3,
          inputPath: "workflows/data/leads.json",
          workflowPath: "score-leads",
          expectedHead: "a".repeat(40),
          checkpoint: null,
        },
      },
    }),
  );
  assert.equal(post.blocks.length, 2);
  assert.doesNotMatch(flatten(post), /leads\.json|expectedRows|score-leads/);
});

test("a long summary is split across sections at line boundaries", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `${index}: ${"y".repeat(80)}`);
  const summary = `${lines.join("\n")}\nApprove to save, or Cancel and tell me what to change.`;
  assert.ok(summary.length > 3000);
  const post = buildGtmApprovalPost(
    saveRequest({ action: { ...saveRequest().action, input: { summary } } }),
  );
  const sections = post.blocks.filter((block) => block.type === "section");
  assert.ok(sections.length >= 2);
  for (const section of sections) {
    assert.ok(section.text.text.length <= 3000);
    assert.doesNotMatch(section.text.text, /^\n|\n$/);
  }
  assert.equal(sections.map((section) => section.text.text).join("\n"), summary);
  assert.equal(post.blocks.at(-1).type, "actions");
});

test("chunkForSections keeps whole lines and hard-splits only an oversized line", () => {
  assert.deepEqual(chunkForSections("a\nb\nc", 3), ["a\nb", "c"]);
  assert.deepEqual(chunkForSections("abcdefgh", 3), ["abc", "def", "gh"]);
  assert.deepEqual(chunkForSections("", 3), []);
});

test("requests without a summary, without approve and cancel, or for other tools fall back", () => {
  const base = saveRequest();
  assert.equal(
    buildGtmApprovalPost({ ...base, action: { ...base.action, input: { manifest: [] } } }),
    null,
  );
  assert.equal(
    buildGtmApprovalPost({ ...base, action: { ...base.action, input: { summary: "   " } } }),
    null,
  );
  assert.equal(
    buildGtmApprovalPost({ ...base, options: [{ id: "approve", label: "Approve" }] }),
    null,
  );
  assert.equal(
    buildGtmApprovalPost({ ...base, action: { ...base.action, toolName: "publish_source_proposal" } }),
    null,
  );
  assert.equal(buildGtmApprovalPost({ ...base, kind: "question" }), null);
});

test("the generic rendering keeps the prompt, a collapsed tool input, and the request's options", () => {
  const post = buildGenericInputRequestPost(
    saveRequest({
      action: {
        kind: "tool-call",
        callId: "call-3",
        toolName: "publish_source_proposal",
        input: { hash: "abc123" },
      },
    }),
  );
  assert.equal(post.blocks[0].text.text, "Approve apply_gtm_workspace_changes?");
  const container = post.blocks[1];
  assert.equal(container.type, "container");
  assert.equal(container.default_collapsed, true);
  assert.match(flatten(container), /abc123/);
  const actions = post.blocks[2];
  assert.deepEqual(
    actions.elements.map((element) => element.action_id),
    ["eve_input:tool-approval:req-1:button:0", "eve_input:tool-approval:req-1:button:1"],
  );

  const question = buildGenericInputRequestPost({
    kind: "question",
    requestId: "q-1",
    prompt: "Which one?",
    options: [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
    ],
    display: "select",
    action: { kind: "tool-call", callId: "c", toolName: "ask_question", input: {} },
  });
  assert.equal(question.blocks.length, 2);
  assert.equal(question.blocks[1].elements[0].type, "radio_buttons");
  assert.equal(question.blocks[1].elements[0].action_id, "eve_input:q-1");

  const freeform = buildGenericInputRequestPost({
    kind: "question",
    requestId: "q-2",
    prompt: "Say more",
    action: { kind: "tool-call", callId: "c", toolName: "ask_question", input: {} },
  });
  assert.equal(freeform.blocks[1].elements[0].action_id, "eve_input_freeform:q-2");
});

test("the handler posts one message per request and records approval cards for settlement", async () => {
  const posts = [];
  const channel = {
    state: { pendingApprovalCards: { "req-0": { messageBlocks: [], messageTs: "1.0" } } },
    thread: {
      async post(message) {
        posts.push(message);
        return { id: `ts-${posts.length}`, raw: {} };
      },
    },
  };
  const handler = createInputRequestedHandler();
  await handler(
    {
      requests: [
        saveRequest(),
        {
          kind: "question",
          requestId: "q-1",
          prompt: "Which one?",
          options: [{ id: "a", label: "A" }],
          action: { kind: "tool-call", callId: "c", toolName: "ask_question", input: {} },
        },
      ],
      sequence: 1,
      stepIndex: 0,
      turnId: "turn",
    },
    channel,
    {},
  );

  assert.equal(posts.length, 2);
  assert.equal(posts[0].text, SUMMARY);
  assert.doesNotMatch(flatten(posts[0]), /PRIVATE_FILE_CONTENT/);
  assert.deepEqual(Object.keys(channel.state.pendingApprovalCards), ["req-0", "req-1"]);
  assert.equal(channel.state.pendingApprovalCards["req-1"].messageTs, "ts-1");
  assert.equal(channel.state.pendingApprovalCards["req-1"].messageBlocks, posts[0].blocks);
});
