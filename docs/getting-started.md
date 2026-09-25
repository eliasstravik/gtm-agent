# Get GTM Agent running in Slack

## Prerequisites

- A Vercel Pro team (Hobby accounts cannot hold teams) and the Vercel CLI signed in: `npm i -g vercel && vercel login`.
- A GitHub account and the GitHub CLI signed in: `gh auth login`. The Vercel GitHub app installed for that account or organization (Vercel → Settings → Git).
- A Slack workspace where you can install apps.
- Node.js 22 or newer, and a coding agent that loads skills from skills.sh: Claude Code, Codex, Cursor, OpenCode, or another host.

## Deploy with one prompt

Install the GTM Skills, which include the `gtm-agent` skill:

```sh
npx skills add eliasstravik/gtm-skills -g
```

Then tell your coding agent:

```
Get gtm-agent running for Acme in Slack
```

The agent creates a private copy of this repository, deploys it to your Vercel team, creates the Slack app, creates the private workspace repository `gtm-acme`, and connects a workflow project with a Neon Postgres database, in about five minutes. Two things are yours:

1. The Slack install page it links: choose the workspace and click Allow. The setup skill synchronizes the selected configuration in Vercel and Slack, then verifies it.
2. The first time your team uses Neon: add the database to the workflow project through Vercel's Neon integration (Production only) and accept its marketplace terms when the agent asks.

When it says done, invite the app to your GTM channel and mention it:

```
@gtm-agent-acme set up our GTM workspace
```

The agent asks what it needs through Slack's native question controls, fills the organization record from what you tell it and from public sources, and pushes the first commit to the repository. From then on, ask for ICPs, personas, team changes, fit checks, and workflows the same way. Once the agent has replied in a thread, replies there need no mention.

"Check the Acme deployment" runs every check and names the fixes; "upgrade our GTM agent" brings your copy up to the current template.

## Inspect the result

- The workspace repository on GitHub shows every change as one plain-language commit on `main`.
- The agent's reply in the thread says what was created, changed, or deleted.
- A workflow's diagram, runs, and data open from the primary Open GTM Workflows button. Ask for it whenever you need the link.

## Environment variables

Set by the skill; listed here for when you look at the project in Vercel.

| Name | Project | Meaning |
| --- | --- | --- |
| `SLACK_CONNECTOR` | agent | the Slack connector's uid |
| `GTM_WORKSPACE_REPOSITORY` | agent | `owner/<repo>`; the repository name, minus a leading `gtm-`, is the workspace slug |
| `GTM_GITHUB_TOKEN` | agent | the token commits are authored with; the skill uses the GitHub CLI's own, replace it with a fine-grained token scoped to the repository when you want a narrower one |
| `GTM_AGENT_MODEL`, `GTM_AGENT_REASONING` | agent, optional | an AI Gateway model id (`openai/gpt-6-luna-fast` when unset) and its reasoning effort (`high` when unset); read at build, so Redeploy after changing them |
| `GTM_WORKFLOW_URL`, `GTM_RUN_SECRET` | agent | the workflow project's production URL and the secret its routes take; both or neither |
| `GTM_NOTIFY_SECRET`, `GTM_NOTIFY_CHANNEL` | agent | so runs can reach people through `POST /gtm/notify` (the same secret sits on the workflow project); the channel id where posts land when a workflow names none |
| `GTM_RUN_SECRET`, `CRON_SECRET`, `GTM_MODEL`, `GTM_AGENT_URL`, `GTM_NOTIFY_SECRET`, `GTM_RUNS_URL` | workflow | see the `gtm-agent` skill's setup reference |
| `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | workflow | set by the Neon integration in Vercel, Production only; never by hand |

Secrets never enter the sandbox: the sandbox firewall adds the GitHub token to requests to GitHub and the run secret to requests to the workflow project; the agent reads hosted data through that project's query route, so no database token exists on the agent. Model credentials: none; both projects call the AI Gateway with their Vercel OIDC identity.

## Without the skill

Click the button to deploy from the Vercel dashboard, then follow the Slack and workflow steps by hand.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&project-name=gtm-agent&repository-name=gtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&env=GTM_WORKSPACE_REPOSITORY%2CGTM_GITHUB_TOKEN&envDescription=The+GTM+workspace+repository+%28owner%2Frepo%29+and+a+GitHub+token+with+contents+read+and+write+on+it.&envLink=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent%2Fblob%2Fmain%2Fdocs%2Fgetting-started.md)

1. Create an empty private GitHub repository (no README) named `gtm-<slug>` and a GitHub token with contents read and write on it.
2. Click Deploy: Vercel clones this template, asks for `GTM_WORKSPACE_REPOSITORY` and `GTM_GITHUB_TOKEN`, and creates and installs the Slack connector.
3. Follow the [Slack configuration procedure](https://github.com/eliasstravik/gtm-skills/blob/main/skills/gtm-agent/references/slack.md) to apply the selected bot scopes, message events, and interactivity in both Vercel and Slack. Reinstall the app, then invite it to channels where it should receive messages.
4. For workflows, follow "Connect the project, once" in the `gtm-workflow` skill's deploy reference, then set `GTM_WORKFLOW_URL` and `GTM_RUN_SECRET` on this project and Redeploy.

Or from a terminal: fork this repository, `vercel link`, `vercel connect create slack --name gtm-agent --triggers`, `vercel connect attach slack/gtm-agent --environment production --triggers --trigger-path /eve/v1/slack --yes`, set the variables, push. To run the agent on your own machine: `vercel link`, `vercel env pull`, `npm run build` once (it installs the skills), then `npm run dev`.

## Upgrading

The skills come from [gtm-skills](https://github.com/eliasstravik/gtm-skills) at build time and are never committed; the `build` script pins the release. Your copy keeps a `template` remote pointing here: "upgrade our GTM agent" merges it and pushes, and the push deploys.

Something not working? [Open an issue](https://github.com/eliasstravik/gtm-agent/issues/new).
