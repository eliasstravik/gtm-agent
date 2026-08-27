import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_GATEWAY_HOST,
  NPM_REGISTRY_HOST,
  createSessionNetworkPolicy,
  createWorkflowSessionEnvironment,
  createWorkflowWritePolicy,
} from "../agent/lib/workflow-session.ts";

const workflow = {
  databaseHost: "acme.turso.io",
  databaseUrl: "https://acme.turso.io",
  databaseAuthToken: "turso-write-secret",
  databaseReadOnlyAuthToken: "turso-read-only",
  providerHosts: ["api.example-data.com"],
};

test("every session declares the sandbox workflow runtime and nothing else", () => {
  assert.deepEqual(createWorkflowSessionEnvironment(null), {
    GTM_SANDBOX: "1",
    GTM_AGENT_BACKEND: "api",
  });
});

test("a configured workflow host delivers only the database URL, never a secret or Gateway key", () => {
  const environment = createWorkflowSessionEnvironment(workflow);
  assert.deepEqual(environment, {
    GTM_SANDBOX: "1",
    GTM_AGENT_BACKEND: "api",
    TURSO_DATABASE_URL: "https://acme.turso.io",
  });
  assert.equal(
    Object.values(environment).some((value) => value.includes("secret")),
    false,
  );
  assert.equal("AI_GATEWAY_API_KEY" in environment, false);
});

test("no workflow host keeps the session at deny-all", () => {
  assert.equal(createSessionNetworkPolicy(null), "deny-all");
});

test("baseline egress brokers only the read-only Turso token and opens no Gateway", () => {
  assert.deepEqual(createSessionNetworkPolicy(workflow), {
    allow: {
      [NPM_REGISTRY_HOST]: [],
      "acme.turso.io": [
        { transform: [{ headers: { authorization: "Bearer turso-read-only" } }] },
      ],
      "api.example-data.com": [],
    },
  });
  assert.equal(JSON.stringify(createSessionNetworkPolicy(workflow)).includes("turso-write-secret"), false);
  assert.equal(AI_GATEWAY_HOST in createSessionNetworkPolicy(workflow).allow, false);
  assert.equal(NPM_REGISTRY_HOST, "registry.npmjs.org");
});

test("the write policy brokers the write token for the migration step only and keeps the baseline hosts", () => {
  const policy = createWorkflowWritePolicy(workflow);
  assert.deepEqual(policy, {
    allow: {
      [NPM_REGISTRY_HOST]: [],
      "acme.turso.io": [
        { transform: [{ headers: { authorization: "Bearer turso-write-secret" } }] },
      ],
      "api.example-data.com": [],
    },
  });
  assert.equal(JSON.stringify(policy).includes("turso-read-only"), false);
});
