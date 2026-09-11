import type { SandboxNetworkPolicy } from "eve/sandbox";
import type { Configuration } from "./config.ts";

const PLACEHOLDER_GIT_AUTH = `Basic ${Buffer.from("x-access-token:gtm-sandbox").toString("base64")}`;

export function sessionEnvironment(config: Configuration): Record<string, string> {
  return {
    GTM_SANDBOX: "1",
    GTM_HOST: "eve",
    GTM_BASE_URL: config.workflow.url,
    TURSO_DATABASE_URL: config.turso.url,
    GIT_TERMINAL_PROMPT: "0",
  };
}

export function gitAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

export function sessionNetworkPolicy(
  config: Configuration,
  githubAuthorization?: string,
): SandboxNetworkPolicy {
  const github = githubAuthorization ? [{
    match: { headers: [{ key: { exact: "authorization" }, value: { exact: PLACEHOLDER_GIT_AUTH } }] },
    transform: [{ headers: { authorization: githubAuthorization } }],
  }] : [];
  return { allow: {
    "registry.npmjs.org": [],
    "github.com": github,
    "codeload.github.com": [],
    [config.workflow.host]: [{
      transform: [{ headers: { authorization: `Bearer ${config.workflow.runSecret}` } }],
    }],
    [config.turso.host]: [{
      transform: [{ headers: { authorization: `Bearer ${config.turso.readOnlyToken}` } }],
    }],
  } };
}
