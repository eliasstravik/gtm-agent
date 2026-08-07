# GTM Agent for Slack

An open-source [Eve](https://eve.dev) template that brings evidence-backed GTM research, scoring, segmentation, ICP, persona, and context-management workflows into Slack. Deploy it as a useful Slack-only teammate, or connect one GitHub repository for durable, reviewable GTM context.

> Release evidence pending: add a scrubbed screenshot of the deployed Slack experience after the disposable-account smoke test. No production or private context should appear in that image.

## Deploy

### Recommended: Slack + one GTM context repository

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D&env=GTM_CONTEXT_REPOSITORY&envDescription=Use%20one%20owner%2Frepo%20GitHub%20repository%20for%20durable%20GTM%20context.)

The button creates the project, connects Slack, and asks for `GTM_CONTEXT_REPOSITORY` in exact `owner/repo` form. GitHub connector creation cannot currently be guaranteed by the Deploy Button without a trigger, so finish the setup in Vercel after deployment:

1. Create a GitHub connector with `vercel connect create github` or in the project's Connect settings.
2. Grant it only the repository named by `GTM_CONTEXT_REPOSITORY`.
3. Set the returned connector identifier as `GITHUB_CONNECTOR` and redeploy.

Both GitHub values must be set together. The repository must already use the [GTM context contract](#context-repository-contract), have a `main` branch, and contain root `org.md`.

`SLACK_CONNECTOR` is required for both production deployment paths. The generated connector identifier must be present at production startup. The `slack/my-agent` placeholder is limited to local development and build-time validation.

### Minimal: Slack only

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?project-name=gtm-agent&repository-name=gtm-agent&repository-url=https%3A%2F%2Fgithub.com%2Feliasstravik%2Fgtm-agent&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%5D)

Leave `GITHUB_CONNECTOR` and `GTM_CONTEXT_REPOSITORY` unset. The bundled skills decide which operations can work without persistent context and explain their own prerequisites; the template does not invent another memory system.

## Prerequisites

- A Vercel account with Eve/Workflow, Vercel Sandbox, Connect, and AI Gateway available.
- A Slack workspace where you can install the generated app.
- For the recommended path, one existing GitHub repository with a `main` branch and root `org.md`, ideally scaffolded using `/gtm-context` from the separately installed GTM skills.

There are two distinct repositories: this public template contains executable agent code and a reviewed skill snapshot; your private context repository contains organization, ICP, persona, and people files. Never point `GTM_CONTEXT_REPOSITORY` at this template repository.

## Five-minute setup

1. Choose one Deploy Button above and authorize Slack.
2. For the recommended path, enter the private context repository as `owner/repo`, create the GitHub connector after deployment, grant exactly that repository, set `GITHUB_CONNECTOR`, and redeploy.
3. Confirm `/eve/v1/health` is healthy in the production deployment.
4. In a Slack DM, try: `What GTM workflows can you help me with, and which ones require connected context?`
5. With context connected, try: `Read our saved ICPs and tell me which one best fits example.com. Cite the facts you used.`

## Capability matrix

| Capability | Slack only | Slack + context |
| --- | --- | --- |
| Load the bundled GTM workflows and explain prerequisites | Yes | Yes |
| Public account/lead research when its skill prerequisites are met | Yes | Yes |
| Read saved organization, ICP, persona, and people context | Stops and explains the missing repository | Yes, from the one configured repository |
| Score or segment against saved context | Stops rather than fabricating context | Yes |
| Create, update, delete, or doctor in-contract context files | No durable target | Yes, through one approval and one atomic commit |
| Create/import repositories, configure sharing, delete a whole repository, use multiple contexts, schedule work, or open a browser UI | No | No |

## Approvals, Git history, and stale writes

The context repository is cloned shallowly into a fresh per-session Vercel Sandbox. Its Git remote is removed, the checkout is verified, and sandbox networking returns to deny-all. Git credentials and connector tokens are never exposed to commands in the sandbox. Temporary drafts belong under `$HOME/.gtm-scratch/`, outside the checkout.

For a write, the agent submits one ordered request containing a concise summary, the complete affected-path manifest, the expected Git HEAD, and all additions/deletions. Eve's native human-in-the-loop gate asks for approval before execution. Approval covers the complete tool request even if Slack visually truncates long file contents.

After approval, the trusted runtime:

1. validates every path, size, manifest entry, and expected object ID before requesting write authorization;
2. verifies the local checkout, expected HEAD, clean state, branch, stale marker, and symlink-free path chain;
3. compares the current remote HEAD;
4. creates exactly one atomic GitHub commit on `main` using `createCommitOnBranch`;
5. refreshes the sandbox with a separate read-only token, resets to that exact commit, and returns to deny-all networking.

A changed HEAD is a conflict: the agent makes no write and asks for a fresh Slack thread. It never merges, rebases, retries, force-pushes, or falls back to several commits. The atomic mutation client disables automatic retries and applies a request deadline. If GitHub confirms the commit but the sandbox cannot refresh, the durable commit URL is returned, the session is marked stale, and another mutation requires a fresh thread. If deny-all egress cannot be restored after two attempts, the operation raises a terminal session error instead of reporting success.

## Security model

- Grant the Slack connector only the permissions Eve requests and grant GitHub access to one dedicated context repository.
- Read and write tokens are minted separately, short-lived, repository-bound, and kept in the trusted runtime.
- Only Git smart-HTTP discovery for `git-upload-pack` and the exact `git-upload-pack` POST receive firewall-injected read authentication; receive-pack and all other sandbox egress are denied.
- Every mutation validates before write authorization, requires native approval, compares the expected remote HEAD, and lands as one commit or not at all.
- Treat Slack messages, context files, outputs, eval artifacts, and Vercel logs according to your organization's data policy. Private context is not sent to public search without explicit permission.
- See [SECURITY.md](SECURITY.md) for reporting guidance and enforced trust boundaries.

## Context repository contract

The connected repository is fixed by deployment configuration; users cannot choose another target in a prompt or tool request. Durable mutations are limited to:

```text
org.md
AGENTS.md
CLAUDE.md
.gitignore
people/<slug>/person.md
icps/<slug>.md
personas/<slug>.md
suborgs/<slug>/(org.md|icps/<slug>.md|personas/<slug>.md|suborgs/...)
```

Root contract files cannot be deleted. A request can touch at most 50 paths, each addition is at most 256 KiB, and combined additions are at most 1 MiB. Repository creation/import, connection configuration, sharing, and whole-repository deletion stay keyboard-only `/gtm-context` operations and are refused in Slack.

## Local development

Requirements: Node.js 24 and pnpm 10.14.0.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

Connect Slack as described in the [Eve Slack guide](https://eve.dev/docs/channels/slack). For persistent context, create a GitHub connector with access to only the disposable development repository, then set both optional GitHub variables. Never use a production repository for integration tests.

Useful commands:

```bash
pnpm typecheck
pnpm test
pnpm build
pnpm eval                  # live, credentialed; not run in CI
pnpm check                 # skill integrity + typecheck + tests + build
```

## Updating the skill snapshot

`agent/skills/` is generated from the exact nine approved directories in [`gtmskills`](https://github.com/eliasstravik/gtmskills). `skills-lock.json` records the source URL, source commit, exact skill names, vendored MIT license, and SHA-256 of every shipped file. CI runs the offline `skills:check` integrity verifier.

Do not copy or edit these files by hand. After the upstream repository publishes its separate MIT license:

```bash
pnpm skills:sync ../gtmskills
pnpm skills:check
```

The sync command rejects an unexpected remote, dirty shipping directories or license content, an uncommitted/non-MIT license, changed skill inventory, symlinks, unexpected target entries, and post-copy hash drift. It builds and verifies a complete candidate snapshot before installing it and restores the prior snapshot if installation verification fails.

**Current release gate:** upstream commit `ebb749fc6abe449d64201b921b1fad2fb34e25d5` has no license file. The source repository has not been modified, no skill source has been copied, and `skills:check` intentionally fails until that external prerequisite is resolved and the integrity lock is regenerated.

## Limitations and troubleshooting

- **The agent fails at startup:** confirm `SLACK_CONNECTOR` is set. For context mode, set both GitHub variables and confirm the repository is `owner/repo`, uses `main`, and has root `org.md`. A partial GitHub pair fails at startup by design.
- **A write reports a conflict:** another writer advanced `main`; start a fresh Slack thread so the agent reads the new HEAD. There is no automatic merge or retry.
- **A commit succeeded but the session is stale:** use the returned GitHub commit URL as the durable result and start a fresh Slack thread.
- **Approval content looks truncated:** Slack may shorten the file payload display; the concise summary and complete path manifest appear first, and approval still covers the full request.
- **`pnpm check` fails at `skills:check`:** the upstream MIT-license release gate is unresolved, or the vendored snapshot drifted. Never bypass the gate or hand-edit the snapshot.
- **The GitHub connector is not created by the Deploy Button:** use `vercel connect create github` or Vercel's Connect settings, grant one repository, set `GITHUB_CONNECTOR`, and redeploy.

The template intentionally has no browser UI, alternate memory, database, Blob storage, generic GitHub operations, schedules, subagents, multiple contexts, or repository administration from Slack.

## Architecture and file map

```text
agent/agent.ts                         model selection
agent/channels/slack.ts                standard Eve Slack ingress
agent/sandbox.ts                       optional read-only context hydration
agent/lib/config.ts                    paired deployment configuration
agent/lib/context-paths.ts             GTM file contract and mutation bounds
agent/lib/context-workspace.ts         credential-free clone/preflight/refresh
agent/lib/github-commit.ts             expected-HEAD atomic GraphQL commit
agent/tools/apply_gtm_context_changes.ts sole approval-gated write surface
agent/skills/                          generated reviewed skill snapshot
evals/                                 live Slack behavior checks
scripts/sync-gtmskills.mjs             license-aware snapshot and hash workflow
tests/                                 deterministic and opt-in integration checks
```

The agent runs on `anthropic/claude-sonnet-5`; Eve owns `/eve/v1/health` and `/eve/v1/slack`.

## Evals and integration verification

Live evals cover Slack-only prerequisites, the fixed repository, approval and denial, update refusal, and private-data handling. They require configured Eve/Vercel/model credentials and therefore remain outside CI. `tests/github-context.integration.test.mjs` is an additional real-GitHub atomic-commit adapter check; it runs only when `RUN_GTM_CONTEXT_INTEGRATION=1`, `GTM_INTEGRATION_CONFIRM=disposable-fixture`, a repository ending in `-gtm-agent-fixture`, and a fixture token are all supplied. Full Connect, Sandbox, and Slack integration remains an external release gate.

CI reports skill integrity, typecheck, tests, and build as separate steps. The unresolved upstream license keeps the integrity step red without hiding results from the other checks.

## Release checklist

Local implementation checks:

- [x] Minimal Eve architecture and dependency versions are pinned.
- [x] Repository-bound, approval-gated, atomic writes fail closed on conflict.
- [x] Sandbox access is credential-free and deny-all outside exact clone/refresh requests.
- [x] Unit, structural, build, eval-definition, and opt-in integration coverage are present.
- [x] Vendored-skill sync and offline integrity verification are implemented.

External gates before making the template public:

- [ ] Publish a separate MIT license in `gtmskills`, run `skills:sync`, review the lock, and make `pnpm check` green.
- [ ] Validate both Deploy Buttons in fresh Vercel projects and verify the documented no-trigger GitHub fallback.
- [ ] Run Slack-only and connected-repository evals with disposable credentials.
- [ ] Exercise approve, deny, stale-head conflict, refresh-failure, missing-context, and private-data scenarios in Slack.
- [ ] Confirm GitHub connector grant scoping and inspect Vercel/Sandbox logs for credential or private-content leakage.
- [ ] Add a scrubbed screenshot and verify the final repository is public under MIT before announcing it.

## License

The template code is [MIT licensed](LICENSE). Vendored skills must carry the separately published upstream MIT license; they are deliberately absent until that prerequisite is satisfied.
