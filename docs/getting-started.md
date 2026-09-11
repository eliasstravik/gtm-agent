# Deploy GTM Agent

Prerequisites: a [Vercel account](https://vercel.com/signup), Slack admin access, one GitHub repository with a `main` branch and an initial commit, and the [Vercel CLI](https://vercel.com/docs/cli) for the scripted path.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D)

The button creates the agent project and its Slack connector. Then use either setup path below. The agent repository and workspace repository must be different.

## Scripted path

1. In the agent project's Connect settings, create a GitHub connector, grant it only the workspace repository, and save its identifier as `GITHUB_CONNECTOR`.
2. Install the GTM skills with `npx skills add eliasstravik/gtm-skills -g`, open the workspace checkout, and run `~/.agents/skills/gtm-workflow/scripts/setup-workflow-project.sh "$PWD"`.
3. In the workflow project's Turso Marketplace integration, create the database; then create a read-only token in Turso with `turso db tokens create <database> --read-only`.
4. Paste the script's workflow URL and run secret, the Turso URL and read-only token, the GitHub connector and repository, and the Slack allowlists into the agent project using the names in [`.env.example`](../.env.example).
5. Set `GTM_WORKSPACE_COMMIT_AUTHOR_NAME` and `GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL` to a verified Git identity belonging to the Vercel project owner or team member.
6. Redeploy the workflow project, then the agent project. Mention the bot in an allowlisted Slack channel and say: `Set up our GTM workspace.`

The current Vercel CLI cannot create the Turso Marketplace resource or enable system environment variables. The setup script prints those remaining dashboard actions instead of claiming to automate them.

## Dashboard path

1. Deploy this repository with the button and finish the Slack connector flow.
2. Add the exact Slack channel and user ID allowlists to the agent project.
3. Create a GitHub connector in the agent project's Connect settings.
4. Grant that connector access to only the workspace repository.
5. Create a second Vercel project from that repository, using `workflows` as its Root Directory and `main` as Production Branch.
6. Set the workflow project's Node.js version to 22.x and turn off Deployment Protection for production.
7. Install Turso from the Vercel Marketplace on the workflow project and create a read-only token for the same database.
8. Add `GTM_RUN_SECRET` to the workflow project and enable Vercel system environment variables.
9. Add all values from [`.env.example`](../.env.example) to the agent project, including the workflow production URL and matching run secret.
10. Confirm the configured commit author belongs to the project owner or team, then redeploy both projects.

## Slack boundary

Subscribe the Slack app to `app_mention` and `message.channels`; add `message.groups` for private allowlisted channels. It needs `app_mentions:read`, `chat:write`, and the matching channel-history scope. Add the app to every allowlisted channel. DMs and unmentioned top-level messages are ignored; replies continue an existing agent thread.

## Troubleshooting

- **An allowed mention gets no reply:** check that both the channel ID and user ID are in the exact allowlists.
- **Startup fails:** compare the deployment's variables with [`.env.example`](../.env.example); all eleven non-optional values are required.
- **Vercel rejects the Git author:** map the configured author email to the project owner or team member.
- **The workflow build reports a Node mismatch:** set the workflow project's Node.js version to 22.x.
- **A run route returns 401:** make `GTM_RUN_SECRET` identical on the workflow and agent projects.

The sandbox can edit and dry-run inside `/workspace`, but it has no model key, Vercel token, database write token, or unbrokered GitHub token. Real runs happen only on the hosted workflow project.
