import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

const need = (name: string) => process.env[name] || (() => { throw new Error(`${name} is not set`); })();
const repo = need("GTM_WORKSPACE_REPOSITORY"), token = need("GTM_GITHUB_TOKEN");
const slug = (repo.split("/")[1] ?? "").toLowerCase().replace(/^gtm-/, "");
if (!/^[^/]+\/[^/]+$/.test(repo) || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug) || slug.length > 40)
  throw new Error(`GTM_WORKSPACE_REPOSITORY must be owner/<repo> with a kebab-case name of 1-40 characters, got "${repo}"`);
// All-or-none: a half-configured agent fails the build here and can never ask for a secret in Slack.
const names = ["GTM_WORKFLOW_URL", "GTM_RUN_SECRET", "TURSO_STUDIO_URL", "TURSO_STUDIO_TOKEN"] as const;
const workflow = names.some((n) => process.env[n]) ? (Object.fromEntries(names.map((n) => [n, need(n)])) as Record<(typeof names)[number], string>) : null;
const bearer = (secret: string) => [{ transform: [{ headers: { authorization: `Bearer ${secret}` } }] }];
const host = (name: (typeof names)[number]) => { try { return new URL(workflow![name]).hostname; } catch { throw new Error(`${name} is not a valid URL`); } };
const allow = {
  "github.com": [{ transform: [{ headers: { authorization: `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}` } }] }],
  ...(workflow && {
    [host("GTM_WORKFLOW_URL")]: bearer(workflow.GTM_RUN_SECRET),
    [host("TURSO_STUDIO_URL")]: bearer(workflow.TURSO_STUDIO_TOKEN),
  }),
  "*": [],
};
const home = `$HOME/.gtm/${slug}`;
const npmCi = "npm ci --no-audit --no-fund -q";
const exports = workflow ? `export GTM_WORKFLOW_URL=${workflow.GTM_WORKFLOW_URL} TURSO_STUDIO_URL=${workflow.TURSO_STUDIO_URL} GTM_RUN_SECRET=host TURSO_STUDIO_TOKEN=host` : "";

export default defineSandbox({
  backend: vercel({ networkPolicy: { allow } }),
  // Rebuild the template only when what bootstrap bakes in changes (skills and this file are tracked by eve).
  revalidationKey: () => `${repo}|${exports}`,
  async bootstrap({ use }) {
    const result = await (await use()).run({
      command: [
        // The profile file is the one `bash -l` reads: .bash_profile, else .bash_login, else .profile.
        `p=$HOME/.bash_profile; [ -f $p ] || p=$HOME/.bash_login; [ -f $p ] || p=$HOME/.profile; printf '%s\\n' '${exports}' >> $p`,
        `git config --global user.name "GTM Agent" && git config --global user.email gtm-agent@users.noreply.github.com && git config --global init.defaultBranch main`,
        `git clone -q https://github.com/${repo}.git ${home}`,
        `if [ -f ${home}/workflows/package-lock.json ]; then (cd ${home}/workflows && ${npmCi}); fi`,
      ].join(" && "),
    });
    if (result.exitCode !== 0) throw new Error(`Sandbox setup failed (exit ${result.exitCode}): ${result.stderr || result.stdout}`);
  },
  async onSession({ use }) {
    // Freshen once per thread; never throws. A diverged local main is reset, because nothing local exists yet.
    await (await use()).run({
      command: `cd ${home} && git fetch -q && if git rev-parse -q --verify origin/main >/dev/null; then git rev-parse -q --verify HEAD >/dev/null && git merge --ff-only -q origin/main || git checkout -q -B main origin/main; fi || true; if [ -f workflows/package-lock.json ] && [ workflows/package-lock.json -nt workflows/node_modules/.package-lock.json ]; then (cd workflows && ${npmCi}); fi`,
    });
  },
});
