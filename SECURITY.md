# Security

## Reporting

Please report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing credentials, private GTM workspace content, connector identifiers, or reproduction data from a real customer repository.

## Security model

- Slack is the only ingress channel.
- The GitHub workspace is optional and restricted to one deployment-configured `owner/repo` on `main`.
- Read access uses a short-lived, repository-bound token only in the trusted runtime. The sandbox firewall injects it only into Git upload-pack discovery and the exact upload-pack POST; Git receive-pack is never allowed. The token is never placed in the sandbox environment, command, Git remote, or config.
- The sandbox returns to its session baseline (deny-all, or the exact workflow allowlist below) immediately after clone or refresh. Restoration is attempted twice; a repeated failure becomes a terminal session error and is never represented as mutation success.
- Writes use the sole `apply_gtm_workspace_changes` tool, require native approval, validate a strict path contract and size bounds, and create one GitHub commit atomically against an expected HEAD. Every `workflows/drizzle/*.sql` addition must be declared in `migrations`, and SQL that drops, truncates, or deletes must be declared `destructive`, so the approval card carries the database effect even when file bodies are truncated. Git-deployed workflows require a verified author identity mapped to the Vercel owner or team; the repository-bound GitHub App remains the committer.
- Conflicts are fail-closed; the agent does not merge, rebase, retry, or force-push. The GitHub mutation client disables automatic retries and applies a request deadline.
- Workflow hosting is optional and requires the connected workspace. With `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `TURSO_READ_ONLY_AUTH_TOKEN` set, sandbox egress is an exact allowlist: the npm registry, the workspace Turso host, and the hosts listed in `GTM_WORKFLOW_PROVIDER_HOSTS` (without credentials). Reserved hosts (`github.com`, `api.vercel.com`, the registry, the AI Gateway, the Turso host) cannot be listed as providers. Git clone and refresh add credentialed upload-pack rules on top of that baseline and restore it afterwards.
- The sandbox never starts a real run. Its baseline brokers only the read-only Turso token, so the shell can query but not write; the write token is brokered only while the approved save applies declared migrations and is withdrawn before the commit. A restore failure after migration is a terminal error that names the applied migrations. No model key reaches the sandbox: model calls happen on Vercel with the workflow project's own budgeted key. The session environment receives only `GTM_SANDBOX=1`, `GTM_AGENT_BACKEND=api`, and `TURSO_DATABASE_URL` (not a credential). Checkout verification fails if a brokered token variable is present in the session.
- The sandbox exposes no port, ships no Vercel CLI, and holds no deploy credential; `api.vercel.com` stays denied. A Vercel workflow deploys only through the workspace repository's approved atomic `main` commit. Eve keeps the production bearer and short-lived OIDC identity in its host runtime, waits for the exact production Git SHA, and sends that SHA again on start. Start carries the rows and projected cost the approver accepted and refuses when a fresh dry run differs. Cancel is a separate approval-gated action against the bearer-protected cancel route. Per-person start, approval, and cancel authorization is enforced by Slack's native approval gate.
- Accepted risk: Eve's framework `web_search` and `web_fetch` tools run in the host runtime, outside the sandbox firewall. They are governed by instructions, not by egress policy: the agent must not put private workspace facts into a search query or fetch a non-public or token-bearing URL. Treat workspace content as a potential prompt-injection source when reviewing transcripts.
- Tracked files of the root `workflows/` project pass through the same approval tool and path contract; `.env*` (except `.env.example`), `node_modules/`, and ignored runtime state are rejected as commit paths.

## Agent-source changes

The optional `source_editor` can propose changes only to `agent/instructions.md`
and direct `agent/schedules/*.md` or `*.ts` files. It is hidden from unlisted
Slack users, runs in an independent credential-free checkout of the exact
deployed revision, freezes the complete diff before acceptance, and requires a
second native approval before a short-lived repository-bound GitHub App token is
resolved in the trusted runtime. Its publisher can create only a namespaced
branch and draft pull request. It cannot update `main`, merge, approve, retarget,
close, or deploy. See `docs/agent-self-management.md`.

Before public release, complete every external item in the README release checklist with disposable accounts and a disposable workspace fixture.
