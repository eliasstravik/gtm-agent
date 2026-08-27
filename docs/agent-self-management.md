# Agent self-management

## Current decision

The production agent may propose narrowly scoped changes to its own instructions
and direct native schedule files through the declared `source_editor` subagent.
The editor is available only to configured Slack user IDs. It receives an
independent, credential-free sandbox containing the exact deployed revision of
one configured source repository.

The editor freezes the complete diff in durable child-session state and returns
it for a numbered Slack accept loop. Only a later turn in that same child session
can invoke the approval-gated publisher. The publisher recaptures the checkout,
requires an identical integrity hash, verifies that remote `main` still equals
the deployed revision, and creates one `eve-self-modification/` branch plus a
draft pull request using a short-lived Vercel Connect token.

The publisher has no update-to-`main`, merge, approval, retarget, close, or
deployment operation. Use an external coding session for every source surface
outside the narrow allowlist.

The source checkout uses the concrete sandbox path
`/workspace/.eve-source/<repo>`. Source tools accept only repository-relative
allowlisted paths, so shell-only `$HOME` expansion never crosses into the
sandbox file API. Deleting an already absent schedule and previewing an
unchanged checkout are successful no-ops that must be returned to Slack.

## Implemented flow

1. Verify that the requester is an allowed Slack principal.
2. Give the dedicated editor an isolated checkout of the configured source
   repository at the exact deployed revision. Keep publication credentials
   outside that sandbox.
3. Capture the complete diff from the checkout. Repository, branch, base commit,
   paths, and file contents come from trusted configuration and captured Git
   state, not model input.
4. Show the exact proposal and require native approval for that proposal.
5. Use a short-lived, repository-bound GitHub App token to create one namespaced
   branch and draft pull request.
6. Run repository CI and a Vercel preview on the pull request.
7. A human reviews and merges. The normal Git connection deploys `main`.

The publisher is complete when the draft pull request exists. It cannot update
`main`, merge, approve, retarget, close, or deploy.

## Ownership

| Requested change | Durable owner | Production path |
| --- | --- | --- |
| Agent instructions or native Eve schedule | Agent source repository | Draft pull request |
| GTM skill behavior | `gtm-skills` | Change the source skill, then sync the vendored copy in a separate agent pull request |
| Organization, ICP, persona, member, or saved GTM workflow | Connected GTM workspace | Existing workspace preview and approval flow |
| Tool, channel, connection, sandbox, dependency, or auth policy | Agent source repository | Draft pull request with security review |
| Self-management allowlist, publisher, approval policy, or branch protection | External owner-controlled workflow | Never through the self-management publisher |

Static native schedules are agent source. If a product later needs instant
schedule CRUD without deployments, adopt Eve's documented dispatcher pattern:
one static minute-level schedule, tenant-scoped CRUD tools, and a durable store
with atomic leases. That is a separate database-backed feature, not a source
editing shortcut.

## Configuration

Self-management is disabled unless all three application settings are present:

- `EVE_SOURCE_GITHUB_CONNECTOR`: a Vercel Connect GitHub connector installed only
  on the agent source repository;
- `EVE_SOURCE_REPOSITORY`: the exact `owner/repo` that produced the deployment;
- `EVE_SOURCE_ALLOWED_SLACK_USER_IDS`: a comma-separated allowlist of exact Slack
  user IDs.

Vercel supplies `VERCEL_GIT_COMMIT_SHA`; local tests may use
`EVE_SOURCE_DEPLOYED_SHA`. The feature fails closed when repository identity,
caller identity, deployed revision, current `main`, allowed paths, frozen diff,
or approval identity does not match.

The official Eve production package is still unreleased. This implementation is
an intentionally narrow application-owned bridge following the upstream design.
Reassess it when Eve ships the production package; do not silently expand its
paths or authority in the meantime.
