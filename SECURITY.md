# Security

## Reporting

Please report suspected vulnerabilities privately to the repository owner. Do not open a public issue containing credentials, private GTM context, connector identifiers, or reproduction data from a real customer repository.

## Security model

- Slack is the only ingress channel.
- GitHub context is optional and restricted to one deployment-configured `owner/repo` on `main`.
- Read access uses a short-lived, repository-bound token only in the trusted runtime. The sandbox firewall injects it only into Git upload-pack discovery and the exact upload-pack POST; Git receive-pack is never allowed. The token is never placed in the sandbox environment, command, Git remote, or config.
- The sandbox returns to deny-all networking immediately after clone or refresh. Restoration is attempted twice; a repeated failure becomes a terminal session error and is never represented as mutation success.
- Writes use the sole `apply_gtm_context_changes` tool, require native approval, validate a strict path contract and size bounds, and create one GitHub commit atomically against an expected HEAD.
- Conflicts are fail-closed; the agent does not merge, rebase, retry, or force-push. The GitHub mutation client disables automatic retries and applies a request deadline.

Before public release, complete every external item in the README release checklist with disposable accounts and a disposable context fixture.
