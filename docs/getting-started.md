# Getting started — deploy GTM Agent

GTM Agent is an open-source Eve agent that brings four focused GTM skills into Slack. Deploy it with Slack only, connect one GitHub repository for durable organization, ICP, persona, member, and suborganization workspace content, and optionally add the workspace's own Turso database so the agent can build and run saved GTM workflows.

> [!IMPORTANT]
> **Breaking deployment change:** when upgrading, rename `GTM_CONTEXT_REPOSITORY` to `GTM_WORKSPACE_REPOSITORY` before redeploying. The former variable is no longer recognized.

## 1. Check the prerequisites

You need:

- A Vercel account with Eve/Workflow, Vercel Sandbox, Connect, and AI Gateway available
- A Slack workspace where you can install the generated app
- For workspace mode, one existing GitHub repository with a `main` branch and root `ORG.md`; a legacy root `org.md` is accepted so the workspace can be migrated
- For workflow hosting, one Turso database dedicated to that workspace (the Vercel Marketplace Turso integration works) plus a read-only token for it; model calls happen on the workflow project with its own budgeted Vercel AI Gateway key

The agent repository and the workspace repository are different things. This repository contains the executable agent and its locked workflow snapshot. Your workspace repository contains your organization’s private GTM definitions. Never set `GTM_WORKSPACE_REPOSITORY` to this repository.

## 2. Choose a deployment

### Recommended — Slack with one GTM workspace repository

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&env=GTM_WORKSPACE_REPOSITORY&envDescription=Use%20one%20owner%2Frepo%20GitHub%20repository%20for%20a%20durable%20GTM%20workspace.)

The button creates the Vercel project, connects Slack, and asks for `GTM_WORKSPACE_REPOSITORY` in exact `owner/repo` form.

GitHub connector creation cannot currently be guaranteed by the Deploy Button without a trigger. After deployment:

1. Create a GitHub connector with `vercel connect create github` or in the project’s Connect settings.
2. Grant it access only to the repository named by `GTM_WORKSPACE_REPOSITORY`.
3. Set the returned connector identifier as `GITHUB_CONNECTOR`.
4. Create one Vercel project connected to the workspace repository. Set Root Directory to `workflows`, Production Branch to `main`, skip builds when `workflows/` is unchanged, and expose Vercel system environment variables.
5. Configure that project with the workspace Turso pair, `GTM_RUN_SECRET`, matching `CRON_SECRET` when schedules exist, and the budgeted Gateway key and provider variables it needs.
6. Set `GTM_WORKSPACE_COMMIT_AUTHOR_NAME` and `GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL` to the verified Git identity connected to the Vercel project owner (Hobby) or project team member (Pro). The GitHub App remains the committer.
7. Set `GTM_WORKFLOW_VERCEL_URL` and the matching `GTM_WORKFLOW_RUN_SECRET` on the Eve project. Add a Trusted Sources rule permitting this Eve production project to call the protected workflow production project with OIDC.
8. Redeploy Eve.

`GITHUB_CONNECTOR` and `GTM_WORKSPACE_REPOSITORY` must either both be set or both be absent.

### Minimal — Slack only

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D)

Leave `GITHUB_CONNECTOR` and `GTM_WORKSPACE_REPOSITORY` unset. The agent can load the bundled workflows and explain their prerequisites without inventing another memory system.

### Optional — host GTM workflows against your Turso database

Workflow hosting needs the connected workspace. After the GitHub connector works:

1. Create one Turso database for this workspace, for example by installing the Turso integration from the Vercel Marketplace on the agent project. It sets `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN`; otherwise set both yourself. The URL must be a bare `libsql://` or `https://` host.
2. Create a read-only token for the same database with `turso db tokens create <database> --read-only` and set it as `TURSO_READ_ONLY_AUTH_TOKEN`. It must differ from `TURSO_AUTH_TOKEN`.
3. If accepted workflow adapters call third-party providers, list their exact hostnames in `GTM_WORKFLOW_PROVIDER_HOSTS`, comma-separated. The sandbox reaches them without credentials; paid calls happen on Vercel.
4. Redeploy.

Every sandbox session then runs with `GTM_SANDBOX=1`, `GTM_AGENT_BACKEND=api`, and `TURSO_DATABASE_URL`. The read-only token is injected at the sandbox firewall for every session; the write token is injected only while an approved save applies migrations. Neither enters the sandbox. Sandbox egress opens only to the npm registry, your Turso host, and the listed provider hosts.

The sandbox authors, validates, and dry-runs workflows; it never starts a real run. The approved workspace commit to `main` triggers the Git-connected workflow deployment. Eve applies declared migrations before the commit, waits for the exact Git SHA to be live before an approved real run, and can cancel a live run through a separate approval. The sandbox still has no Vercel CLI, deploy credential, or model key.

## 3. Verify the deployment

Open the production deployment’s `/eve/v1/health` endpoint. It should report healthy before you test Slack.

`SLACK_CONNECTOR` is required in production. The `slack/my-agent` placeholder is only for local development and build-time validation.

## 4. Ask the first question in Slack

For Slack-only mode, try:

```text
What GTM workflows can you help me with, and which ones require a connected workspace?
```

With a workspace connected, try:

```text
Read our saved ICPs and tell me which one best fits example.com. Cite the facts you used.
```

With workflow hosting configured, try:

```text
Create a workflow that scores a list of domains against our enterprise ICP, show me the dry run, and stop before any real spend.
```

When a workspace-dependent job lacks the required repository, ICPs, or personas, GTM Agent stops and explains the missing prerequisite instead of fabricating workspace content.

## 5. Review a durable workspace change

GTM Agent can propose changes only to the documented root contract, organization, ICP, persona, member, and suborganization paths, plus the tracked files of the root `workflows/` project. It never submits `.env` files, `node_modules/`, or workflow runtime state; those stay ignored inside the sandbox checkout.

Before any write, Eve’s native approval gate shows the summary, complete affected-path manifest, expected Git HEAD, and full additions or deletions. An approved request creates exactly one commit on `main`. A denial, invalid request, or changed remote HEAD creates no commit.

## 6. Troubleshoot the common setup issues

- **The agent fails at startup:** confirm `SLACK_CONNECTOR` is set. For workspace mode, confirm both GitHub variables are set and the repository uses `main` with root `ORG.md` or the migratable legacy root `org.md`.
- **The GitHub connector was not created:** create it with `vercel connect create github` or in Vercel Connect settings, grant one repository, set `GITHUB_CONNECTOR`, and redeploy.
- **A write reports a conflict:** another writer advanced `main`. Start a fresh Slack thread so the agent reads the new HEAD.
- **A commit succeeded but the session is stale:** use the returned GitHub commit URL as the durable result and start a fresh Slack thread.
- **The agent says workflow hosting is not configured:** set `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `TURSO_READ_ONLY_AUTH_TOKEN` on a deployment that already has the GitHub workspace variables, then redeploy.
- **A Git deployment is blocked by its author:** configure the commit-author name and verified email to map to the Vercel project owner or team member, then create a fresh commit.
- **A production workflow cannot start:** set both `GTM_WORKFLOW_VERCEL_URL` and `GTM_WORKFLOW_RUN_SECRET`, confirm the workflow project is connected to the workspace repository's `main` branch with root `workflows`, and confirm system environment variables and the Trusted Sources rule are enabled.
- **A workflow model call fails with a missing Gateway key:** set a budgeted `AI_GATEWAY_API_KEY` on the Vercel workflow project, not on the agent; the sandbox never runs a workflow.
- **A workflow adapter cannot reach its provider:** add the exact hostname to `GTM_WORKFLOW_PROVIDER_HOSTS`; the sandbox denies every other host.

## Where to go next

- Return to the [GTM Agent overview](../README.md).
- Review the enforced [security model](../SECURITY.md).
- Read the GTM Agent [MIT license](../LICENSE).
- Review the bundled GTM Skills [MIT license](../LICENSES/gtm-skills-MIT.txt).
- [Open an issue](https://github.com/eliasstravik/gtm-agent/issues) if you find a problem or want to suggest an improvement.
