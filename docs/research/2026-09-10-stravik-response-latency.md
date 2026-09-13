# Stravik agent response latency, 10 September 2026

The measured delay comes primarily from excessive model and tool rounds before answering. The prompts ask for broad investigation even when the user needs a greeting, a workflow list, or an initial design decision. Sandbox preparation adds a smaller fixed delay. Production model selection and reasoning effort deserve a separate benchmark; changing the model alone leaves the unnecessary work in place.

This investigation read Vercel runtime logs, Agent Runs traces, deployed-revision source, local framework documentation, and public AI Gateway endpoint metrics. It changed no application code or production settings and started no paid agent runs.

## Measured examples

Times below are UTC. Add two hours for Stockholm.

| Request | Evidence | Measured behavior |
| --- | --- | --- |
| Create LinkedIn Connections to Contacts+Companies Enrichment | `wrun_41M26AJTJX0GTKSP65CRA4PZ3N`, turn 0, 18:51:51.228 to 18:56:32.258 | 281.03 seconds to ask hosted versus local; 31 tool calls across 19 model steps |
| Answer to that hosting question | Same run, turn 1, captured from 18:57:00.208 through 19:04:47.144 | 466.94 seconds observed, 32 tool calls across 22 model steps, no completed assistant reply in this captured interval |
| `hey` | `wrun_41M25G0QWB0GR1T577FSV2MJYM`, turn 0 | 29.54 seconds from turn start to completion; three shell calls before the greeting |
| What workflows do we currently have? | `wrun_41M268HVK80GWDGP1H717Q73CQ`, initial trace page | At least 18 tool calls; checks, database queries, run history, schema discovery, and repairs to failed queries before an answer |

The older trace pages report truncation and are not complete histories. Their `running` status does not establish that they are still computing. Eve sessions can remain open while awaiting another message. The first turn of the latest run was complete in the captured trace.

### Breakdown of the complete 281-second turn

- Tool execution intervals occupied 46.80 seconds of wall time, merging overlapping intervals to avoid double counting.
- The remaining 234.23 seconds were outside tool execution. This includes model inference, reasoning, prompt processing, channel work, and framework overhead. The trace does not isolate pure provider inference time.
- The first shell call took 19.61 seconds. Most later reads were below one second. `gtm check` took 17.05 seconds.
- Framework step-completion to next-step-start transitions totaled 5.38 seconds across the initial turn, with a 0.194-second median. These intervals are already part of the totals above.
- Tool output totaled 309,325 characters, about 309 KB of text, including line numbering and JSON wrappers. The agent read seven guidance references plus provider code, fixtures, database code, migrations, Git history, ICP, and persona content before asking the hosting question.
- Trace usage reported 1,007,793 aggregate input tokens across calls, including 617,232 cached input tokens, and 16,102 output tokens. This is repeated input across calls, not a million-token single prompt. Do not add cached input again to the input total.

The next captured turn spent 9.64 seconds in tool execution out of 466.94 observed seconds. Most of that turn was repeated reading and model work around framework implementation, templates, fixture support, and compatibility. It also attempted `HEAD~1` in the shallow checkout and encountered missing history.

## Causes and confidence

### 1. Ordinary questions trigger exhaustive procedures, confirmed

`agent/skills/gtm-workflow/references/flows.md:79` requires inspection to include run history, spending, cache hits, and deployment state. Lines 81–86 additionally require orphan-table and schema/header/runtime drift checks for all workflows. The production trace follows this broad path for a simple list request.

The create flow at lines 46–49 places workspace context and project checks before resolving hosting and the other open design decisions. In the measured turn, the agent spent nearly five minutes reading implementation details and checking the project, then asked a question it could have resolved much earlier.

The greeting trace shows a related failure: it chose to inspect workspace setup even though a greeting required no workspace facts. It first guessed `/workspace/.gtm`, then corrected itself to `$HOME/.gtm`, adding more rounds.

### 2. Many rounds with growing context and high reasoning, confirmed configuration; isolated impact unmeasured

`agent/agent.ts:7` sets `reasoning: "high"` for every root-agent call. The deployed revision does the same. The root instructions alone contain 22,661 characters and 3,470 whitespace-delimited words in this template, before Eve's own prompt, tool schemas, skills, references, and conversation history.

The trace demonstrates 19 model steps for an initial clarification and 22 more in the next captured interval. High reasoning is a plausible multiplier, but no A/B replay was performed, so no measured speedup can be attributed to lowering it yet.

Runtime logs for deployment `dpl_9RtABnRu3Wh678m4psRLdvrVDXXu` identify `meta/muse-spark-1.3-contributor`; the source default is `deepseek/deepseek-v4.1-flash`. Vercel's environment reads did not expose the effective model override, so an empty returned value is not proof that the deployed process uses the default. Team Gateway routing rules were empty. Use actual per-step model and provider metadata when validating a change.

### 3. Sandbox preparation on first access, confirmed path; internal timing not isolated

`agent/sandbox.ts` obtains the repository-bound connector token and hydrates a credential-free checkout. `agent/lib/workspace-checkout.ts:147` verifies it and prepares workflow dependencies whenever workflow hosting is configured. This preparation is on the first sandbox-use path, even if the requested action only needs a small file read.

The first shell calls in the greeting and latest creation trace took about 20 seconds. Their trace duration includes preparation; it is not a measured `npm ci` duration alone. Avoiding sandbox use for greetings removes this entire path. Dependency preparation should happen when a command actually needs the runtime, with the existing network and credential boundaries preserved.

### 4. Progress is not delivered as ordinary messages, confirmed code

`agent/lib/slack-diagram-message.ts:98` handles model messages ending in tool calls by storing the first narration line and returning. That text can drive a typing/activity label, but this handler does not post it as a normal thread message. The latest slow initial turn generated no assistant message at all until its final question.

An instruction to acknowledge immediately is insufficient on its own. The channel needs to support useful progress messages while retaining the existing rule that save approvals are the sole proposal message.

### 5. Compatibility work and warning noise, observed secondary issues

The latest trace reads workspace runtime files marked generation 20 alongside vendored templates marked generation 22. It repeatedly explores both implementations and missing Git history. A compact compatibility report and a clear upgrade decision would avoid rediscovering this through many reads.

The 500 returned runtime log records contained thousands of SDK warnings about unsupported non-OpenAI reasoning history being skipped for Muse. These are warnings, not evidence of thousands of failed model calls. Do not count log records as unique requests or hide warnings and call the problem fixed. Check SDK/provider message compatibility separately.

## Recommended changes, in order

1. **Give ordinary requests a short execution path.** Greetings and acknowledgments use no tools. Listing workflows reads only the definitions needed for names and brief purposes, in one batch. Fetch run or deployment state only when requested. Reserve schema drift, costs, cache hits, and integrity audits for explicit audit or repair requests.

2. **Resolve design decisions before implementation research.** Reuse hosting already declared by the deployment and accepted user decisions. Ask only for missing choices that affect behavior, cost, or external effects. Read provider contracts when needed to make those choices accurately. Defer fixture internals, runtime internals, migration history, build checks, and framework docs until authoring requires them. Preserve all pre-save validation and approval requirements.

3. **Default the conversational agent to low reasoning.** Benchmark the current effective model with reduced reasoning first, so the effect is measurable. Then compare candidate models on the same fixtures. Keep stronger reasoning for difficult authoring and source review. Route by task or phase only if the simpler configuration misses quality targets; avoid switching model on every step and losing prompt-cache reuse.

4. **Shrink required context and discovery work.** Keep the root prompt focused on routing, permissions, and response behavior. Load only the current action's instructions. Move detailed authoring procedures out of the always-present prompt. Provide a compact read-only workspace summary with checkout location, current revision, saved workflow names, runtime generation, and provider contracts. Reuse it within the session and refresh it after saves or version changes. Keep bulk discovery and file reading bounded to the actual question.

5. **Make common operations deterministic.** Use a small repository-bound metadata helper for workflow listing and provider lookup, instead of asking the model to reconstruct them from many shell commands. Use a standard draft scaffold and one structured validation report for authoring. Batch independent reads and provider discovery. The observed trace already parallelizes some calls; the biggest remaining saving is eliminating unnecessary rounds.

6. **Remove dependency installation from plain inspection.** Separate checkout readiness from workflow runtime readiness. Prepare locked dependencies only before a command that needs them, and reuse the prepared session. A snapshot-based optimization would need to preserve revision correctness and credential isolation; it is a later option, not the first fix. More sandbox CPU may help validation and installation but cannot remove the 234 seconds outside tools in the measured turn.

7. **Post useful progress for long work.** Acknowledge receipt promptly, then post a concise update when work exceeds roughly 10–15 seconds and at meaningful milestones. Distinguish initial response latency from completion latency. Progress delivery must remain in the originating Slack thread and must not duplicate approval cards.

8. **Benchmark provider routing and inspect model-message compatibility.** Gateway publishes hourly endpoint-level TTFT and throughput. The same model can be much slower through one provider than another. Preserve applicable provider requirements when selecting an endpoint. Check whether the chosen provider honors the requested reasoning level and whether replayed reasoning messages are being discarded.

Skill changes belong in the canonical `gtm-skills` source and must be synced through `pnpm skills:sync`. Do not hand-edit the vendored files. The existing approval gates, pre-save checks, repository binding, and sandbox egress restrictions are not latency optimizations to remove.

## Provider measurements at investigation time

These are Gateway-wide last-hour aggregates, not this project's benchmark, and may change. They measure first-token latency and generation throughput across mixed workloads.

| Model / endpoint | P50 first token | P50 output tokens/sec |
| --- | ---: | ---: |
| Muse Spark 1.3 Contributor / Meta | 2.73 sec | 111 |
| DeepSeek V4.1 Flash / DeepSeek | 1.67 sec | 249 |
| DeepSeek V4.1 Flash / Novita | 2.15 sec | 242 |
| DeepSeek V4.1 Flash / DeepInfra | 6.15 sec | 20.5 |

The catalog exposed `openai/gpt-5.6-luna-fast` as a candidate with optional reasoning, but its endpoint had no last-hour latency metrics in this response. Do not claim it is the fastest without testing it on the agent's actual tasks.

Sources: [Gateway performance metrics](https://vercel.com/changelog/live-model-performance-metrics-accessible-via-ai-gateway), [DeepSeek endpoint metrics](https://ai-gateway.vercel.sh/v1/models/deepseek/deepseek-v4.1-flash/endpoints), [Muse endpoint metrics](https://ai-gateway.vercel.sh/v1/models/meta/muse-spark-1.3-contributor/endpoints). Reasoning and compaction API details were checked against installed Eve 0.52.5 documentation in `node_modules/eve/docs/agent-config.md`.

## Verification plan

Use the captured production turn as the baseline. A deterministic local unit test cannot establish model latency or whether the model will stop over-investigating; do not treat string assertions on prompts as proof of improvement.

Benchmark greetings, workflow listing, initial creation decisions, and a full fixture-backed draft separately. Record model/provider, reasoning setting, first posted Slack message, first useful answer, total completion, model-step count, tool-call count, tool output size, input/cache/output tokens, and cold versus warm sandbox time. Run several repetitions and compare median and P95 while checking correctness and approval behavior.

Suggested acceptance targets, not measured promises:

- Greeting: one model step, zero tools, useful response in under five seconds.
- Warm workflow listing: at most two model steps and one metadata read, under ten seconds.
- Initial design question: no build, migration, or runtime-internals audit before the question; usually two or three model steps and under 15 seconds warm.
- Cold workspace access: measure separately and reduce the observed approximately 20-second preparation cost.
- Full authoring: prompt acknowledgment and periodic progress; completion remains dependent on code generation and required checks.

Run `pnpm check` for code changes. Live credentialed evals must use `pnpm eval` with an explicitly selected isolated target, per repository guidance. Do not replay production Slack messages or start real workflow runs to measure latency.

To inspect the complete baseline through the authenticated Vercel CLI:

```sh
vercel agent-runs trace wrun_41M26AJTJX0GTKSP65CRA4PZ3N --project gtm-agent-stravik --scope stravik --since 2026-09-10T00:00:00Z --json --max-field-length 0
```

Raw traces were retained only in local temporary files during investigation. They contain private conversation and workspace content and are not included in this report.
