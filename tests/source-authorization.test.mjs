import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedSourceCaller,
  slackUserIdFromSourceAuth,
} from "../agent/lib/source-authorization.ts";

const source = {
  allowedSlackUserIds: ["U012345678"],
};

function slackAuth(userId = "U012345678") {
  return {
    attributes: { user_id: userId },
    authenticator: "slack-webhook",
    principalId: userId,
    principalType: "user",
  };
}

test("source authorization accepts an explicitly allowlisted Slack user", () => {
  assert.equal(slackUserIdFromSourceAuth(slackAuth()), "U012345678");
  assert.equal(isAllowedSourceCaller(source, slackAuth()), true);
});

test("source authorization rejects other users and non-Slack principals", () => {
  assert.equal(isAllowedSourceCaller(source, slackAuth("U987654321")), false);
  assert.equal(
    isAllowedSourceCaller(source, {
      ...slackAuth(),
      authenticator: "vercel-oidc",
    }),
    false,
  );
  assert.equal(
    isAllowedSourceCaller(source, {
      ...slackAuth(),
      principalType: "app",
    }),
    false,
  );
  assert.equal(isAllowedSourceCaller(source, null), false);
});

test("source authorization trusts the authenticated Slack attribute, not principalId", () => {
  assert.equal(
    isAllowedSourceCaller(source, {
      ...slackAuth(),
      attributes: { user_id: "not-a-slack-id" },
      principalId: "U012345678",
    }),
    false,
  );
});
