# Agent stages in GTM workflows: design

Date: 2026-09-14. Shipped as gtm-skills 0.1.11, pinned by gtm-agent 0.1.14.

## Problem

Three hosted attempts at a "research agent" step in the eliasstravik workspace failed for three unrelated wiring reasons: a `WorkflowAgent` inside a `"use step"` (opaque, non-durable), a `timeout:` option (`AbortSignal.timeout` is forbidden in workflow scope), and `z.string().url()` in the output schema (OpenAI rejects `format: uri`, the Gateway falls back silently, the model calls no tools). The skill offered only a types-checked snippet, so every build from Slack re-guessed the wiring against rules it could not see.

## Decision

One verified helper in the workflow template, `lib/agent.ts`, is the only way an agent stage is written. Workflows pass a config; the helper owns the wiring.

- `runAgent()` runs in workflow scope. `WorkflowAgent` makes each model call a step; tools are step-backed, so each tool call is a step too. The trace shows everything.
- Config: `model` and `reasoning` (defaults `GTM_MODEL`, `GTM_REASONING`), `instructions`, `skills` (text modules registered in `skills/index.ts`), `tools` (`mcp` servers by name with `url`, `keyEnv`, `allow`, `maxCalls`; `web.fetch`; `web.search` through Exa; `custom` step-backed tools), `maxSteps`, `maxUsd` (soft stop: after the crossing call the agent stops using tools and writes up), `timeout` (raced against `sleep()`), `schema`.
- `lib/mcp.ts` recreates the MCP client per call inside a step, key from the project's variables, definitions cached an hour; only JSON crosses the workflow boundary. `lib/web.ts` gives a free cached page fetch and Exa search.
- Schemas are sanitized (`format`, `$schema` stripped; tools `strict: false`); authors use nullable fields.
- Cost is the Gateway's reported per-call cost plus tool-reported cost, with `estimateUsd` as the fallback.
- A cap mid-research triggers one wrap-up call without tools so the schema still comes back filled.

## Two defaults taken without a ruling

Budget is a soft stop rather than an abort mid-call; model and reasoning default to project variables with per-workflow override.

## Verification

Local runs against the pinned packages: a company brief through `fetch_page` (3 model calls, 4 pages, $0.002), a public MCP server through `listMcpTools` and `callMcpTool`, and a one-step cap ending in the wrap-up call. `tsc --noEmit` clean; Node and Vercel production builds pass. Hosted verification of the Monid workflow happens from Slack, since the workflow project's secrets are not readable from a workstation.
