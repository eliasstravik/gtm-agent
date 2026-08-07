# Repository guidance

This is a deliberately small [Eve](https://eve.dev) Slack agent template. Preserve that shape.

## Commands

- Install with `pnpm install --frozen-lockfile`.
- Run all release checks with `pnpm check`.
- Run live, credentialed evals only with `pnpm eval` against an explicitly selected target.
- Sync the exact approved skill set with `pnpm skills:sync /path/to/gtmskills`; never hand-edit vendored skill files.

## Architecture boundaries

- Keep Slack as the only channel and `apply_gtm_context_changes` as the only authored write tool.
- Keep the context repository optional. Do not add alternate memory, a database, Blob, a web UI, schedules, subagents, generic GitHub tools, or multi-tenant infrastructure.
- Keep GitHub access repository-bound, short-lived, approval-gated, and atomic on `main`.
- Never expose connector tokens to sandbox commands or persist a Git remote or credentials in the checkout.
- Treat `agent/skills/` as generated, license-carrying source. `skills-lock.json` is its integrity manifest.

## Useful documentation

- Eve project structure: https://eve.dev/docs/getting-started/project-structure
- Eve Slack channel: https://eve.dev/docs/channels/slack
- Eve sandbox: https://eve.dev/docs/sandbox
- Eve human-in-the-loop tools: https://eve.dev/docs/human-in-the-loop
- Eve skills: https://eve.dev/docs/skills
- Vercel deployment: https://eve.dev/docs/deploy/vercel
