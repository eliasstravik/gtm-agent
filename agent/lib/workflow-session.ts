import type { SandboxNetworkPolicy } from "eve/sandbox";

import type { WorkflowHostConfiguration } from "./config.ts";

/** `npm ci` runs inside the sandbox once the workflow scaffold exists. */
export const NPM_REGISTRY_HOST = "registry.npmjs.org" as const;
/** The Vercel AI Gateway host used by the workflow runtime's `api` backend. */
export const AI_GATEWAY_HOST = "ai-gateway.vercel.sh" as const;
/**
 * Non-empty placeholder so the runtime's local `AI_GATEWAY_API_KEY` check
 * passes while the sandbox firewall replaces the Authorization header.
 */
export const BROKERED_GATEWAY_KEY_PLACEHOLDER =
  "brokered-at-sandbox-firewall" as const;

/**
 * Session environment for every sandbox. The runtime treats `GTM_SANDBOX=1`
 * as the sole sandbox signal, and only the `api` model backend exists here.
 * The database URL is not a credential; tokens are brokered, never delivered.
 */
export function createWorkflowSessionEnvironment(
  workflow: WorkflowHostConfiguration | null,
): Record<string, string> {
  const environment: Record<string, string> = {
    GTM_SANDBOX: "1",
    GTM_AGENT_BACKEND: "api",
  };
  if (workflow === null) return environment;

  environment.TURSO_DATABASE_URL = workflow.databaseUrl;
  if (workflow.gatewayApiKey !== null) {
    environment.AI_GATEWAY_API_KEY = BROKERED_GATEWAY_KEY_PLACEHOLDER;
  }
  return environment;
}

/**
 * Baseline egress for a session. Without workflow hosting the sandbox stays
 * deny-all. With it, only the npm registry, the workspace Turso host, the
 * Gateway host (when a key exists), and accepted provider hosts are open.
 * Bearer tokens are injected at the firewall so they never enter the VM.
 */
export function createSessionNetworkPolicy(
  workflow: WorkflowHostConfiguration | null,
): SandboxNetworkPolicy {
  if (workflow === null) return "deny-all";

  const allow: Record<string, { transform: { headers: Record<string, string> }[] }[]> = {
    [NPM_REGISTRY_HOST]: [],
    [workflow.databaseHost]: [
      { transform: [{ headers: { authorization: `Bearer ${workflow.databaseAuthToken}` } }] },
    ],
  };
  if (workflow.gatewayApiKey !== null) {
    allow[AI_GATEWAY_HOST] = [
      { transform: [{ headers: { authorization: `Bearer ${workflow.gatewayApiKey}` } }] },
    ];
  }
  for (const host of workflow.providerHosts) {
    allow[host] = [];
  }
  return { allow };
}
