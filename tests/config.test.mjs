import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_ERROR,
  SLACK_CONFIGURATION_ERROR,
  parseConfiguration,
  parseContextRepository,
} from "../agent/lib/config.ts";

test("Slack-only mode is valid without GitHub configuration", () => {
  assert.deepEqual(parseConfiguration({ SLACK_CONNECTOR: "slack/gtm-agent" }), {
    slackConnector: "slack/gtm-agent",
    context: null,
  });
});

test("Slack connector is required for the production ingress", () => {
  assert.throws(
    () => parseConfiguration({ NODE_ENV: "production" }),
    new RegExp(SLACK_CONFIGURATION_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.equal(parseConfiguration({}).slackConnector, "slack/my-agent");
});

test("connected mode derives immutable repository metadata", () => {
  assert.deepEqual(
    parseConfiguration({
      SLACK_CONNECTOR: "slack/gtm-agent",
      GITHUB_CONNECTOR: "github/gtm-agent",
      GTM_CONTEXT_REPOSITORY: "acme-inc/gtm-context",
    }),
    {
      slackConnector: "slack/gtm-agent",
      context: {
        branch: "main",
        checkoutDirectory: "$HOME/.gtm/gtm-context",
        connector: "github/gtm-agent",
        owner: "acme-inc",
        repo: "gtm-context",
        repository: "acme-inc/gtm-context",
        staleMarker: "$HOME/.gtm/.gtm-context.stale",
      },
    },
  );
});

test("partial GitHub configuration fails with one remediation", () => {
  assert.throws(
    () =>
      parseConfiguration({
        SLACK_CONNECTOR: "slack/gtm-agent",
        GITHUB_CONNECTOR: "github/gtm-agent",
      }),
    new RegExp(CONFIGURATION_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.throws(
    () =>
      parseConfiguration({
        SLACK_CONNECTOR: "slack/gtm-agent",
        GTM_CONTEXT_REPOSITORY: "acme-inc/gtm-context",
      }),
    /set both GITHUB_CONNECTOR and GTM_CONTEXT_REPOSITORY/i,
  );
});

test("repository parser accepts one strict owner/repo", () => {
  assert.deepEqual(parseContextRepository("Acme-1/gtm.context_2"), {
    owner: "Acme-1",
    repo: "gtm.context_2",
    repository: "Acme-1/gtm.context_2",
  });
});

test("repository parser rejects ambiguous or unsafe forms", () => {
  for (const value of [
    "https://github.com/acme/repo",
    "acme/repo.git",
    " acme/repo",
    "acme/repo ",
    "acme/repo/extra",
    "acme/../repo",
    "acme/repo?ref=main",
    "acme/repo#main",
    "acme repo/context",
    "",
  ]) {
    assert.throws(() => parseContextRepository(value), /owner\/repo/);
  }
});
