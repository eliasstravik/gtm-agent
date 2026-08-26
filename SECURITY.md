# Security

## Reporting

Please report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing credentials, private GTM workspace content, connector identifiers, or reproduction data from a real customer repository.

## Security model

- Slack is the only ingress channel.
- The GitHub workspace is optional and restricted to one deployment-configured `owner/repo` on `main`.
- Read access uses a short-lived, repository-bound token only in the trusted runtime. The sandbox firewall injects it only into Git upload-pack discovery and the exact upload-pack POST; Git receive-pack is never allowed. The token is never placed in the sandbox environment, command, Git remote, or config.
- The sandbox returns to its session baseline (deny-all, or the exact workflow allowlist below) immediately after clone or refresh. Restoration is attempted twice; a repeated failure becomes a terminal session error and is never represented as mutation success.
- Writes use the sole `apply_gtm_workspace_changes` tool, require native approval, validate a strict path contract and size bounds, and create one GitHub commit atomically against an expected HEAD.
- Conflicts are fail-closed; the agent does not merge, rebase, retry, or force-push. The GitHub mutation client disables automatic retries and applies a request deadline.
- Workflow hosting is optional and requires the connected workspace. With `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` set, sandbox egress is an exact allowlist: the npm registry, the workspace Turso host, the AI Gateway host when `GTM_WORKFLOW_GATEWAY_API_KEY` exists, and the hosts listed in `GTM_WORKFLOW_PROVIDER_HOSTS`. Reserved hosts (`github.com`, `api.vercel.com`, the registry, the Gateway, the Turso host) cannot be listed as providers. Git clone and refresh add credentialed upload-pack rules on top of that baseline and restore it afterwards.
- The Turso token and the workflow Gateway key are brokered at the sandbox firewall for their exact hosts. The session environment receives only `GTM_SANDBOX=1`, `GTM_AGENT_BACKEND=api`, `TURSO_DATABASE_URL` (not a credential), and a non-secret `AI_GATEWAY_API_KEY` placeholder. Checkout verification fails if a brokered token variable is present in the session.
- The sandbox exposes no port, ships no Vercel CLI, and holds no deploy credential; `api.vercel.com` stays denied. Workflows run as `Runs: on this computer` against Turso, and the v3 approve route's bearer is a per-sandbox `GTM_RUN_SECRET` that never leaves the ignored `.env`. Per-person approval authorization is enforced by the Slack approval gate, not by the workflow runtime.
- Tracked files of the root `workflows/` project pass through the same approval tool and path contract; `.env*` (except `.env.example`), `node_modules/`, and ignored runtime state are rejected as commit paths.

Before public release, complete every external item in the README release checklist with disposable accounts and a disposable workspace fixture.
