# Slack workspace initialization: design

Date: 2026-09-02

## Problem

Onboarding a client today requires someone to run the `gtm-workspace` create flow at a keyboard, push the resulting repository to GitHub, and only then deploy GTM Agent against it. The keyboard step exists because the skill's create flow needs `git init` and a push target, and because the agent's bootstrap and skill both treat "connected repository without `ORG.md`" as an error or a refusal.

## Goal

A client's onboarding becomes: create a GitHub repository with "Add a README file" ticked, deploy GTM Agent pointed at it, then say "set up our GTM workspace" in Slack. The agent runs the create intake in Slack and its first approved write adds the workspace to the repository. No local folder, no git on a laptop, no template repository to maintain.

## Decisions

1. **The seed is GitHub's README checkbox, not a template repository.** The README commit gives the repository a `main` branch with a parent commit, so the write tool, its `expectedHead` conflict check, and the atomic commit path stay exactly as they are. A template repository would duplicate the skill's contract files and drift from them. The README sits outside the path contract, so the agent can neither write nor delete it.
2. **"Not set up yet" is a state, not an error.** A connected checkout whose root has neither `ORG.md` nor legacy `org.md` is uninitialized. Bootstrap verification no longer requires the organization file. The mutation preflight enforces the invariant instead: while the checkout is uninitialized, the only permitted write is one whose manifest writes root `ORG.md`.
3. **The skill's create flow runs on the connected repository with substitutions, not as a new flow.** The surface refusal narrows to what changes *which* repository is connected: creating a different repository, import, sharing setup, and whole-repository deletion. A create request for the connected, uninitialized repository runs the existing Create flow with environment-answered substitutions for the keyboard-only steps. The skill already uses this pattern for the durable-write mechanism.
4. **The first saved change is one commit** containing `ORG.md`, `AGENTS.md`, `CLAUDE.md`, and `.gitignore` rendered from the skill templates. The keyboard flow already authorizes the boilerplate on `ORG.md` acceptance; the hosted flow keeps the same rule. The skill stays the single author of the contract files.
5. **Approval boundaries do not move.** The skill's numbered accept loop, then native tool approval, then one atomic commit on `main`. No host-side write at bootstrap. No new tool, no new credential path, no change to sandbox egress.
6. **Explicit repository pinning stays.** `GTM_WORKSPACE_REPOSITORY` and `GITHUB_CONNECTOR` remain deploy-time values. Deriving the repository from the connector's grant was considered and rejected: a change in GitHub App settings must not silently change the write target.

## Out of scope

- Supporting a repository with no commits at all (unborn `main`). The README checkbox makes this unnecessary; a clear bootstrap error tells the deployer what to do.
- Import, sharing setup, and whole-repository deletion from Slack. They still change the connection and stay keyboard-only.
- Any change to the workflow hosting, Turso, or Vercel workflow project setup.
- Automating GitHub connector creation. That is a Vercel Deploy Button limitation; the plan includes a step to re-verify it against current Vercel documentation.

## Affected repositories

| Repository | Role | Change |
| --- | --- | --- |
| `eliasstravik/gtm-skills` | Owns the `gtm-workspace` skill | Create flow gains connected-repository substitutions; surface refusal narrows; eval case; host requirements doc; release 0.2.0 |
| `eliasstravik/gtm-agent` | Reusable Eve template | Bootstrap accepts an uninitialized checkout; preflight enforces ORG.md-first; instructions declare the substitutions; docs; vendored skills 0.2.0 |
| `eliasstravik/eve` | Elias's customized deployment of the template | Port the gtm-agent change preserving local customizations; vendor 0.2.0; redeploy |
| `eliasstravik/gtm-eliasstravik` | Elias's live workspace repository | No file change. Post-deploy verification that doctor, update, and refusal behave as before |

## Host contract the skill relies on

A hosting environment that offers hosted set-up must:

- accept a connected repository whose `main` exists but whose root has no organization file, and expose that checkout to the agent as usual;
- refuse every write to such a checkout unless the write includes root `ORG.md`;
- declare in its standing instructions which Create steps it answers: git present, checkout is the target, no local collision check, no git init or identity, no sharing question, first save carries the contract files;
- keep refusing connection changes exactly as before.

## Client onboarding after this change

1. Create a private repository in the client's GitHub org with default branch `main` and "Add a README file" ticked.
2. Deploy GTM Agent from the Deploy button into the client's Vercel team, install Slack, enter the repository as `GTM_WORKSPACE_REPOSITORY`.
3. Create the GitHub connector, grant only that repository, set `GITHUB_CONNECTOR`, redeploy.
4. Confirm `/eve/v1/health`.
5. In Slack: "Set up our GTM workspace." Accept the proposed `ORG.md`, approve the write. Continue with suborganizations, members, ICPs, personas.
6. Optionally add Turso and the workflow Vercel project later; unchanged.
