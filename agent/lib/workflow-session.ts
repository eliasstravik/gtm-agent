import type { SandboxNetworkPolicy } from "eve/sandbox";

import type { WorkflowHostConfiguration } from "./config.ts";

/** `npm ci` runs inside the sandbox once the workflow scaffold exists. */
export const NPM_REGISTRY_HOST = "registry.npmjs.org" as const;
/**
 * The Vercel AI Gateway host. It stays closed to the sandbox: the sandbox
 * never starts a real run, so it never needs a model credential. The
 * constant remains reserved so it can never be listed as a provider host.
 */
export const AI_GATEWAY_HOST = "ai-gateway.vercel.sh" as const;

type CustomNetworkPolicy = Exclude<SandboxNetworkPolicy, string>;

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
  return environment;
}

/**
 * Baseline egress for a session. Without workflow hosting the sandbox stays
 * deny-all. With it, only the npm registry, the workspace Turso host with the
 * read-only token, and accepted provider hosts (without credentials) are
 * open. The sandbox authors, validates, dry-runs, and queries; it cannot
 * write to the database or spend on a model.
 */
export function createSessionNetworkPolicy(
  workflow: WorkflowHostConfiguration | null,
): SandboxNetworkPolicy {
  if (workflow === null) return "deny-all";
  return createWorkflowPolicy(workflow, workflow.databaseReadOnlyAuthToken);
}

/**
 * Egress for the approval-gated migration step only: the same hosts as the
 * baseline, with the Turso write token in place of the read-only token. The
 * caller restores the baseline before any Git commit is attempted.
 */
export function createWorkflowWritePolicy(
  workflow: WorkflowHostConfiguration,
): CustomNetworkPolicy {
  return createWorkflowPolicy(workflow, workflow.databaseAuthToken);
}

function createWorkflowPolicy(
  workflow: WorkflowHostConfiguration,
  databaseToken: string,
): CustomNetworkPolicy {
  const allow: Record<string, { transform: { headers: Record<string, string> }[] }[]> = {
    [NPM_REGISTRY_HOST]: [],
    [workflow.databaseHost]: [
      { transform: [{ headers: { authorization: `Bearer ${databaseToken}` } }] },
    ],
  };
  for (const host of workflow.providerHosts) {
    allow[host] = [];
  }
  return { allow };
}
