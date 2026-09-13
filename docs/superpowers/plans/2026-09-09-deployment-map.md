# Deployment map: eliasstravik and notably tenants (2026-09-09)

Research only. No repo, Vercel, or GitHub state was changed while gathering this.

## 1. Agent repo relationship to template (`eliasstravik/gtm-agent`)

Neither deployed repo is a GitHub fork (`fork: false` on both) and neither was
created `from_template` (template repo's `is_template` is `false`). Both are
**plain copies with a manually added `template` git remote**, updated by
periodic merge PRs:

| Repo | `template` remote | Local checkout |
|---|---|---|
| `eliasstravik/gtm-agent-stravik` | `https://github.com/eliasstravik/gtm-agent.git` | `/Users/eliasstravik/dev/gtm-agent-stravik` |
| `Notably-PR/gtm-agent` | `https://github.com/eliasstravik/gtm-agent.git` | `/Users/eliasstravik/dev/notably-gtm-agent` |

Update procedure (observed from PR history, not written down in a doc): open a
`template-0.X.Y` branch, `git merge template/main`, resolve conflicts, PR titled
`Merge gtm-agent <sha>: <summary>` into the tenant repo's `main`. Example PRs:
`gtm-agent-stravik#14` and `Notably-PR/gtm-agent#6`, both "Merge gtm-agent
c9a3d82: GTM Skills 0.3.2 decision gates".

**Both tenant repos are fully caught up to template `main` as of this
research**: all three HEADs are `c9a3d8265f...` (`Adopt GTM Skills 0.3.2:
decisions only through the gate or a numbered block (#20)`, 2026-09-08T22:41:57Z).
No update is pending on the agent side.

There is **no written runbook** for this sync in the template repo's `README.md`
or `docs/` (checked `docs/getting-started.md`, `docs/agent-self-management.md`,
`docs/social-preview-spec.md`, `docs/superpowers/`). `docs/agent-self-management.md`
documents a *different*, narrower mechanism (an in-agent, approval-gated
self-modification path for instructions/schedules only, via a draft PR — it
explicitly cannot merge or deploy). The template-sync procedure exists only as
tribal knowledge encoded in the `template` remote + PR title convention.

### File-tree differences vs. template main (161 files)

**`gtm-agent-stravik`** (155 files) omits marketing/eval/doc scaffolding the
tenant deploy doesn't need and adds tenant-specific research notes:
- Missing: `README.md`, `LICENSE`, `assets/buttons/*.svg`,
  `assets/gtm-agent-slack-hero.png`, `docs/getting-started.md`,
  `docs/social-preview-spec.md`, `docs/superpowers/plans/2026-09-02-...md`,
  `docs/superpowers/specs/2026-09-02-...md`, `evals/*` (4 files),
  `tests/github-workspace.integration.test.mjs`.
- Added: `.vercelignore`, `docs/research/eve-github-context-options.md`,
  `docs/research/eve-private-context-repo.md`,
  `docs/research/eve-self-modification-best-practices.md`,
  `docs/research/gtm-context-memory-services.md`,
  `docs/research/slack-agent-interaction-models.md`,
  `tests/no-web-chat.test.mjs`, `tests/slack-response-budget.test.mjs`.

**`Notably-PR/gtm-agent`** (163 files) is nearly identical to template plus one
provider connector:
- Added: `agent/connections/monid.ts`, `tests/monid-connection.test.mjs`.
- Nothing removed relative to template.

Not independently diffed line-by-line (e.g. `package.json` `name` field);
tree-level comparison only. Given both are at the identical template commit,
shared files are presumed byte-identical except where the tenant repo has its
own commits layered on top after the last template merge — neither repo shows
commits ahead of `c9a3d82` in the last-3-commits check, so no such drift exists
right now.

## 2. Vercel agent projects

Team IDs (from `vercel teams ls` / `GET /v2/teams`):
- `stravik` → `team_bBA4TJIEGG9AijukSUUyjeV6` ("Elias Stråvik's Workspace")
- `notably` → `team_ewUC5R76LMWMjKw6lsxSJOZ3` ("Notably")

| | `stravik/gtm-agent-stravik` | `notably/gtm-agent` |
|---|---|---|
| Git link | GitHub `eliasstravik/gtm-agent-stravik` | GitHub `Notably-PR/gtm-agent` |
| Production branch | `main` | `main` |
| Framework preset | **`eve`** | **`Other`** (not detected/set) |
| Node.js version | 24.x | 24.x |
| Root directory | `.` | `.` |

**Env var names** (`vercel env ls --project <name> --scope <team>`, Production only, values not read):

`gtm-agent-stravik`: `GTM_AGENT_MODEL`, `GTM_AGENT_ALLOWED_SLACK_USER_IDS`,
`GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS`, `EVE_SOURCE_ALLOWED_SLACK_USER_IDS`,
`EVE_SOURCE_REPOSITORY`, `EVE_SOURCE_GITHUB_CONNECTOR`,
`GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL`, `GTM_WORKSPACE_COMMIT_AUTHOR_NAME`,
`TURSO_READ_ONLY_AUTH_TOKEN`, `GTM_WORKFLOW_RUN_SECRET`,
`GTM_WORKFLOW_VERCEL_URL`, `TURSO_AUTH_TOKEN`, `TURSO_DATABASE_URL`,
`GTM_WORKSPACE_REPOSITORY`, `GITHUB_CONNECTOR`, `SLACK_CONNECTOR`.

`notably/gtm-agent`: `MONID_API_KEY`, `GTM_WORKFLOW_PROVIDER_HOSTS`,
`GTM_WORKFLOW_VERCEL_URL`, `TURSO_READ_ONLY_AUTH_TOKEN`,
`GTM_WORKFLOW_RUN_SECRET`, `GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL`,
`GTM_WORKSPACE_COMMIT_AUTHOR_NAME`, `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`GTM_AGENT_ALLOWED_SLACK_USER_IDS`, `SLACK_CONNECTOR`,
`GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS`, `GITHUB_CONNECTOR`,
`GTM_WORKSPACE_REPOSITORY`.

Both have `GTM_WORKFLOW_VERCEL_URL`, `GTM_WORKFLOW_RUN_SECRET`, and Turso vars
present. Two notable asymmetries:
- **Notably has no `EVE_SOURCE_*` vars** (self-modification feature is
  disabled/unconfigured for that tenant; per `docs/agent-self-management.md`,
  the feature fails closed without all three).
- **Notably has `MONID_API_KEY` and `GTM_WORKFLOW_PROVIDER_HOSTS`**, which
  eliasstravik's agent project lacks (Notably uses the Monid Reddit provider,
  eliasstravik's agent-side project does not — though `MONID_API_KEY` does
  appear on eliasstravik's *workflows* project instead, see below).

## 3. Workspace repos (`workflows/` package)

Both are on **`gtm.libVersion: 13`** — neither is yet on generation 14.

| | `gtm-eliasstravik` | `Notably-PR/gtm-notably` |
|---|---|---|
| `gtm.libVersion` | 13 | 13 |
| `gtm.vercel.team` | `stravik` | `notably` |
| `gtm.vercel.project` | `gtm-eliasstravik-workflows` | `gtm-notably-workflows` |
| `gtm.vercel.rootDirectory` | `workflows` | `workflows` |
| `gtm.vercel.url` | `gtm-eliasstravik-workflows.vercel.app` | `gtm-notably-workflows.vercel.app` |
| `workflows/workflows/` (saved workflows) | **does not exist (404) — zero saved workflows** | `qualify-linkedin-leads.ts`, `reddit-pr-advice-drafts.ts` |
| `workflows/lib/`, `workflows/server/`, `workflows/scripts/` | present | present |
| `// gtm-lib vN` headers checked | `lib/agent.ts`, `scripts/gtm.ts` → both `v13` | `scripts/gtm.ts` → `v13` |
| `.env.example` | present | present |
| `package-lock.json` `overrides` | none | `{"nanoid": "5.1.16"}` (pin not present in eliasstravik's lockfile config) |

`scripts/gtm.ts` content differs by hash between the two repos even though
both declare `v13` — this tracks with Notably's added Monid/Reddit provider
support, not a version skew; both explicitly declare `validatedAgainst`
`workflow@5.0.0-beta.46` / `nitro@3.0.260610-beta` / `drizzle-kit@0.31.10` /
Node 22.

**`.env.example` var names** (identical core set, Notably's comment differs
slightly): `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`,
`TURSO_READ_ONLY_AUTH_TOKEN`, `GTM_RUN_SECRET`, `CRON_SECRET`, `GTM_SANDBOX`,
`GTM_BASE_URL`, `WORKFLOW_LOCAL_RECOVER_ACTIVE_RUNS`, `GTM_AGENT_BACKEND`,
`GTM_AGENT_MODEL`, `AI_GATEWAY_API_KEY`, `MONID_API_KEY`; eliasstravik's also
lists `SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID` (Notably's `.env.example` omits
those two).

**Local checkout drift**: `~/.gtm/gtm-eliasstravik` (origin
`eliasstravik/gtm-eliasstravik`) is clean but **21 commits behind remote
`main`** (local HEAD `f58d832`, remote main `96492d0`). No `gtm-notably` local
checkout exists anywhere under `/Users/eliasstravik/dev` or `~/.gtm` — only the
remote repo was inspected via `gh api`.

## 4. Vercel workflows projects

| | `stravik/gtm-eliasstravik-workflows` | `notably/gtm-notably-workflows` |
|---|---|---|
| Git link | GitHub `eliasstravik/gtm-eliasstravik` | GitHub `Notably-PR/gtm-notably` |
| Root directory | `workflows` | `workflows` |
| Production branch | `main` | `main` |
| Framework preset | **`nitro`** | **`Other`** (not detected/set) |
| Node.js version | 22.x | 22.x |

**Env var names** (Production): both have `AI_GATEWAY_API_KEY`,
`GTM_AGENT_MODEL`, `GTM_AGENT_BACKEND`, `CRON_SECRET`, `GTM_RUN_SECRET`,
`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, `MONID_API_KEY`. eliasstravik's also
has `SLACK_CHANNEL_ID` and `SLACK_BOT_TOKEN` — Notably's workflows project has
**neither**, so any workflow that posts to Slack directly from the workflows
runtime (rather than routing back through the agent) would fail closed for
Notably today. Neither project shows `TURSO_READ_ONLY_AUTH_TOKEN` (optional,
only used by `db:studio:cloud`/`query --cloud`).

**Deployment protection** (`GET /v9/projects/<name>?teamId=<id>`, names/values
only):

| | eliasstravik agent | notably agent | eliasstravik workflows | notably workflows |
|---|---|---|---|---|
| `ssoProtection.deploymentType` | `all_except_custom_domains` | `all_except_custom_domains` | `all_except_custom_domains` | `all_except_custom_domains` |
| `passwordProtection` | none | none | none | none |
| `trustedIps` | none | none | none | none |
| `oidcTokenConfig` | enabled, `issuerMode: team` | enabled, `issuerMode: team` | enabled, `issuerMode: team` | enabled, `issuerMode: team` |
| `gitForkProtection` | true | true | true | true |
| `protectionBypass` (automation-bypass secret) | **present** | **absent (`{}`)** | **present** | **absent (key not in payload)** |
| `trustedSources` (OIDC "Trusted Sources") | — (n/a, not a workflows project) | — | **absent — no rule configured** | **present, see §5** |

All four projects use Vercel's standard SSO/Vercel-Authentication protection
scoped to non-custom-domain deployment URLs; none use password protection or
IP allowlisting. The one structural difference is the OIDC Trusted Sources
rule, which only Notably's workflows project has.

## 5. OIDC "Trusted Sources" ownership

- **`gtm-notably-workflows`** has a `trustedSources` rule scoped to project
  `prj_xjnrUd3c1x6QidJg0YqTTwyXL3V4` (label "gtm-agent production workflow
  control"), which is exactly `notably/gtm-agent` — i.e. **Notably-PR's own
  agent project**, restricted `production → production`. This is the
  mechanism that lets the Notably agent call its workflows project's protected
  endpoints without the shared-secret bypass.
- **`gtm-eliasstravik-workflows`** has **no `trustedSources` rule at all** (the
  key is absent from the project payload). Cross-project calls from
  `gtm-agent-stravik` presumably rely solely on the `GTM_WORKFLOW_RUN_SECRET`
  bearer token plus the `protectionBypass` automation-bypass secret set on
  each project, not on OIDC trust.

Both projects are owned within their tenant's own GitHub org/user
(`eliasstravik` and `Notably-PR` respectively) and their own Vercel team, so
there is no cross-tenant ownership question — the asymmetry is that
eliasstravik's stack never had a Trusted Sources rule configured, while
Notably's does.

## Blockers / things to resolve before rolling out generation 14 + a new agent version

1. **No written template-sync runbook.** The `template-0.X.Y` merge-PR
   convention works but isn't documented anywhere in the template repo. Worth
   writing down before repeating it a third and fourth time.
2. **Both workspace repos are on `libVersion: 13`**, so generation-14 rollout
   is a genuine version bump for both, not a partial catch-up.
3. **`~/.gtm/gtm-eliasstravik` local checkout is 21 commits behind remote
   main** — needs a `git pull` before any local rollout work lands on top of
   it; there's no local `gtm-notably` checkout at all, so that tenant's
   workspace repo would need a fresh clone first.
4. **Notably's `gtm-notably-workflows` project has no `SLACK_BOT_TOKEN` /
   `SLACK_CHANNEL_ID`**, unlike eliasstravik's — any generation-14 workflow
   that expects to post to Slack directly from the workflows runtime needs
   those added for Notably, or must route through the agent instead.
5. **Framework preset is unset (`Other`) on both Notably projects** (agent and
   workflows) versus explicit `eve`/`nitro` on the eliasstravik projects. Not
   necessarily broken (build/install commands still resolve to sane
   defaults), but worth setting explicitly before a rollout that depends on
   framework-specific build behavior, to avoid surprises.
6. **eliasstravik's `gtm-eliasstravik-workflows` has no OIDC Trusted Sources
   rule**, unlike Notably's — if generation 14 assumes OIDC trust is the
   security boundary (rather than the shared bearer secret), eliasstravik's
   project needs that rule added first.
7. Tree-level diffs above are structural only (file lists), not verified
   byte-for-byte against template main for shared files — worth a real `git
   diff` pass in a non-worktree-isolated session before merging further
   template updates.
