import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_GATEWAY_HOST,
  BROKERED_GATEWAY_KEY_PLACEHOLDER,
  NPM_REGISTRY_HOST,
  createSessionNetworkPolicy,
  createWorkflowSessionEnvironment,
} from "../agent/lib/workflow-session.ts";

const workflow = {
  databaseHost: "acme.turso.io",
  databaseUrl: "https://acme.turso.io",
  databaseAuthToken: "turso-secret",
  gatewayApiKey: "gateway-secret",
  providerHosts: ["api.example-data.com"],
};

test("every session declares the sandbox workflow runtime and nothing else", () => {
  assert.deepEqual(createWorkflowSessionEnvironment(null), {
    GTM_SANDBOX: "1",
    GTM_AGENT_BACKEND: "api",
  });
});

test("a configured workflow host delivers the database URL and a Gateway placeholder, never a secret", () => {
  const environment = createWorkflowSessionEnvironment(workflow);
  assert.deepEqual(environment, {
    GTM_SANDBOX: "1",
    GTM_AGENT_BACKEND: "api",
    TURSO_DATABASE_URL: "https://acme.turso.io",
    AI_GATEWAY_API_KEY: BROKERED_GATEWAY_KEY_PLACEHOLDER,
  });
  assert.equal(
    Object.values(environment).some((value) => value.includes("secret")),
    false,
  );
});

test("without a Gateway key no placeholder is delivered so the runtime reports the missing backend", () => {
  assert.deepEqual(
    createWorkflowSessionEnvironment({ ...workflow, gatewayApiKey: null }),
    {
      GTM_SANDBOX: "1",
      GTM_AGENT_BACKEND: "api",
      TURSO_DATABASE_URL: "https://acme.turso.io",
    },
  );
});

test("no workflow host keeps the session at deny-all", () => {
  assert.equal(createSessionNetworkPolicy(null), "deny-all");
});

test("workflow egress allows npm, Turso, Gateway, and provider hosts with brokered bearer headers", () => {
  assert.deepEqual(createSessionNetworkPolicy(workflow), {
    allow: {
      [NPM_REGISTRY_HOST]: [],
      "acme.turso.io": [
        { transform: [{ headers: { authorization: "Bearer turso-secret" } }] },
      ],
      [AI_GATEWAY_HOST]: [
        { transform: [{ headers: { authorization: "Bearer gateway-secret" } }] },
      ],
      "api.example-data.com": [],
    },
  });
  assert.equal(NPM_REGISTRY_HOST, "registry.npmjs.org");
  assert.equal(AI_GATEWAY_HOST, "ai-gateway.vercel.sh");
});

test("the Gateway host stays closed when no workflow Gateway key is configured", () => {
  const policy = createSessionNetworkPolicy({ ...workflow, gatewayApiKey: null });
  assert.equal(AI_GATEWAY_HOST in policy.allow, false);
  assert.deepEqual(Object.keys(policy.allow), [
    NPM_REGISTRY_HOST,
    "acme.turso.io",
    "api.example-data.com",
  ]);
});
