# Changelog

## 1.0.3 - 2026-09-11

- `pnpm build` no longer needs the production secrets. Model, reasoning, and the Slack channel resolve from their own variables at module scope, so CI, preview deployments, and local builds compile again; an unconfigured Slack channel outside production admits nobody. Production builds still fail fast on incomplete configuration.
- Upgrading from 0.9: `GTM_WORKFLOW_VERCEL_URL` became `GTM_WORKFLOW_URL` and `GTM_WORKFLOW_RUN_SECRET` became `GTM_RUN_SECRET`. Add both to the agent project before merging, or the production build fails with `GTM_WORKFLOW_URL is required`.

## 1.0.0 - 2026-09-11

- Reduce the hosted agent to one Eve agent, one Slack channel, one Node 22 sandbox, three small library modules, and the classifier-backed `bash` and durable `watch_url` tools.
- Fetch the pinned GTM Skills release at build time instead of committing a vendored snapshot or generated lockfile.
- Remove the source-editor subagent, proposal and migration orchestration, custom workflow controls, duplicated diagram delivery, compatibility patches, and tests for those deleted modules.
- Broker fresh GitHub push credentials and workflow/Turso authorization at the sandbox firewall. Use the durable watcher because the ten-minute attached-command spike did not return reliably.
- Evals, test suites, CI, and live Slack acceptance were skipped at the client's request; typecheck and Eve production build passed.
