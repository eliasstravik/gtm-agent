# Repository guidance

This is a deliberately small [Eve](https://eve.dev) Slack agent. It is a keyboard user in a box: it runs the same GTM skills and the same commands a person runs in Claude Code, inside a sandbox whose credentials live at the firewall. Preserve that shape.

## Commands

- Install with `pnpm install --frozen-lockfile`.
- `pnpm check` fetches the pinned skills release, typechecks, runs the tests, and builds.
- `pnpm fetch-skills` installs `gtm-skills` at the ref in `package.json` `gtm.skillsRelease` into `agent/skills/` (generated, ignored). Never hand-edit those files; change `gtm-skills` and move the pin.
- Live, credentialed evals run only with `pnpm eval` against an explicitly selected target.

## Architecture boundaries

- Slack is the only channel. The only tools are `bash` and `watch_url`; the skills provide every workflow behavior.
- Saving is `git push` from the sandbox. Running is `gtm run --url <production>` from the sandbox. The workflow itself never runs in the sandbox.
- Approval is a policy on `bash`: the classifier in the skill decides `allow` or `ask`; an `ask` needs plain card text and one user approval, then the identical command and text may replay twice. The card shows the summary only, never a command or JSON.
- Secrets never enter the sandbox. The firewall replaces three placeholders per request: the CLI run bearer, the CLI Turso token, and git's `x-access-token:gtm-sandbox` Basic header. Egress is limited to the npm registry, GitHub, the workflow host, and the Turso host.
- `watch_url` reads only `/api/deployment`, `/api/runs/<id>`, and `/api/runs/latest?workflow=&head=` on the workflow host.
- The only database is the workspace's own Turso database. Add no agent-owned database, memory, web UI, or multi-tenant infrastructure.
- Instructions stay under 300 words and declare surface facts only; behavior belongs in the skills.

## Useful documentation

- Host contract the skills expect: `agent/skills/gtm-workflow/../../docs/gtm-agent-requirements.md` in the gtm-skills repository
- Eve project structure: https://eve.dev/docs/getting-started/project-structure
- Eve Slack channel: https://eve.dev/docs/channels/slack
- Eve sandbox: https://eve.dev/docs/sandbox
- Eve tools and approval: https://eve.dev/docs/tools
- Vercel deployment: https://eve.dev/docs/deploy/vercel
