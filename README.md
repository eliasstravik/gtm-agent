<p align="center"><img src="https://img.shields.io/badge/GTM%20Agent-Open%20source%20agent%20for%20GTM-2ea44f?style=flat-square&labelColor=24292f" alt="GTM Agent: open source agent for GTM" /></p>

<h3 align="center">Build and run GTM workflows from Slack</h3>

<p align="center">GTM Agent connects one Slack workspace to one Git-backed GTM workspace and its hosted Vercel Workflow project.</p>

<p align="center"><img src="assets/gtm-agent-slack-hero.png" width="88%" alt="A teammate works with GTM Agent in Slack using shared organization and ICP information." /></p>

<p align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a></p>

## The flow

Ask for an organization workspace, ICP, persona, prospect qualification, or reusable workflow. The agent reads the matching installed skill, works in the connected repository, verifies the result, and shows one plain-language Slack card. **Approve** saves and pushes the change. Hosted work continues in the background and returns to the same thread with its picture and links.

The five generated skills are:

| Skill | Owns |
| --- | --- |
| `gtm-workspace` | Organization structure, members, and repository health |
| `gtm-icp` | The companies an organization serves |
| `gtm-persona` | Buyers and stakeholders |
| `gtm-qualify-prospects` | Bounded, in-conversation fit checks |
| `gtm-workflow` | Workflow code, tables, runs, diagrams, and costs |

## Guarantees

- Only allowlisted people in allowlisted Slack channels can start or continue work.
- Approval cards show the plain-language summary, never commands or JSON.
- The command classifier asks by default; changed command text requires a new card.
- The sandbox runs Node 22 with deny-by-default egress.
- GitHub, workflow-run, and Turso credentials are inserted by the firewall and never enter the model's environment.
- The sandbox edits and dry-runs workflows; production runs happen only on the connected Vercel project.
- Long deployment and run waits use a durable background watcher, so they do not hold sandbox compute.

## Small host, generated skills

The authored agent is one Eve agent, one Slack channel, one sandbox, three small library modules, and two tools. `pnpm build` fetches the pinned GTM Skills release into the gitignored `agent/skills/` directory before Eve bundles it. There is no copied skill lockfile, proposal subagent, alternate workflow controller, agent-owned database, or web UI.

Version 1 removes the former source editor, proposal and migration orchestration layers, duplicated diagram delivery stack, custom workflow-control tools, vendored skill snapshot, and their tests. The remaining agent surface is 379 nonblank lines.

## Deploy

Follow [Getting started](docs/getting-started.md). You need a Vercel account, Slack admin access, one GitHub workspace repository with an initial `main` commit, a Turso database, and a separate Git-connected workflow project.

GTM Agent is free, open source, and [MIT licensed](LICENSE). Vercel, Slack, GitHub, Turso, model, and research-provider usage may have their own charges.
