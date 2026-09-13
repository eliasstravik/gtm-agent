# gtm-agent

A template for a Vercel Eve agent that connects one Slack workspace to one GTM workspace repository, so non-technical teammates can do everything the five [gtm-skills](https://github.com/eliasstravik/gtm-skills) skills do from Slack: keep the organization's GTM context, ICPs, and personas, qualify prospects, and build, run, and schedule saved workflows. Fit checks from Slack use public web evidence only; the agent exposes no paid data tools.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&project-name=gtm-agent&repository-name=gtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&env=GTM_WORKSPACE_REPOSITORY%2CGTM_GITHUB_TOKEN&envDescription=The+GTM+workspace+repository+%28owner%2Frepo%29+and+a+fine-grained+GitHub+token+with+contents+read+and+write+on+it.&envLink=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent%23setup)

The skills come from gtm-skills at build time and are never committed; to move your deployment to a new skills release, bump the tag in the `build` script of `package.json` and push.

## Setup

1. Create an empty private GitHub repository with no README, `.gitignore`, or license (or pick an existing GTM workspace repository). Its name, minus a leading `gtm-`, becomes the workspace slug, so use lowercase kebab-case, 1–40 characters. The agent never creates this repository.
2. Create a fine-grained GitHub token scoped to that repository with contents read and write. The agent's commits are authored as that token's owner, which is what lets a Git-connected Vercel project build them. Fine-grained tokens expire (one year at most); renewing means replacing `GTM_GITHUB_TOKEN` and redeploying, and the symptom of an expired one is a failed save in Slack.
3. Click Deploy. Vercel clones this template into your account, asks for `GTM_WORKSPACE_REPOSITORY` (`owner/<repo>`) and `GTM_GITHUB_TOKEN`, creates a Slack connector, installs it in your workspace, and points its events at the agent. The build prewarms the sandbox template, so a broken variable fails the deploy loudly.
4. In the Vercel Connect dashboard, open the connector's Advanced settings and add the trigger events `message.channels`, `message.groups`, `message.im` and the bot scopes `channels:history`, `groups:history`, `im:history`, `files:read`; reinstall the app when Slack asks. Without this the bot answers mentions only.
5. Invite the bot to the channels your GTM team uses; never a Slack Connect shared channel.
6. When the first workflow is created from Slack, the agent asks for the workflow project: create a second Vercel project from the workspace repository with root directory `workflows/`, production branch `main`, Node 22; connect Turso from the marketplace; set `GTM_RUN_SECRET` (any long random string you choose), `CRON_SECRET` (same kind), `GTM_MODEL` (`openai/gpt-5.6-luna` unless you want another Gateway model), and `AI_GATEWAY_API_KEY`, optionally `GTM_RUNS_URL` (that project's Observability → Workflows page address) and `GTM_DATA_URL` (the database's Edit Data page address in Turso) so the agent can link to runs and data; turn off Deployment Protection for production; then Redeploy the latest deployment from the Vercel dashboard, because the first build ran before Turso existed.
7. Put on the agent's Vercel project, all four together: `GTM_WORKFLOW_URL` (the workflow project's production URL, `https://<host>`, no trailing slash), `GTM_RUN_SECRET` (the same value), and a read-only Turso pair, `TURSO_STUDIO_URL` and `TURSO_STUDIO_TOKEN` (in Turso: the database, then tokens, create a read-only token; the URL is the database URL with `libsql://` replaced by `https://`); then Redeploy the agent's latest deployment from the Vercel dashboard, since there is no code change to push. Open threads pick this up on their next message.

Without the button: fork this repository, `vercel link`, `vercel connect create slack --name gtm-agent --triggers`, then `vercel connect attach slack/gtm-agent --environment production --triggers --trigger-path /eve/v1/slack --yes`, remove the connector's default trigger destination in the Connect dashboard, and set the two variables on the project. To run the agent on your own machine: `vercel link`, `vercel env pull`, `npm run build` once (it installs the skills), then `npm run dev`.

## Environment variables

| Name | When | Meaning |
| --- | --- | --- |
| `SLACK_CONNECTOR` | set by the Deploy button | the Slack connector's UID |
| `GTM_WORKSPACE_REPOSITORY` | at deploy | `owner/<repo>`; the repository name fixes the workspace slug |
| `GTM_GITHUB_TOKEN` | at deploy | fine-grained token, contents read and write on that repository only |
| `GTM_WORKFLOW_URL` | when the workflow project exists | its production URL, copied from the Vercel dashboard |
| `GTM_RUN_SECRET` | when the workflow project exists | the value you chose and set on the workflow project |
| `TURSO_STUDIO_URL`, `TURSO_STUDIO_TOKEN` | when the workflow project exists | read-only Turso pair; the `https://` form of the database URL |

Secrets never enter the sandbox: the sandbox firewall adds them to requests to GitHub, the workflow project, and Turso. Model credentials: none; Eve's default model runs through the AI Gateway with the Vercel project's OIDC.

MIT licensed.
