# Feedback breakdown: GTM Agent and GTM Skills UX

Date: 2026-09-10. Status: breakdown for review, no code changed.

Baselines inspected: `gtm-agent` on branch `chore/skills-0.4.1` (vendors GTM Skills 0.4.1, workflow library v15), `gtm-skills` on `main` at 0.5.3 (library v20), Eve 0.49.1, AI SDK 7.0.83.

Each item below has: what was asked, what the code does today, the gap, the proposed change with the files it touches, and any decision that only the owner can make.

## Cross-cutting facts

- **Version drift.** The agent vendors skills 0.4.1 (v15). Skills `main` is 0.5.3 (v20) and contains fixes that match the "workflows not working" complaint: build-time runtime initialization (0.5.1, #84), MCP lookup failures preserved with diagnostics (0.5.2, #85), and migration prompts no longer blocking hosted agents (0.5.3, #87). The first step for several items is a skills sync, not new code.
- **Two repos, one contract.** Skill text (`SKILL.md`, `references/*.md`) is owned by `gtm-skills` and synced into `agent/skills/`, never hand-edited. The host contract that the agent must satisfy is `gtm-skills/docs/gtm-agent-requirements.md`. Any wording change to user-facing messages lands in `gtm-skills` first, then `agent/instructions.md`.
- **One environment variable name, two meanings.** `GTM_AGENT_MODEL` selects the Slack agent's model in the Eve deployment and, separately, the workflow runtime's `agent()` model in the Vercel workflow project. They are different deployments so they can differ today, but the shared name invites mistakes. Item 2 proposes renaming the workflow one.

## 1. DeepSeek V4.1 Flash with high reasoning as the default model

**Asked.** Make DeepSeek 4.1 Flash with high reasoning the default wherever a default model is set or mentioned.

**Today.**

| Place | Current default |
| --- | --- |
| `gtm-agent/agent/lib/config.ts:6` `DEFAULT_AGENT_MODEL` | `openai/gpt-5.6-sol` (root agent and `source_editor` subagent) |
| `gtm-agent/.env.example` lines 12 to 15 | comment names `openai/gpt-5.6-sol` |
| `gtm-agent/agent/agent.ts` | `defineAgent({ model })`, no `reasoning` set |
| `gtm-skills/skills/gtm-workflow/templates/lib/agent.ts:168,199,318` | `anthropic/claude-opus-5` for the `api` backend; docblock says the same |
| `gtm-skills/skills/gtm-workflow/templates/.env.example` | `GTM_AGENT_MODEL=` empty |
| Durable agent stages (`lib/durable-agent.ts`, `lib/capabilities.ts`) | no default; each `AGENTS` definition names its own model |
| Eval evidence files under `evals/*/evidence/` | record `gpt-5.6-sol` as the executor used; these are records, not defaults, leave them |

**Verified gateway facts.** The catalog lists `deepseek/deepseek-v4.1-flash` (tags: reasoning, tool-use, implicit-caching, vision; 1M context; `reasoning` in supported parameters; `reasoning_options` not specified). Price is $0.15 in / $0.60 out per million tokens with a 2x peak multiplier on weekdays 01:00 to 04:00 and 06:00 to 10:00 UTC, which is 08:00 to 12:00 in Stockholm during the working morning. DeepSeek documents V4.1 Flash effort as a 1 to 100 scale; the gateway maps the shared AI SDK 7 `reasoning: "high"` level to the serving provider, and any reasoning key under `providerOptions` overrides it.

**How to set it.**

- Eve: `defineAgent({ model: "deepseek/deepseek-v4.1-flash", reasoning: "high" })`. The public agent definition already exposes `reasoning` (`node_modules/eve/dist/src/shared/agent-definition.d.ts:266`).
- Workflow runtime `viaApi()`: pass `reasoning: "high"` to each `generateText` call, and read the default from a new constant.
- Keep the env override but default it to the new model in both `.env.example` files.

**Risks and follow-through.**

- `config.ts` says the prompt rules were tuned against one model. `agent/instructions.md` and the skills' evals were graded with `gpt-5.6-sol`. Rerun `pnpm eval` in `gtm-agent` and the skills evals after the switch, and treat regressions in the approval-text rules (closing lines, no yes/no questions) as the likely failure mode.
- Verify reasoning actually engages by checking `usage.outputTokenDetails.reasoningTokens` on one call; a successful request alone does not prove the effort level.
- Note the peak-pricing window in `docs/getting-started.md` so nobody is surprised by doubled morning costs.

**Touches.** `agent/lib/config.ts`, `agent/agent.ts`, `.env.example`, `tests/config.test.mjs`; `gtm-skills` `templates/lib/agent.ts`, `templates/.env.example`, `references/agents.md` where the api default is described, then a skills sync.

## 2. One model for the agent, any model per workflow

**Asked.** The Slack agent runs on one model; workflow code must be able to pick a model per workflow or per call, fully flexibly. Leave it alone if already true.

**Today.** Partly true.

- Durable agent stages are already per-agent: `AGENTS` definitions carry `model` (`lib/capabilities.ts:46`) and `durableAgent` uses `spec.model`.
- Plain `agent()` calls are not: `AgentInput` in `templates/lib/agent.ts:19` has no `model` field, and line 199 resolves the model from `process.env.GTM_AGENT_MODEL` for the whole deployment. Every ordinary model step in every workflow shares one model.
- The Eve agent and the workflow project are separate deployments, so they can already run different models; nothing forces them to match.

**Gap.** `agent()` needs a per-call model. The env var name is shared with the Slack agent.

**Proposed change.**

- Add optional `model?: string` and `reasoning?: ReasoningEffort` to `AgentInput`. Precedence: call argument, then workflow env default, then the library default from item 1.
- The provider cache key already includes `endpoint: "<backend>/<model>"`, so a model change invalidates cached results correctly. Keep that.
- Rename the workflow-side variable to `GTM_WORKFLOW_MODEL` and keep `GTM_AGENT_MODEL` as a deprecated alias for one library generation, so existing Vercel projects keep working.
- Surface the chosen model in the dry run and the diagram card (`diagram.ts:481` already tags model steps) so the run proposal states which model each paid stage uses.
- Update the workflow contract (`references/contract.md` paid calls section) and `references/agents.md` to show the per-call form.

**Touches.** `templates/lib/agent.ts`, `templates/.env.example`, `references/contract.md`, `references/agents.md`, `templates/lib/diagram.ts`; library generation bump and hash update; then sync.

**Decide.** Whether the per-call model must be declared in the workflow header so the save proposal can state it, or whether stating it in the run proposal is enough.

## 3. Non-technical, concise replies

**Asked.** Say "Save" not "Commit". Talk in outcomes and decisions, as little as possible about inner workings. Aim for under 280 characters unless truly necessary.

**Today.** The shared interaction standard (`gtm-skills/skills/gtm-workspace/references/interaction.md`) already bans git, commit, push, PR, branch, hash, paths, tool names and host names, and says every message is the shortest text that names every artifact and effect, with a 12-line body cap. `agent/instructions.md:3` says "concise and decision-oriented". So the vocabulary rule exists; the length rule is loose, and several leaks remain:

- Failure and unknown-outcome messages are explicitly allowed to "keep precise wording" and the host instructions dictate technical ones: "migrations were already applied but the commit failed", "ledger verification failed", "this thread is stale, a fresh Slack thread is required", "the repository must be inspected before any retry".
- Outcome reports carry cache hits, estimate versus actual with a reason, cost sources (`reported | fixed | projected`), and hit-rate math. Useful to an operator, heavy for a non-technical reader.
- Approval text may run to 2,500 characters by contract.
- Agent-source proposals show a full diff in Slack and speak of draft PRs. This is an admin flow and may be acceptable as is.

**Proposed change.**

- Add a length rule to `interaction.md`: an ordinary message targets 280 characters and never exceeds about 500; a proposal or approval text is as short as it can be while naming every artifact and effect (it stays exempt from the 280 target because the contract requires exact scope); a run or checkpoint report is one headline line plus at most two numbers, with the full breakdown on request.
- Add a plain-language failure table to the standard, and mirror it in `instructions.md`: "Saved.", "Couldn't save. Nothing changed.", "Saved, but I can't confirm it landed. Don't retry yet, I'll check.", "Live.", "Not live yet."
- Remove the "precise wording" exemption for user-facing failure text; keep precision in tool results and logs.
- Extend `tests/instructions.test.mjs` to fail when a quoted user-facing string in `instructions.md` contains a banned word (commit, SHA, ledger, checkout, migration, repository, thread is stale).
- Add a grader to the skills evals for message length and banned vocabulary.

**Touches.** `interaction.md`, `gtm-workflow/references/conversation.md` (outcome reports), `docs/gtm-agent-requirements.md` items 6 and 7, `agent/instructions.md`, `tests/instructions.test.mjs`, eval graders.

**Decide.** Whether the 280-character target also applies to approval text. Recommendation: no, because the approval must state exact scope; apply "as short as possible" there and the 280 target everywhere else.

## 4. Deploy monitoring with a follow-up message

**Asked.** Never say "ask me to check again". Say "I'll follow up when it's live", then post the follow-up in the same thread. On error, try to handle it and report.

**Today.** The exact phrase "It will be live in production in a few minutes; ask me to check." is contract text in seven places: `agent/instructions.md:14,41`, `interaction.md` Closing, `conversation.md:41`, `flows.md:57`, `deploy.md:43`, and `gtm-agent-requirements.md` item 6. Runs have the same shape: `SKILL.md:54` says report a still-active run and "offer to check again", and `instructions.md` says "Poll with the status action".

Mechanics that exist: `operate_gtm_workflow` has a read-only `deployment` action (instant SHA compare) and the `start` action already polls `/api/deployment` for up to 8 minutes at 2-second intervals inside the turn (`workflow-control.ts:20-21`). Nothing runs after the turn ends. The agent has no Vercel API access by design (`AGENTS.md`), so it cannot read build logs; a failed build simply never becomes live.

**Eve primitives available (0.49.1).**

- Background tools: `execution: "background"` with a `TaskExec` capability. The tool returns a receipt (`status: "working"`, `taskId`), the durable task completes later through `send({ kind: "complete" })` or an external executor binding, and completion wakes the agent, which can then post into the same Slack thread. This is the right fit.
- Schedules: `defineSchedule({ cron, run({ to, waitUntil, appAuth }) })` can proactively `to(slack, target).send(...)`. Good for a periodic sweep, but it needs somewhere to store pending watches, and `AGENTS.md` forbids an agent-owned database.
- A provided `sleep` tool exists but blocks the turn.

**Proposed change.**

- New background tool `watch_gtm_deployment` (input: the saved commit, the workflow name). Host-side it polls `/api/deployment` until the SHA is live or a deadline passes, then completes the task. On wake, the agent posts "Live." or "Not live after 10 minutes. Nothing ran. I'll look into it." in the same thread.
- New background tool `watch_gtm_run` for hosted runs: completes on checkpoint reached, completed, failed, cancelled. Replaces polling and "offer to check again". At a checkpoint it posts the checkpoint approval card automatically.
- Replace the closing sentence everywhere with "Saved. I'll follow up here when it's live." and update contract item 6 accordingly.
- Error handling within the current boundary: when the deadline passes, rerun `gtm check` and `npm run build` in the sandbox on the saved commit and report the first failure in plain words. That covers build breaks the sandbox can reproduce. It cannot cover Vercel-side failures such as a missing environment variable or a platform error.

**Spike first.** Confirm how an Eve background task survives Vercel function time limits (the workflow project is capped at 300 seconds on the lowest plan; the Eve host may be too). If a single task cannot poll for 8 minutes, chain short tasks through the executor binding or use a one-minute schedule that re-arms outstanding watches from Eve's own task state, not a new database.

**Touches.** `agent/tools/watch_gtm_deployment.ts`, `agent/tools/watch_gtm_run.ts`, `agent/lib/workflow-control.ts` (share the poll loop), `agent/instructions.md`, `agent/lib/slack-diagram-post.ts` (post the run picture on completion), tests; skills `interaction.md`, `conversation.md`, `flows.md`, `deploy.md`, `SKILL.md:54`, `docs/gtm-agent-requirements.md`.

**Decide.** Whether to add a host-only, read-only Vercel token so the agent can read deployment status and build logs. Today the boundary is "no Vercel token anywhere". Without it, the follow-up on failure can only say "not live" plus what the sandbox could reproduce.

## 5. Links and diagram as early as possible, an ELI5 diagram, updates in the thread

**Asked.** On the first message where the agent has a draft, share the workflow link (local or Vercel), the data link (Drizzle or Turso), and the diagram page, plus the diagram screenshot in Slack. The diagram must be understandable by someone with no context. Post new screenshots in the thread as the workflow changes.

**Today.** PR #21 and skills 0.4.x added the "Where to look" block (Diagram, Runs, Data) and the picture upload. The moments table in `flows.md` says: Create shows a draft picture with the save proposal and the link block only after `Saved.` (hosted: after `Live.`). So links are deliberately late today. Three constraints explain that:

- The signed diagram page and PNG are served by the workflow's production project, so they exist only for a deployed workflow. A draft lives in the sandbox scratch directory.
- The Runs link (Vercel observability) and the Data link (Turso dashboard) are derived from configuration (`diagram-link.ts`), so they can be posted at any time, including before the first save.
- The hosted contract forbids text in the message that carries the approval call, so the picture must be posted in an earlier message.

Also from the untracked review (`docs/superpowers/plans/2026-09-09-agent-final-review.md`, M6): the picture arrives one message before the caption because the channel posts on `action.result`.

**About "Mermaid page".** The interactive page is an SVG rendered from a dagre layout (`diagram-page.ts`, `diagram-svg.ts`, `layout.ts`); Mermaid is only a text output of the CLI (`diagram-text.ts` `toMermaid`). I read the request as "the diagram page", not literal Mermaid.

**Proposed change.**

- **Draft picture without deployment.** The host already has the pieces to render a PNG itself: `gtm diagram <slug> --format json` in the sandbox yields the graph, and the templates ship the dagre layout, the SVG renderer, and the Inter font. Add a host-side render path (read the PNG or the JSON from the sandbox through Eve's sandbox file API, upload to Slack) so the first message with a draft carries the picture. The signed page link follows once the workflow is live; the Data and Runs links post immediately.
- **New moments table.** "First draft ready" becomes a moment: picture plus Data and Runs links, then the approval card. "Draft changed" posts a new picture in the same thread with a one-line "what changed" caption. "Live" posts the Diagram link. Runs keep their existing moments.
- **ELI5 diagram.** The extractor already labels steps from JSDoc and decisions from comments. Add: a one-line summary strip at the top ("Every weekday 09:00: find new posts, score each against the ICP, save matches to the table"); numbered steps in run order; each paid step shows the provider and cost per row; edges from decisions read as yes/no questions; the save node names the table in business words; a legend for the four status markers. Enforce in `gtm check` that step labels are verb phrases and decision labels are questions (currently a NICE TO HAVE in `review-checklist.md`; move to MUST FIX).
- **Threading.** Slack threads are one level deep, so "a thread of the diagram" means the same conversation thread. Post each new picture as a reply with the change caption; optionally edit the first diagram message to say "superseded, see below".

**Touches.** `agent/lib/slack-diagram-post.ts`, `agent/lib/workflow-control.ts` (draft render action), a new `agent/lib/diagram-render.ts`, `agent/instructions.md`; skills `flows.md` moments table, `conversation.md` diagram section, `templates/lib/diagram*.ts`, `templates/scripts/gtm.ts` (`check`), `references/contract.md` house rules, `review-checklist.md`.

**Decide.** Whether the draft picture should be rendered by the host (recommended; no deployment needed) or by a preview route on the workflow project (needs the project to be live first, which defeats the purpose for a first create).

## 6. Real testing, limited end-to-end runs, dry runs, cost approval

**Asked.** Workflows keep failing; the agent must test properly, including limited end-to-end runs and dry runs, and ask before spending.

**Today.**

| Tier | What it covers | Cost |
| --- | --- | --- |
| `gtm check` | Nitro build, workflow validate, export and input rules, table and migration artifacts, diagram rules, managed-file hashes | none |
| `npm run build` runtime check (0.5.1) | compiled bundle initializes without credentials; catches Node-only imports | none |
| Dry run | input parse, row count, stages, projected cost, caps; explicitly does not call providers, check table existence, or test credentials | none |
| Provider fixtures | adapter fixtures, SHOULD FIX only | none |
| First real run, checkpoint after 3 rows | the actual end-to-end test, approval-gated with projected cost | 3 rows |

The failures that get through are the ones between dry run and first real run: missing or wrong credentials on Vercel, a table that was never migrated, a provider response that does not match the adapter, and runtime imports. Several were fixed upstream after 0.4.1 (see cross-cutting facts).

**Proposed change.**

- **Sync first.** Adopt skills 0.5.3 in the agent; that alone removes three known failure sources.
- **Preflight route.** Add a bearer-protected `GET /api/preflight/<workflow>` to the templates that checks, on Vercel: every environment variable the workflow's adapters name is present, the result table exists, each provider's cheapest auth check succeeds where the provider offers a free one. The trusted `preview` action calls it and the run proposal states "credentials and table verified" or names the missing piece. No spend.
- **Smoke run by default.** After "Live.", propose a 1-row real run with its cost in the same message as the follow-up, or fold it into the save approval as one decision ("Approve to save and test with 1 row for about $0.02"). This is the limited end-to-end test. It uses the existing start action with the checkpoint set to 1.
- **Fixture replay in the sandbox.** Where an adapter has fixtures, run the row step against fixtures inside the sandbox before the save proposal, as part of `gtm check`. This catches adapter shape errors at no cost. Needs a `GTM_PROVIDER_MODE=fixture` switch in `provider.ts`.
- **Cost rule.** Anything free runs without asking. Anything that spends is one approval that states the cost, batched per item 8.

**Touches.** Skills templates (`server/api/preflight`, `provider.ts`, `scripts/gtm.ts`), `references/flows.md`, `references/deploy.md` Verify section, `review-checklist.md`; agent `workflow-control.ts` preview, `instructions.md`.

**Decide.** Whether the smoke run is bundled into the save approval (one click, saves plus spends) or stays a separate approval after "Live." Recommendation: separate, because save is free and the run is not, but post it automatically so the user only clicks.

## 7. No JSON in approval messages

**Asked.** Approve and Cancel messages must never include the JSON of what the tool is doing.

**Today.** `agent/lib/slack-approval-cards.ts` renders the two GTM tools (`apply_gtm_workspace_changes`, `operate_gtm_workflow`) from `summary` only. Every other tool approval falls through to `buildGenericInputRequestPost`, which shows Eve's default prompt ("Approve <tool name>?") plus a collapsed "Tool input" container holding the raw input as JSON (lines 150 to 170). That is where the JSON comes from. Today the only authored tool on that path is `publish_source_change`; any Eve provided tool or connection with an approval policy would land there too.

**Proposed change.**

- Delete the JSON container.
- Require every approval-gated tool to supply plain approval text. `publish_source_change` can reuse the proposal summary it already writes into the PR body.
- For a tool without a summary, render a fixed sentence from a per-tool map ("GTM Agent wants to search the web for <query>") and refuse to post an approval with no human text (see item 8).
- Add tests for the fallback path in `tests/slack-approval-cards.test.mjs`.

**Touches.** `agent/lib/slack-approval-cards.ts`, `agent/subagents/source_editor/tools/publish_source_change.ts`, tests.

## 8. No empty approvals, no one-at-a-time approvals for routine calls

**Asked.** Never send an approve/cancel with no clear description. Do not ask for approval for one-off calls while working. Ask only when necessary or when there is a real cost, and bundle the whole batch of upcoming actions into one request.

**Today.** Approval-gated in `gtm-agent`: the workspace save, run start, checkpoint decision, live-run cancel, and the source-editor publish. Eve's provided tools (bash, web search, web fetch, read and write file) show no approval policy in their definitions. The agent has no `agent/connections/` directory, so no MCP connections are defined in this repository; I could not find in code what produced the one-off MCP approvals. Candidates: connections added in a deployment I did not inspect, Eve's connection registry defaulting to approval for a connection whose `approval` is unset, or the workflow durable agents' MCP tools (those run on Vercel, not through Slack).

**Proposed change.**

- **Policy table in the agent.** Read-only tools and connections: `never()`. Effectful or paid tools: `always()` with mandatory approval text. Session-scoped grants for repeated safe calls: `once()`.
- **Plan approvals.** Before a test or a multi-step operation, one approval lists every call it will make and the total cost ("Run the 1-row test: 2 provider calls, 1 model call, about $0.02"). Implement as a custom `Approval` callback that checks whether the session holds an accepted plan covering the tool and input, so later calls in that plan do not prompt. Eve's `ApprovalContextInput` gives the callback the tool input; the accepted plan can live in session state written by the plan tool.
- **Guard.** The Slack `input.requested` handler refuses to post an approval whose text is empty or equals Eve's default "Approve <tool>?" and instead returns a denial to the model with the reason, so the model re-asks with text.
- Add to `instructions.md`: when a task needs more than one approval-gated call, ask for the plan first.

**Touches.** `agent/lib/slack-approval-cards.ts`, `agent/lib/approval-summary.ts`, a new `agent/lib/approval-plan.ts`, tool definitions, `agent/instructions.md`, tests.

**Decide.** Which deployment produced the MCP approvals, so the policy can be checked against a real connection definition.

## Suggested order

1. Sync skills 0.5.3 into the agent (unblocks 6, removes known failures).
2. Items 7 and 8, agent only, small, immediate UX win.
3. Items 1 and 2, both repos, small, then rerun evals.
4. Item 3, skills text plus agent instructions plus tests.
5. Item 4, after the background-task spike.
6. Item 5, both repos, largest.
7. Item 6, both repos, builds on 4 and 5.

## Open questions

1. "Mermaid page": the existing interactive diagram page, or literal Mermaid rendering?
2. Allow a host-only, read-only Vercel token for deployment status and build logs, or keep the no-Vercel-token boundary?
3. Does the 280-character target apply to approval text, which must name every artifact?
4. Smoke run: bundled into the save approval, or a separate approval posted automatically after "Live."?
5. Which deployment produced the one-off MCP approvals?
6. "New screenshots in a thread": same conversation thread with a change caption, or edit the original diagram message?
