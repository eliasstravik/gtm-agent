import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_ERROR,
  SLACK_CONFIGURATION_ERROR,
  WORKFLOW_CONFIGURATION_ERROR,
  WORKFLOW_CONTROL_CONFIGURATION_ERROR,
  parseConfiguration,
  parseWorkspaceRepository,
} from "../agent/lib/config.ts";

test("Slack-only mode is valid without GitHub configuration", () => {
  assert.deepEqual(parseConfiguration({ SLACK_CONNECTOR: "slack/gtm-agent" }), {
    slackConnector: "slack/gtm-agent",
    workflow: null,
    workflowControl: null,
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
      workflow: null,
      workflowControl: null,
      workspace: {
      branch: "main",
      checkoutDirectory: "$HOME/.gtm/gtm-workspace",
      commitAuthor: null,
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

const CONNECTED = {
  SLACK_CONNECTOR: "slack/gtm-agent",
  GITHUB_CONNECTOR: "github/gtm-agent",
  GTM_WORKSPACE_REPOSITORY: "acme-inc/gtm-workspace",
};

test("workflow hosting derives brokered Turso, Gateway, and provider metadata", () => {
  assert.deepEqual(
    parseConfiguration({
      ...CONNECTED,
      TURSO_DATABASE_URL: "libsql://acme-gtm-workspace-acme.turso.io",
      TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
      TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
      GTM_WORKFLOW_GATEWAY_API_KEY: "gateway-secret",
      GTM_WORKFLOW_PROVIDER_HOSTS: " api.example-data.com,enrich.example.net ",
    }).workflow,
    {
      databaseHost: "acme-gtm-workspace-acme.turso.io",
      databaseUrl: "https://acme-gtm-workspace-acme.turso.io",
      databaseAuthToken: "turso-secret",
      databaseReadOnlyAuthToken: "turso-read-only",
      providerHosts: ["api.example-data.com", "enrich.example.net"],
    },
  );
});

test("the read-only Turso token is required and must differ from the write token", () => {
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "turso-secret",
      }),
    /TURSO_READ_ONLY_AUTH_TOKEN/,
  );
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "same-token",
        TURSO_READ_ONLY_AUTH_TOKEN: "same-token",
      }),
    /must differ/i,
  );
});

const CONTROL = {
  GTM_WORKFLOW_VERCEL_URL: "https://acme-workflows.vercel.app",
  GTM_WORKFLOW_RUN_SECRET: "run-secret",
};
const COMMIT_AUTHOR = {
  GTM_WORKSPACE_COMMIT_AUTHOR_NAME: "Acme Deploys",
  GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL: "123456+acme@users.noreply.github.com",
};

test("workflow control fixes the production authority in host configuration", () => {
  const parsed = parseConfiguration({
    ...CONNECTED,
    TURSO_DATABASE_URL: "libsql://acme.turso.io",
    TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
    ...COMMIT_AUTHOR,
    ...CONTROL,
  });
  assert.deepEqual(parsed.workflowControl, {
    productionUrl: "https://acme-workflows.vercel.app",
    runSecret: "run-secret",
  });
});

test("workflow control is all-or-nothing and requires the hosted connected workspace", () => {
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        GTM_WORKFLOW_VERCEL_URL: "https://acme-workflows.vercel.app",
      }),
    new RegExp(
      WORKFLOW_CONTROL_CONFIGURATION_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    ),
  );
  assert.throws(
    () =>
      parseConfiguration({
        SLACK_CONNECTOR: "slack/gtm-agent",
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        ...COMMIT_AUTHOR,
        ...CONTROL,
      }),
    /workspace/i,
  );
  assert.throws(
    () => parseConfiguration({ ...CONNECTED, ...COMMIT_AUTHOR, ...CONTROL }),
    /hosted Turso/i,
  );
});

test("workflow control requires an attributed Git commit author", () => {
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        ...CONTROL,
      }),
    /commit author/i,
  );
});

test("workspace commit author is paired and validated", () => {
  assert.deepEqual(
    parseConfiguration({ ...CONNECTED, ...COMMIT_AUTHOR }).workspace.commitAuthor,
    {
      name: "Acme Deploys",
      email: "123456+acme@users.noreply.github.com",
    },
  );
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        GTM_WORKSPACE_COMMIT_AUTHOR_NAME: "Acme Deploys",
      }),
    /commit author configuration is incomplete/i,
  );
  assert.throws(
    () =>
      parseConfiguration({
        ...CONNECTED,
        GTM_WORKSPACE_COMMIT_AUTHOR_NAME: "Acme Deploys",
        GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL: "not-an-email",
      }),
    /valid email/i,
  );
});

test("workflow control rejects ambiguous production URLs", () => {
  const hosted = {
    ...CONNECTED,
    TURSO_DATABASE_URL: "libsql://acme.turso.io",
    TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
    ...COMMIT_AUTHOR,
    ...CONTROL,
  };
  for (const [name, value] of [
    ["GTM_WORKFLOW_VERCEL_URL", "http://acme.vercel.app"],
    ["GTM_WORKFLOW_VERCEL_URL", "https://acme.vercel.app/path"],
  ]) {
    assert.throws(() => parseConfiguration({ ...hosted, [name]: value }), /GTM_WORKFLOW/);
  }
});

test("workflow hosting accepts an https Turso URL and leaves providers optional", () => {
  assert.deepEqual(
    parseConfiguration({
      ...CONNECTED,
      TURSO_DATABASE_URL: "https://acme.turso.io",
      TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
    }).workflow,
    {
      databaseHost: "acme.turso.io",
      databaseUrl: "https://acme.turso.io",
      databaseAuthToken: "turso-secret",
      databaseReadOnlyAuthToken: "turso-read-only",
      providerHosts: [],
    },
  );
});

test("the Turso URL and both tokens must be configured together", () => {
  assert.throws(
    () => parseConfiguration({ ...CONNECTED, TURSO_DATABASE_URL: "libsql://acme.turso.io" }),
    new RegExp(WORKFLOW_CONFIGURATION_ERROR.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  );
  assert.throws(
    () => parseConfiguration({ ...CONNECTED, TURSO_AUTH_TOKEN: "turso-secret" }),
    /TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and TURSO_READ_ONLY_AUTH_TOKEN/,
  );
});

test("workflow hosting requires the connected workspace repository", () => {
  assert.throws(
    () =>
      parseConfiguration({
        SLACK_CONNECTOR: "slack/gtm-agent",
        TURSO_DATABASE_URL: "libsql://acme.turso.io",
        TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
      }),
    /workspace/i,
  );
});

test("workflow-only variables never configure a workflow without the database pair", () => {
  assert.equal(
    parseConfiguration({
      ...CONNECTED,
      GTM_WORKFLOW_GATEWAY_API_KEY: "gateway-secret",
      GTM_WORKFLOW_PROVIDER_HOSTS: "api.example-data.com",
    }).workflow,
    null,
  );
});

test("workflow hosting rejects file, non-HTTPS, and path-bearing database URLs", () => {
  for (const url of [
    "file:./data/gtm.db",
    "http://acme.turso.io",
    "libsql://acme.turso.io/db",
    "libsql://acme.turso.io?authToken=x",
    "libsql://user:pw@acme.turso.io",
    "libsql://acme.turso.io:8080",
    "acme.turso.io",
    "",
  ]) {
    assert.throws(
      () =>
        parseConfiguration({
          ...CONNECTED,
          TURSO_DATABASE_URL: url,
          TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        }),
      /TURSO_DATABASE_URL/,
      url,
    );
  }
});

test("provider hosts are exact lowercase hostnames outside the trusted host set", () => {
  for (const hosts of [
    "*.example.com",
    "https://api.example.com",
    "api.example.com/v1",
    "API.example.com",
    "localhost",
    "api.vercel.com",
    "github.com",
    "api.github.com",
    "registry.npmjs.org",
    "ai-gateway.vercel.sh",
    "acme.turso.io",
    "api.example.com,,other.example.com",
  ]) {
    assert.throws(
      () =>
        parseConfiguration({
          ...CONNECTED,
          TURSO_DATABASE_URL: "libsql://acme.turso.io",
          TURSO_AUTH_TOKEN: "turso-secret",
    TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
        TURSO_READ_ONLY_AUTH_TOKEN: "turso-read-only",
          GTM_WORKFLOW_PROVIDER_HOSTS: hosts,
        }),
      /GTM_WORKFLOW_PROVIDER_HOSTS/,
      hosts,
    );
  }
});
