# Agent self-management

## Current decision

The production agent may discuss changes to its own behavior, but this repository
does not give it a source publisher. A sandbox file edit changes only that
session. It does not change GitHub or the deployed agent.

Use an external coding session for agent-source changes until Eve ships its
production self-modification package. Do not add a generic Git shell, a direct
write to `main`, or a deployment tool as a substitute.

## Target flow

When the official production feature is released, self-management should work as
follows:

1. Verify that the requester is an allowed Slack principal.
2. Give a dedicated editing subagent an isolated checkout of the configured
   source repository and exact deployed revision. Keep publication credentials
   outside that sandbox.
3. Capture the complete diff from the checkout. Repository, branch, base commit,
   paths, and file contents come from trusted configuration and captured Git
   state, not model input.
4. Show the exact proposal and require native approval for that proposal.
5. Use a short-lived, repository-bound GitHub App token to create one namespaced
   branch and draft pull request.
6. Run repository checks and a Vercel preview on the pull request.
7. A human reviews and merges. The normal Git connection deploys `main`.

The publisher is done when the draft pull request exists. It cannot update
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

## Adoption gate

Enable production self-management only after the official Eve package is released
and this repository has tests for verified principal access, allowed paths,
captured-diff integrity, exact-proposal approval, draft-only publication, CI, and
preview deployment. The self-management path must not be able to change its own
authority.
