/**
 * The host's shape, computed once at build time. The sandbox reads it to enforce the firewall and the
 * instructions read it to explain the firewall, so what the model is told and what the network allows
 * cannot disagree.
 */
const need = (name: string) =>
  process.env[name] ||
  (() => {
    throw new Error(`${name} is not set`);
  })();
export const repo = need("GTM_WORKSPACE_REPOSITORY");
export const token = need("GTM_GITHUB_TOKEN");
export const slug = (repo.split("/")[1] ?? "")
  .toLowerCase()
  .replace(/^gtm-/, "");
if (
  !/^[^/]+\/[^/]+$/.test(repo) ||
  !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) ||
  slug.length > 40
)
  throw new Error(
    `GTM_WORKSPACE_REPOSITORY must be owner/<repo> with a kebab-case name of 1-40 characters, got "${repo}"`,
  );

// The workflow project sits behind Vercel Authentication; the agent gets in with Vercel's Protection Bypass for
// Automation, added by this host on the way out. A URL without its bypass fails the build here and can never ask
// for a secret in Slack.
const workflowUrl = process.env.GTM_WORKFLOW_URL;
const bypass = process.env.GTM_WORKFLOW_BYPASS_SECRET;
if (workflowUrl && !bypass)
  throw new Error(
    "GTM_WORKFLOW_BYPASS_SECRET is required with GTM_WORKFLOW_URL: the workflow project is behind Vercel Authentication",
  );
export const workflow = workflowUrl ? { GTM_WORKFLOW_URL: workflowUrl } : null;
const origin = (name: string, value: string) => {
  const url = new URL(value);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(`${name} must be an HTTPS origin`);
  return url.hostname;
};
// Merge-only CSV imports: the no-delete import role's connection (gtm-agent skill, scripts/import-access.mjs), sent as
// Neon's Neon-Connection-String header to this database's own SQL endpoint only. The sandbox sees the address.
const importUrl = process.env.GTM_NEON_IMPORT_URL;
const neonHost = importUrl
  ? (() => {
      const url = new URL(importUrl);
      if (!/^postgres(?:ql)?:$/.test(url.protocol) || !/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(url.hostname))
        throw new Error("GTM_NEON_IMPORT_URL must be a Neon connection string");
      return url.hostname;
    })()
  : null;
const inject = (headers: Record<string, string>) => [{ transform: [{ headers }] }];

/** Firewall: hosts that get a credential added on the way out, then everything else open with none. */
export const allow = {
  "github.com": [
    {
      transform: [
        {
          headers: {
            authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`,
          },
        },
      ],
    },
  ],
  ...(workflow && {
    [origin("GTM_WORKFLOW_URL", workflow.GTM_WORKFLOW_URL)]: inject({ "x-vercel-protection-bypass": bypass! }),
  }),
  ...(neonHost && { [neonHost]: inject({ "Neon-Connection-String": importUrl! }) }),
  "*": [],
};

export const home = `$HOME/.gtm/${slug}`;
/** What the sandbox's shell sees: addresses in the clear, and GTM_AGENT_HOSTED=1, which says the host supplies credentials. */
export const exports = [
  "export GTM_AGENT_HOSTED=1",
  workflow ? `GTM_WORKFLOW_URL=${workflow.GTM_WORKFLOW_URL}` : "",
  neonHost ? `GTM_NEON_SQL_URL=https://${neonHost}/sql` : "",
].filter(Boolean).join(" ");

const list = (items: string[]) =>
  items.length > 1
    ? `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`
    : (items[0] ?? "");

/** The firewall in plain words for the model, generated from `allow`. */
export function describeHost(): string {
  const credentialed = Object.keys(allow).filter((h) => h !== "*");
  return [
    `Network from this computer: requests to ${list(credentialed)} get the host's credential added on the way out, so send none yourself; every other address is reachable with no credential at all. No secret exists in this environment (\`GTM_AGENT_HOSTED=1\` says so); the credential is supplied for you.`,
    workflow
      ? `The workflow project is connected at ${workflow.GTM_WORKFLOW_URL}. GET /api/connections returns safe provider names, configured presence and declared workflow usage, including unused services with no workflow. Read this metadata before reporting connection availability; it does not prove a provider key works. Never read stored values. Its link resolver returns canonical private viewerUrl behind Vercel sign-in. GET /api/link opens the list; GET /api/link/<workflow-id-or-slug> opens a workflow. Explicit sharing uses /api/viewer/service with the same protected host credential: one reusable link, Diagram by default, Runs and Data optional, no expiry, and scope changes only on explicit save. Its result tables are read through its query route (POST /api/query) with the same credential.`
      : "No workflow project is connected yet; a save that needs one closes with the connection steps.",
    neonHost
      ? `CSV imports into the workspace's production database: POST SQL to $GTM_NEON_SQL_URL as gtm-workflow's imports reference says (merge by key with INSERT ... ON CONFLICT DO UPDATE; the database refuses deletes). Say the row count and table first.`
      : "No database import access is set up; a CSV import request closes by naming the gtm-agent skill's Imports job.",
    "Connections the agent exposes as tools call their services from the agent with their own credentials, never from this computer; a workflow step calls a gateway's HTTP API with the key on the workflow project instead.",
  ].join("\n");
}
