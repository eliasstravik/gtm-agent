import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_ERROR,
  SLACK_CONFIGURATION_ERROR,
  parseConfiguration,
  parseWorkspaceRepository,
} from "../agent/lib/config.ts";

test("Slack-only mode is valid without GitHub configuration", () => {
  assert.deepEqual(parseConfiguration({ SLACK_CONNECTOR: "slack/gtm-agent" }), {
    slackConnector: "slack/gtm-agent",
    workspace: null,
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
      GTM_WORKSPACE_REPOSITORY: "acme-inc/gtm-workspace",
    }),
    {
      slackConnector: "slack/gtm-agent",
      workspace: {
        branch: "main",
        checkoutDirectory: "$HOME/.gtm/gtm-workspace",
        connector: "github/gtm-agent",
        owner: "acme-inc",
        repo: "gtm-workspace",
        repository: "acme-inc/gtm-workspace",
        staleMarker: "$HOME/.gtm/.gtm-workspace.stale",
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
        GTM_WORKSPACE_REPOSITORY: "acme-inc/gtm-workspace",
      }),
    /set both GITHUB_CONNECTOR and GTM_WORKSPACE_REPOSITORY/i,
  );
});

test("repository parser accepts one strict owner/repo", () => {
  assert.deepEqual(parseWorkspaceRepository("Acme-1/gtm.workspace_2"), {
    owner: "Acme-1",
    repo: "gtm.workspace_2",
    repository: "Acme-1/gtm.workspace_2",
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
    "acme repo/workspace",
    "",
  ]) {
    assert.throws(() => parseWorkspaceRepository(value), /owner\/repo/);
  }
});

test("the retired context variable does not configure a workspace", () => {
  assert.throws(
    () =>
      parseConfiguration({
        SLACK_CONNECTOR: "slack/gtm-agent",
        GITHUB_CONNECTOR: "github/gtm-agent",
        GTM_CONTEXT_REPOSITORY: "acme-inc/legacy-context",
      }),
    /GTM_WORKSPACE_REPOSITORY/,
  );
});
