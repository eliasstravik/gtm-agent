# Slack workflow controls

The host uses GTM Skills 0.7.0, workflow library generation 22, and Eve 0.52.5.
The root agent and source editor default to DeepSeek V4.1 Flash with high
reasoning. `GTM_AGENT_MODEL` overrides their model together. The workflow
project's `GTM_WORKFLOW_MODEL` is a separate setting.

Update the connected workspace's managed workflow files to generation 22 before
using trusted preview or start. Older deployments have no preflight route and
are refused. Existing workflow projects may keep their model override by moving
it to `GTM_WORKFLOW_MODEL`; generation 22 still reads the deprecated
`GTM_AGENT_MODEL` alias. Unset overrides use the new default.

## Approval scope

Free checks, status, preflight, and pictures require no approval. A workflow
start approves every paid stage and external effect in that run. The start
request carries the preview's rows, estimated cost, paid stages, execution
limits, and agent capabilities hash. Preflight and a repeated dry run reject
changed scope before a start.

`approve_gtm_plan` covers fully specified workspace saves, workflow starts,
and supported calls on an existing Monid connection. The card includes each
call's human summary and the summed estimated cost. Grants live in Eve session
state, bind the requester and exact input, and allow each call once in order.
They do not authorize source publication, checkpoint decisions, or callbacks
whose scope is not yet known. A failed operation requires reconciliation before
continuing. No plan state enters the sandbox or a separate database.

Deployments that already declare `agent/connections/monid.ts` should import
`connectionApproval` from `../lib/connection-approval.ts` and use it as their
connection's `approval` callback. Keep the deployment's URL, auth, and allowlist.
The policy permits known reads and requires a plan for runs, external resource
access, release, and stopping a run. It rejects tools without a reviewed policy.
Inspect pricing before proposing a connection call. `once()` is reserved for
operations explicitly classified safe; it cannot authorize repeated spending.

## Draft and live pictures

Create `draft-diagram.json` with the managed diagram command in the fixed scratch
workflow directory. `render_gtm_draft` reads bounded files through Eve's sandbox
file API and uses the pinned managed layout, PNG renderer, and bundled font on
the host. It posts the caption, picture, Data link, and Runs link before approval.
The native PNG dependency stays external to the Eve bundle and is traced into
the host output.

For the live follow-up, call the diagram action with `caption: "Live."`.
An explicit caption posts immediately with the picture and links. This matters
because ordinary text accompanying tool calls is not a delivered Slack reply.

## Durable watches

Ordinary `defineTool` background code still runs inside its initiating step.
The watches instead use `defineWorkflowTool`, `execution: "background"`, and
Workflow SDK `sleep`. Each network read runs in a short `use step` function.
The timer suspends compute and persists the wait, so a ten-minute watch does not
hold one Vercel invocation open. The task's parent session owns its original
Slack channel and thread timestamp; model input cannot retarget it.

Deployment watches stop after ten minutes or after the exact saved version and
preflight succeed. Run watches stop at a checkpoint or terminal result. Results
wake the parent agent to post the outcome, request checkpoint approval, or
propose the separate one-row smoke run. After continuing a checkpoint, copy the
previous watch's `checkpointIdentity` into `afterCheckpoint` to avoid reporting
the old pause while the workflow resumes. Session admission suppresses duplicate
watches for the same version or checkpoint.

The model performs timeout investigation in its sandbox on the saved version.
The watch itself has no sandbox and cannot deploy, start a real run, or obtain
a Vercel deployment token.

See [Eve workflow tools](https://eve.dev/docs/tools/workflows) for the durable
execution contract. Build validation and local polling tests do not prove
delivery on a deployed Slack installation; verify that separately on a test
target, including reasoning-token usage, readiness, smoke approval, checkpoint
approval, and both screenshots and a recording.
