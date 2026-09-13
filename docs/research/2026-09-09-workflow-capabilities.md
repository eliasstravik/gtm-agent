# GTM workflow capability audit

Research date: 2026-09-09. Research only; no runtime, skill, deployment, credential, database, or integration changes were made.

## Finding

Extend the existing `gtm-workflow` runtime with a supported durable research-agent stage, explicit tool and skill configuration, and verified event intake. Keep Vercel Workflow as the execution engine. Keep Eve as the Slack authoring and operations interface. Adding an agent stage does not require routing production research through Eve.

Vercel Workflow is general-purpose durable code, not a closed catalog of action types. Its step functions have full Node.js access and can call APIs, use compatible packages, or invoke remote compute. That makes many integrations possible today as custom adapters without making them supported GTM authoring patterns. Distinguish runtime possibility, GTM library support, and Slack operations support.

Sources: [Vercel overview](https://vercel.com/docs/workflows), [bundled workflow/step documentation](/Users/eliasstravik/.gtm/gtm-eliasstravik/workflows/node_modules/workflow/docs/foundations/workflows-and-steps.mdx), [GTM contract](../../agent/skills/gtm-workflow/references/contract.md).

## Baselines inspected

- This `gtm-agent` checkout vendors GTM Skills source commit `2dba6d0f835c092015a78c1e6b1ef331f6ec126e`, workflow library v15, via `skills-lock.json`.
- The separate local `/Users/eliasstravik/dev/gtm-skills` checkout was at `b6867026b7646a7acb6a944be744a06807d6b4d2`, project 0.3.2/library v13. It is not the newest source.
- GitHub upstream `main` resolved to `85fea268ba032674e90d425dc7b1b41f2e195291`, project 0.4.4/library v16. The comparison from the vendored commit contains diagram rendering and delivery changes, version/hash updates, and related checks. It does not add a new agent execution model.
- The vendored workflow scaffold pins `workflow@5.0.0-beta.46` and `ai@7.0.79`; it does not declare `@ai-sdk/workflow` or `@ai-sdk/mcp`.
- The Eve app uses `eve@0.49.1`. Its own MCP connections and web tools are separate from the workflow project's model helper.

Sources: [lock](../../skills-lock.json), [workflow package](../../agent/skills/gtm-workflow/templates/package.json), [upstream comparison](https://github.com/eliasstravik/gtm-skills/compare/2dba6d0f835c092015a78c1e6b1ef331f6ec126e...85fea268ba032674e90d425dc7b1b41f2e195291).

## Capability matrix

“Custom” means possible through authored code, but not a complete supplied integration with validation, accounting, lifecycle, and Slack controls.

| Capability | Current GTM support | Gap or qualification |
| --- | --- | --- |
| Durable steps and restart recovery | Present through Workflow SDK | Paid steps deliberately disable automatic retries unless an attempt is known to be unbilled. |
| Conditions, loops, parallel branches | Present in authored workflows; diagrams understand several explicit patterns | `runRows()` processes rows sequentially. No supplied concurrency-aware row runner and shared spending reservation. |
| API calls and external writes | Custom provider adapters are a supported pattern | No universal connector catalog; credentials and effect semantics must be supplied. |
| Structured model calls | Present through `agent()` | Hosted API mode uses a model call, or search followed by a structured answer. |
| Web search | Limited hosted support | Web mode forces one Exa search and then answers from the result. It is not iterative investigation. |
| Page fetch and interactive browsing | Custom adapters possible | No supplied workflow research toolset or browser session lifecycle. |
| MCP servers | No reusable workflow integration | Eve connections do not transfer. Add client lifecycle, tool selection, execution wrappers, auth, and spending attribution. |
| Skills inside the production agent loop | Absent | Vendored skills instruct the authoring Eve agent. They are not automatically available to workflow model calls. |
| Durable tool-using agent stage | Absent | `WorkflowAgent` integration, tool-step boundaries, results, limits, and validation are needed. |
| Subagents and child workflows | SDK supports them; GTM contract recommends splitting large jobs | No supplied parent/child lifecycle, aggregated budget, result, cancellation, or diagram contract. |
| On-demand starts | Present | Authenticated run endpoint plus deployment revision checks; sandbox real runs remain prohibited. |
| Cron starts | Present | Current route deduplicates by workflow path and UTC date, suppressing later occurrences that day. |
| Durable waits and approvals | Present via `approve`, `checkpoint`, `waitForTrigger`; SDK sleep available | Generic SDK waits are not all represented by the GTM diagram. |
| Cal.com-style webhook starts | Custom implementation required | Current trigger route resumes a known waiting run. It is not a permanent verified event-ingestion endpoint that starts one run per booking. |
| Turso result rows, migrations, cache and spending ledger | Present | Research-agent tool calls must enter the accounting system individually. |
| Spending limits | Present as projections and between-row checks | Not a strict ceiling within an agent row; concurrent calls require reservations or equivalent admission control. Model `maxUsd` is not enforced by every backend. |
| Selective reruns | Present in CLI (`failed`, `empty`, `remaining`, `all`) | Slack control has no dedicated selection action; input preparation and validation must be made explicit. |
| Cancellation | Present for runs and cooperative row adapters | Future child agents, browser sessions and provider jobs need explicit cancellation/cleanup handling. |
| Graphs and inspection | Present through native traces, GTM diagram and run receipts | Dynamic agent tool choices cannot be truthfully predicted by the static source graph. |
| Streams and incremental agent output | SDK supports them | GTM exposes run status and results, not an integrated workflow-agent stream to Slack. |
| Slack delivery | Custom adapter possible; Eve has Slack delivery for Eve sessions | Workflow Slack delivery needs its own credentials/integration and handling of ambiguous send outcomes. |
| Browser/code execution sandbox, files, media | External tools/compute are possible | No supplied execution environment for workflow agents. A skill that runs scripts needs such an environment explicitly. |
| Python workflows and advanced platform routing | Platform supports broader options | GTM's current project contract is TypeScript/Nitro; no managed Python or per-run region selection interface. |

Implementation evidence: [agent helper](../../agent/skills/gtm-workflow/templates/lib/agent.ts), [row runner](../../agent/skills/gtm-workflow/templates/lib/rows.ts), [approval and triggers](../../agent/skills/gtm-workflow/templates/lib/approve.ts), [start route](../../agent/skills/gtm-workflow/templates/server/api/run/%5B...workflow%5D.ts), [CLI and validator](../../agent/skills/gtm-workflow/templates/scripts/gtm.ts), [diagram](../../agent/skills/gtm-workflow/templates/lib/diagram.ts), [Slack workflow controls](../../agent/tools/operate_gtm_workflow.ts).

Platform evidence: [WorkflowAgent](https://ai-sdk.dev/v7/docs/agents/workflow-agent), [AI SDK 7 capabilities](https://vercel.com/changelog/ai-sdk-7), [MCP](https://ai-sdk.dev/docs/ai-sdk-core/mcp-tools), [skill loading](https://ai-sdk.dev/cookbook/guides/agent-skills), [Browserbase tools](https://ai-sdk.dev/tools-registry/browserbase), [child workflow start patterns](https://github.com/vercel/workflow/blob/main/docs/content/docs/v5/foundations/starting-workflows.mdx), [Vercel workflow concepts](https://vercel.com/docs/workflows/concepts).

## Proposed changes in gtm-skills

### 1. Preserve simple model calls; add a durable agent stage

Keep the current `agent()` behavior for short classification and extraction. Add a separate, explicitly named helper backed by `WorkflowAgent` for iterative research. Its public contract should define instructions, model, input/context, structured result schema, permitted tools, selected skills, and limits.

This is a workflow-level operation that contains durable model/tool steps. Do not put the entire durable agent inside a single `"use step"` function. It can be one business stage in the overview while exposing actual model/tool executions in native traces.

Update the existing instruction that every model call must use the current `agent()` helper to admit the new managed path. Both paths should share accounting semantics. Do not route a whole research agent through the old helper as if its total cost and all tool effects were one simple provider response.

Pin and verify a compatible `@ai-sdk/workflow`/`@ai-sdk/mcp`/`ai`/`workflow` combination through the source project's runtime-upgrade process. Current documentation establishes feasibility, not compatibility of an untested package combination.

### 2. Add explicitly selected capabilities

Support authored AI SDK tools and remote MCP tools. Package search and page-fetch capabilities; add browser automation only when the workflow requests it. Resolve credentials in the workflow project's trusted runtime, never from model input or the authoring sandbox.

For Monid, selecting `monid_run` alone is not enough to restrict effects: its arguments choose the provider and operation. Enforce the accepted provider/operation scope and call limits at execution, including discovered endpoints. Apply timeouts, cancellation, output size limits, and typed result validation.

Re-create MCP clients in appropriate runtime steps rather than attempting to serialize live connections through workflow boundaries. Browser session identifiers may be persisted, but session expiration and cleanup require explicit handling.

### 3. Package research skills explicitly

Bundle selected, versioned research instructions and resources with the workflow deployment. Expose metadata and a loader to the research agent. Include instruction/tool version identity in cache keys where their changes affect results.

Do not blindly load all GTM lifecycle skills: many ask a human to accept authoring changes, configure a workspace, or deploy code. Extract or select the methods appropriate to execution, such as evidence-backed qualification, and provide the execution tools those methods require. Sharing skill source does not imply sharing Eve state or credentials.

### 4. Extend accounting and unattended authorization

Record model calls and billable tool calls individually, with run, row, business stage, and stable operation identity. Avoid double-counting a research-stage total and the calls that comprise it. Reserve budget before concurrent or potentially costly work and reconcile reported cost afterward.

Where a provider cannot quote or cap cost before execution, expose that limitation rather than describing an estimated `maxUsd` as a hard ceiling. Preserve the current no-blind-retry rule for billed calls. Cache lookups are not a universal mechanism for making external writes idempotent.

An unattended trigger needs an accepted policy covering source/event, destination, permitted effects, per-run limits, aggregate frequency/spending, and disable behavior. Human review should occur when enabling/changing that policy or when execution exceeds it. It should not depend on a Slack user being present for every booking.

### 5. Add a stable event-intake pattern

For Cal.com: public HTTPS route on the workflow deployment; verify the raw-body signature; validate and map the event; deduplicate by source/event/booking identity; record acceptance; start one run; return promptly. Define recovery for a crash between recording an event and starting its run. Use the existing user-owned workflow database if persistence is needed.

The existing per-run trigger hook remains useful for callbacks to already-running work. Do not conflate it with a permanent webhook subscription URL. Deployment protection must allow the intended inbound route without exposing unrelated protected controls. Add schedule occurrence identity for subdaily Cron instead of deduplicating by date alone.

### 6. Teach validation and diagrams about the new execution shapes

The current validator recognizes paid calls to named helpers, requires terminal bookkeeping, and restricts workflow/module-scope execution. The diagram walks statically visible step calls and flags hidden or unreachable steps. A dynamic agent integration must be recognized as an explicit managed operation; merely removing checks would lose existing guarantees.

Show “Research lead” as a declared stage, link it to actual runtime tool traces, and report uncertainty about future calls and cost in dry runs. Add explicit support for durable sleep, child workflow boundaries, and parent/child status where introduced. Keep the native Vercel trace as the detailed execution record.

## What must change in gtm-agent

1. Sync the accepted source release with `pnpm skills:sync /path/to/gtm-skills`. This updates vendored instructions/templates and `skills-lock.json`; never edit vendored files directly.
2. Extend workflow preview/receipt handling to describe agent tools, skill selection, limits, side effects, and unknown cost. Current start authorization compares row count and projected cost, which is insufficient as the entire policy for a variable tool loop.
3. Add operational controls only as needed: enable/disable event intake, inspect trigger state, submit an accepted trigger payload, and select rerun rows. Preserve fixed repository/deployment targeting and existing approval boundaries.
4. Keep runtime credentials on the workflow Vercel project. The authoring sandbox remains unable to start a paid run or receive model/MCP/browser secrets. Monid on the Eve app is optional and does not equip workflow agents.
5. Upgrade each connected workspace's generated workflow runtime and migrate its schema through the existing reviewed save/deployment process. Syncing `gtm-agent` alone does not update already-generated workspace code, install secrets, or register Cal.com webhooks.

The pure workflow design preserves Slack as Eve's authored communication channel. Cal.com's route lives in the workspace workflow project, so it does not require adding an Eve webhook channel. It also preserves the separate user-owned Turso database and Git-connected workflow deployment.

Sources: [sync implementation](../../scripts/sync-gtm-skills.mjs), [workflow host controls](../../agent/lib/workflow-control.ts), [sandbox policy](../../agent/lib/workflow-session.ts), [repository boundaries](../../AGENTS.md), [agent operating instructions](../../agent/instructions.md).

## Suggested release sequence

1. Ship one complete booking-research path: verified Cal webhook, bounded WorkflowAgent, selected Monid and web tools, explicitly bundled research instructions, persisted brief and Slack delivery. Include truthful agent-stage diagrams and accounting in this first slice.
2. Generalize the proven implementation into reusable agent definitions, skills, event sources and delivery adapters. Add browser sessions when page fetch/search are insufficient.
3. Add concurrency-aware row processing, managed child agents/workflows, subdaily schedule identity, richer rerun controls, and streaming only for demonstrated use cases.

Do not aim for an exhaustive mirror of every Vercel feature. Keep ordinary TypeScript steps and adapters available for bespoke business operations, within the existing authorization and accounting contract. Python hosting, multi-region controls, general code-execution agents, and arbitrary artifact storage are separate decisions, not prerequisites for booking research.

## Validation needed before release

- Fixture-based model and MCP tests: correct inputs, tool restrictions, failures, malformed output, and cost attribution without paid calls.
- Workflow recovery tests: interruption between model/tool steps, duplicate events during/after completion, accepted-but-unrecorded starts, cancellation, and expired browser sessions.
- Budget tests: several calls within one row, concurrent calls, unknown billing, and denied scope; prove that retries do not automatically repeat billed work.
- Persistence/delivery tests: migration integrity, saved research before notification, and ambiguous Slack delivery. No claim of exactly-once external effects without provider support.
- Diagram and validator tests: managed agent stage accepted, actual dynamic tools not invented in the static graph, unsafe unwrapped paid operations rejected.
- Authoring tests: sandbox dry-run performs no MCP connection, browser launch, paid call, or external write.
- Complete the source release checks and `gtm-agent`'s `pnpm check`; use explicitly selected preview targets before any authorized live evaluation.

No builds or live evaluations were run for this audit. The conclusions describe inspected code and documented platform capabilities, not a tested implementation.
