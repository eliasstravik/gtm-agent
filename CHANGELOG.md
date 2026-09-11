# Changelog

## 1.0.0 - 2026-09-11

- Reduce the hosted agent to one Eve agent, one Slack channel, one Node 22 sandbox, three small library modules, and the classifier-backed `bash` and durable `watch_url` tools.
- Fetch the pinned GTM Skills release at build time instead of committing a vendored snapshot or generated lockfile.
- Remove the source-editor subagent, proposal and migration orchestration, custom workflow controls, duplicated diagram delivery, compatibility patches, and tests for those deleted modules.
- Broker fresh GitHub push credentials and workflow/Turso authorization at the sandbox firewall. Use the durable watcher because the ten-minute attached-command spike did not return reliably.
- Evals, test suites, CI, and live Slack acceptance were skipped at the client's request; typecheck and Eve production build passed.
