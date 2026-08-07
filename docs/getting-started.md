# Getting started — deploy GTM Agent

GTM Agent is an open-source Eve agent that brings nine focused GTM workflows into Slack. Deploy it with Slack only, or connect one GitHub repository for durable organization, ICP, persona, and people context.

## 1. Check the prerequisites

You need:

- A Vercel account with Eve/Workflow, Vercel Sandbox, Connect, and AI Gateway available
- A Slack workspace where you can install the generated app
- For context mode, one existing GitHub repository with a `main` branch and root `org.md`

The agent repository and the context repository are different things. This repository contains the executable agent and its locked workflow snapshot. Your context repository contains your organization’s private GTM definitions. Never set `GTM_CONTEXT_REPOSITORY` to this repository.

## 2. Choose a deployment

### Recommended — Slack with one GTM context repository

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&env=GTM_CONTEXT_REPOSITORY&envDescription=Use%20one%20owner%2Frepo%20GitHub%20repository%20for%20durable%20GTM%20context.)

The button creates the Vercel project, connects Slack, and asks for `GTM_CONTEXT_REPOSITORY` in exact `owner/repo` form.

GitHub connector creation cannot currently be guaranteed by the Deploy Button without a trigger. After deployment:

1. Create a GitHub connector with `vercel connect create github` or in the project’s Connect settings.
2. Grant it access only to the repository named by `GTM_CONTEXT_REPOSITORY`.
3. Set the returned connector identifier as `GITHUB_CONNECTOR`.
4. Redeploy.

`GITHUB_CONNECTOR` and `GTM_CONTEXT_REPOSITORY` must either both be set or both be absent.

### Minimal — Slack only

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D)

Leave `GITHUB_CONNECTOR` and `GTM_CONTEXT_REPOSITORY` unset. The agent can load the bundled workflows, explain their prerequisites, and run compatible response-only work without inventing another memory system.

## 3. Verify the deployment

Open the production deployment’s `/eve/v1/health` endpoint. It should report healthy before you test Slack.

`SLACK_CONNECTOR` is required in production. The `slack/my-agent` placeholder is only for local development and build-time validation.

## 4. Ask the first question in Slack

For Slack-only mode, try:

```text
What GTM workflows can you help me with, and which ones require connected context?
```

With context connected, try:

```text
Read our saved ICPs and tell me which one best fits example.com. Cite the facts you used.
```

When a context-dependent job lacks the required repository, ICPs, or personas, GTM Agent stops and explains the missing prerequisite instead of fabricating context.

## 5. Review a durable context change

GTM Agent can propose changes only to the documented organization, ICP, persona, people, and suborganization paths.

Before any write, Eve’s native approval gate shows the summary, complete affected-path manifest, expected Git HEAD, and full additions or deletions. An approved request creates exactly one commit on `main`. A denial, invalid request, or changed remote HEAD creates no commit.

## 6. Troubleshoot the common setup issues

- **The agent fails at startup:** confirm `SLACK_CONNECTOR` is set. For context mode, confirm both GitHub variables are set and the repository uses `main` with root `org.md`.
- **The GitHub connector was not created:** create it with `vercel connect create github` or in Vercel Connect settings, grant one repository, set `GITHUB_CONNECTOR`, and redeploy.
- **A write reports a conflict:** another writer advanced `main`. Start a fresh Slack thread so the agent reads the new HEAD.
- **A commit succeeded but the session is stale:** use the returned GitHub commit URL as the durable result and start a fresh Slack thread.

## Where to go next

- Return to the [GTM Agent overview](../README.md).
- Review the enforced [security model](../SECURITY.md).
- Read the GTM Agent [MIT license](../LICENSE).
- Review the bundled GTM Skills [MIT license](../LICENSES/gtmskills-MIT.txt).
- [Open an issue](https://github.com/eliasstravik/gtm-agent/issues) if you find a problem or want to suggest an improvement.
