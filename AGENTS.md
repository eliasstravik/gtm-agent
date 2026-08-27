# Repository guidance

This is a deliberately small [Eve](https://eve.dev) Slack agent template. Preserve that shape.

## Commands

- Install with `pnpm install --frozen-lockfile`.
- Run all release checks with `pnpm check`.
- Run live, credentialed evals only with `pnpm eval` against an explicitly selected target.
- Sync the exact approved skill set with `pnpm skills:sync /path/to/gtm-skills`; never hand-edit vendored skill files.

## Architecture boundaries

- Keep Slack as the only channel and `apply_gtm_workspace_changes` as the only authored write tool.
- Keep the workspace repository optional. Do not add alternate memory, Blob, a custom web or workflow UI, subagents, generic GitHub tools, or multi-tenant infrastructure.
- The only database is the user's own Turso database, configured per deployment with `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `TURSO_READ_ONLY_AUTH_TOKEN` for the vendored `gtm-workflow` runtime. The only schedules are Vercel Cron entries on the user's own workflow project. Add no agent-owned database, schedule, or cache.
- Keep GitHub access repository-bound, short-lived, approval-gated, and atomic on `main`. Workflow hosting requires the connected workspace; its Vercel project deploys that repository's `workflows/` root from `main`.
- Keep the sandbox at deny-all egress except the exact workflow allowlist derived from configuration (npm registry, the workspace Turso host with the read-only token, accepted provider hosts without credentials). The sandbox never starts a real run and holds no model key. Never expose a sandbox port or enable `api.vercel.com`; workflow deployment comes from the repository's Vercel Git connection.
- Never expose connector tokens to sandbox commands or persist a Git remote or credentials in the checkout. The read-only Turso token is brokered at the sandbox firewall for every session; the write token is brokered only inside the approval-gated migration and ledger-verification step and withdrawn before the commit. The only session-environment delivery is `TURSO_DATABASE_URL`, which is not a credential; do not add session-environment delivery of any token.
- Treat `agent/skills/` as generated, license-carrying source. `skills-lock.json` is its integrity manifest.

## Useful documentation

- Eve project structure: https://eve.dev/docs/getting-started/project-structure
- Eve Slack channel: https://eve.dev/docs/channels/slack
- Eve sandbox: https://eve.dev/docs/sandbox
- Eve human-in-the-loop tools: https://eve.dev/docs/human-in-the-loop
- Eve skills: https://eve.dev/docs/skills
- Vercel deployment: https://eve.dev/docs/deploy/vercel
