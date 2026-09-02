import assert from "node:assert/strict";
import test from "node:test";

import { createSlackChannelConfig } from "../agent/channels/slack.ts";

const ALLOWED_CHANNEL = "C012345678";
const ALLOWED_USER = "U012345678";

function createPolicy() {
  return createSlackChannelConfig({
    allowedChannelIds: [ALLOWED_CHANNEL],
    allowedUserIds: [ALLOWED_USER],
    connector: "slack/gtm-agent",
  });
}

function message({
  channelId = ALLOWED_CHANNEL,
  isBot = false,
  threadTs = "1700000000.000001",
  userId = ALLOWED_USER,
} = {}) {
  return {
    attachments: [],
    author: {
      fullName: undefined,
      isBot,
      isMe: false,
      userId,
      userName: undefined,
    },
    channelId,
    markdown: `<@U999999999> run this`,
    raw: {},
    teamId: "T012345678",
    text: `<@U999999999> run this`,
    threadTs,
    ts: "1700000000.000002",
  };
}

function messageContext(channelId = ALLOWED_CHANNEL) {
  return {
    slack: {
      channelId,
      teamId: "T012345678",
      threadTs: "1700000000.000001",
    },
  };
}

test("Slack policy accepts allowlisted human app mentions, including thread mentions", () => {
  const policy = createPolicy();

  for (const threadTs of ["1700000000.000002", "1700000000.000001"]) {
    const result = policy.onAppMention(
      messageContext(),
      message({ threadTs }),
    );
    assert.equal(result.auth.authenticator, "slack-webhook");
    assert.match(result.auth.principalId, new RegExp(`${ALLOWED_USER}$`));
  }
});

test("Slack policy rejects denied users, denied channels, bots, and missing authors", () => {
  const policy = createPolicy();

  assert.equal(
    policy.onAppMention(messageContext(), message({ userId: "U087654321" })),
    null,
  );
  assert.equal(
    policy.onAppMention(
      messageContext("C087654321"),
      message({ channelId: "C087654321" }),
    ),
    null,
  );
  assert.equal(
    policy.onAppMention(messageContext(), message({ isBot: true })),
    null,
  );
  assert.equal(
    policy.onAppMention(messageContext(), { ...message(), author: undefined }),
    null,
  );
});

test("an empty development allowlist admits nobody", () => {
  const policy = createSlackChannelConfig({
    allowedChannelIds: [],
    allowedUserIds: [],
    connector: "slack/gtm-agent",
  });

  assert.equal(policy.onAppMention(messageContext(), message()), null);
  assert.equal(
    policy.onInputResponse(
      {
        ...messageContext(),
        defaultAuth: {
          authenticator: "slack-webhook",
          principalId: ALLOWED_USER,
        },
      },
      {
        actions: [],
        inputResponses: [],
        type: "block_actions",
        user: { id: ALLOWED_USER },
      },
    ),
    null,
  );
});

test("Slack policy disables DMs and leaves ordinary messages and custom interactions off", () => {
  const policy = createPolicy();

  assert.equal(policy.onDirectMessage(messageContext(), message()), null);
  assert.equal(policy.onMessage, undefined);
  assert.equal(policy.onEvent, undefined);
  assert.equal(policy.onInteraction, undefined);
});

test("Slack policy admits HITL submissions only from an allowlisted user and channel", () => {
  const policy = createPolicy();
  const defaultAuth = { authenticator: "slack-webhook", principalId: ALLOWED_USER };
  const submission = {
    actions: [],
    inputResponses: [],
    type: "block_actions",
    user: { id: ALLOWED_USER },
  };

  assert.deepEqual(
    policy.onInputResponse(
      { ...messageContext(), defaultAuth },
      submission,
    ),
    { auth: defaultAuth },
  );
  assert.equal(
    policy.onInputResponse(
      { ...messageContext(), defaultAuth },
      { ...submission, user: { id: "U087654321" } },
    ),
    null,
  );
  assert.equal(
    policy.onInputResponse(
      { ...messageContext("C087654321"), defaultAuth },
      submission,
    ),
    null,
  );
});

test("Slack policy loads only thread messages since the last agent reply", () => {
  assert.deepEqual(createPolicy().threadContext, {
    since: "last-agent-reply",
  });
});
