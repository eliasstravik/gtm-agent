/**
 * The host's shape, computed once at build time. The sandbox reads it to enforce the firewall and the
 * instructions read it to explain the firewall, so what the model is told and what the network allows
 * cannot disagree.
 */
const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is not set`); })();
export const repo = need("GTM_WORKSPACE_REPOSITORY");
export const token = need("GTM_GITHUB_TOKEN");
export const slug = (repo.split("/")[1] ?? "").toLowerCase().replace(/^gtm-/, "");
if (!/^[^/]+\/[^/]+$/.test(repo) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 40)
  throw new Error(`GTM_WORKSPACE_REPOSITORY must be owner/<repo> with a kebab-case name of 1-40 characters, got "${repo}"`);

// All-or-none: a half-configured agent fails the build here and can never ask for a secret in Slack.
const names = ["GTM_WORKFLOW_URL", "GTM_RUN_SECRET", "TURSO_STUDIO_URL", "TURSO_STUDIO_TOKEN"] as const;
export const workflow = names.some((n) => process.env[n]) ? (Object.fromEntries(names.map((n) => [n, need(n)])) as Record<(typeof names)[number], string>) : null;
const host = (name: (typeof names)[number]) => { try { return new URL(workflow![name]).hostname; } catch { throw new Error(`${name} is not a valid URL`); } };
const bearer = (secret: string) => [{ transform: [{ headers: { authorization: `Bearer ${secret}` } }] }];

/** Firewall: hosts that get a credential added on the way out, then everything else open with none. */
export const allow = {
  "github.com": [{ transform: [{ headers: { authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } }] }],
  ...(workflow && {
    [host("GTM_WORKFLOW_URL")]: bearer(workflow.GTM_RUN_SECRET),
    [host("TURSO_STUDIO_URL")]: bearer(workflow.TURSO_STUDIO_TOKEN),
  }),
  "*": [],
};

export const home = `$HOME/.gtm/${slug}`;
/** What the sandbox's shell sees: addresses in the clear, the value `host` where the firewall supplies the credential. */
export const exports = workflow ? `export GTM_WORKFLOW_URL=${workflow.GTM_WORKFLOW_URL} TURSO_STUDIO_URL=${workflow.TURSO_STUDIO_URL} GTM_RUN_SECRET=host TURSO_STUDIO_TOKEN=host` : "";

const list = (items: string[]) => items.length > 1 ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}` : items[0] ?? "";

/** The firewall in plain words for the model, generated from `allow`. */
export function describeHost(): string {
  const credentialed = Object.keys(allow).filter((h) => h !== "*");
  return [
    `Network from this computer: requests to ${list(credentialed)} get the host's credential added on the way out, so send none yourself; every other address is reachable with no credential at all. No secret exists in this environment; where a variable reads \`host\`, the credential is supplied for you.`,
    workflow
      ? `The workflow project is connected at ${workflow.GTM_WORKFLOW_URL}. Its keys live in its own settings, which you cannot read; its link route lists their names under \`keys\`, and that list is the only source for anything you say about a key.`
      : "No workflow project is connected yet; a save that needs one closes with the connection steps.",
    "Connections the agent exposes as tools call their services from the agent with their own credentials, never from this computer; a workflow step calls a gateway's HTTP API with the key on the workflow project instead.",
  ].join("\n");
}
