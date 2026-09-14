<p align="center"><img src="https://img.shields.io/badge/GTM%20Agent-Open%20source%20GTM%20agent%20for%20Slack-2ea44f?style=flat-square&labelColor=24292f" alt="GTM Agent: open source GTM agent for Slack" /></p>

<h3 align="center">Build and run GTM workflows from Slack</h3>

<p align="center">GTM Agent lets non-technical teammates keep the organization's GTM context, ICPs, and personas, qualify prospects, and build, run, and schedule saved workflows from Slack, by running the open source <a href="https://github.com/eliasstravik/gtm-skills">GTM Skills</a> as one Vercel Eve agent connected to one GTM workspace repository.</p>

<p align="center"><img src="assets/gtm-agent-slack-hero.png" width="88%" alt="A teammate mentions GTM Agent in a Slack channel and asks it to segment a company against the organization's ICPs; the agent replies with the segment, the fit, why, and the next move." /></p>

<p align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a>&nbsp;&nbsp;<a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></p>

<p align="center"><sub>✓&nbsp;100%&nbsp;free&nbsp;and&nbsp;open&nbsp;source &nbsp; ✓&nbsp;One-prompt&nbsp;Vercel&nbsp;deploy &nbsp; ✓&nbsp;Git-backed&nbsp;workspace&nbsp;history</sub></p>

<br />

## Make Slack the front door to your GTM workspace

A teammate mentions GTM Agent in a channel or messages it directly. The agent picks the right GTM skill, reads the connected workspace repository, and replies where the team can see it. Once it has replied in a thread, replies there need no further mention. Every change to the workspace is pushed to the repository as one plain-language commit, so what the team decided is always in the history.

## Choose between rebuilding prompts, switching tools, wiring a generic chatbot — or deploying one GTM agent in Slack

| | **GTM Agent** | Repeated prompts | Standalone templates | Generic AI chat |
|---|:---:|:---:|:---:|:---:|
| **Deploys to Vercel from one prompt, Slack and workflow project included** | ✅ | ❌ | ❌ | ❌ |
| **Installs the GTM Skills at build time from a pinned release** | ✅ | ❌ | ❌ | ❌ |
| **Pins one workspace repository at deployment** | ✅ | ❌ | ❌ | ❌ |
| **Keeps GitHub, workflow, and database secrets out of the sandbox** | ✅ | ❌ | ❌ | ❌ |
| **Asks every question with options through Slack's native controls** | ✅ | ❌ | ❌ | ✅ |
| **Commits every workspace change to the repository with a plain-language message** | ✅ | ❌ | ❌ | ❌ |
| **Qualifies prospects from public web evidence only, with no paid data tools** | ✅ | ❌ | ❌ | ❌ |
| **Runs saved workflows on Vercel against your own Turso database** | ✅ | ❌ | ❌ | ❌ |
| **Posts workflow results and approval requests straight into a Slack channel** | ✅ | ❌ | ❌ | ❌ |

GTM Agent is a deliberately narrow Eve template: one Slack interface, one set of GTM skills, one workspace repository, and one path for durable changes.

## Ask in the channel. Get the GTM answer and the next action.

### 📈 Do the GTM work where the request appears

Ask for an ICP, a persona, a team change, or a saved workflow in Slack. The agent replies in the same thread with what it changed and, for workflows, where to look: the diagram, the runs, and the data.

### ⚡ Qualify a prospect from the conversation

Paste a company or a person and ask "is this a fit". The agent checks it against the saved ICPs and personas using public web evidence and replies with the verdict and its reasons.

### Enrich connections and followers

Ask "enrich my network". The agent asks for your source and enrichment services, then builds a workflow with people, their current companies, and links in both directions. It supports CSVs, existing tables, and retrieval services, with any compatible direct providers or aggregators. Up to five current experiences per person is the default; source retrieval and enrichment share one run budget.

### 💬 Let a running workflow ask the team

When a hosted workflow needs a decision, it posts to the Slack channel you chose. A reply in that thread approves or steers the run without anyone opening a dashboard.

## Deploy the agent and ask the first GTM question in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1️⃣</h3><b>Say it to your coding agent</b><br /><sub>Install the GTM Skills, then "get gtm-agent running for Acme in Slack". With the GitHub and Vercel CLIs signed in, the agent deploys this template, the Slack app, the workspace repository, and a workflow project with its database.</sub></td>
<td align="center" valign="top" width="33%"><h3>2️⃣</h3><b>Click Allow</b><br /><sub>One Slack install page: choose the workspace, add the listed events and scopes, Allow. Then invite the bot to your GTM channels.</sub></td>
<td align="center" valign="top" width="33%"><h3>3️⃣</h3><b>Ask in Slack</b><br /><sub>Mention the agent: "set up our GTM workspace". Its first save becomes the workspace on <code>main</code>; workflows run on the connected project from the first one.</sub></td>
</tr>
</table>

## Choose how to get started

<table>
<tr>
<td align="center" valign="top" width="50%"><h3>Self-serve</h3><sub>For GTM teams working in Slack</sub><br /><h2>Free</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; One open source Eve Slack agent<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Every GTM skill, pinned to a release<br />&nbsp;&nbsp;&nbsp;✓&nbsp; One git-backed GTM workspace repository<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Organization, member, ICP, and persona lifecycles<br />&nbsp;&nbsp;&nbsp;✓&nbsp; In-conversation prospect qualification<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Saved workflows on Vercel with your own Turso database<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Workflow approvals and results in Slack</div></td>
<td align="center" valign="top" width="50%"><h3>Done-with-you</h3><sub>Hands-on setup and rollout for your GTM team</sub><br /><h2>Let's talk</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; Everything in self-serve<br />&nbsp;&nbsp;&nbsp;✓&nbsp; GTM Agent deployment<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Slack and GitHub setup<br />&nbsp;&nbsp;&nbsp;✓&nbsp; GTM workspace repository configuration<br />&nbsp;&nbsp;&nbsp;✓&nbsp; ICP, persona, and workflow design<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Workflow project, Turso, and AI Gateway configuration<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Team rollout, training, and best practices<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Ongoing maintenance and upgrades<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Dedicated Slack channel support</div></td>
</tr>
<tr>
<td align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a></td>
<td align="center"><a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></td>
</tr>
</table>

## Get your questions answered

### What does GTM Agent deploy?

One Eve agent on Vercel with Slack as its only channel, the GTM Skills installed at build time from a pinned release, and a connection to one GTM workspace repository.

### Do I have to build the workspace before deploying?

No. The deploy creates an empty private repository named `gtm-<slug>` and points the agent at it; say "set up our GTM workspace" in Slack and the agent's first save becomes the workspace on `main`. The repository name, minus a leading `gtm-`, is the workspace slug.

### Where do the agent's changes go?

To the workspace repository, as commits on `main` authored as the owner of the GitHub token you provide. The agent's own computer lasts one conversation; only what is pushed survives.

### How are secrets handled?

They never enter the sandbox. The sandbox firewall adds the GitHub token and the workflow run secret to requests on the way out; hosted data is read through the workflow project's query route, so no database token exists on the agent. Model access runs through Vercel's AI Gateway with each project's own identity, no key anywhere.

### Can the agent run GTM workflows?

Yes, on the second Vercel project the one-prompt deploy connects to the workspace repository's `workflows/` folder with a Turso database. The agent builds workflows in its sandbox, pushes them, and starts, approves, and cancels runs on that project. Results and approval requests post to the Slack channel the workflow names.

### Does the agent use paid data providers to qualify prospects?

No. Fit checks from Slack use public web evidence only. Paid providers are available to saved workflows through keys you set on the workflow project; the agent learns their names and never holds their values.

### Which model does it use?

Eve's default model through the AI Gateway, or the model you name in `GTM_AGENT_MODEL`, with reasoning effort from `GTM_AGENT_REASONING`. Both are read at build time.

### What does it cost?

GTM Agent is free, open source, and [MIT licensed](LICENSE). Vercel, Slack, GitHub, Turso, and model usage may be subject to their own plans and charges.

## Put the next GTM decision in Slack

<p align="center">Your team asks in the conversation. GTM Agent brings the workspace, the skill, and the next action into the same thread. You click Deploy once.</p>

<p align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a>&nbsp;&nbsp;<a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></p>

<p align="center"><sub>✓&nbsp;100%&nbsp;free&nbsp;and&nbsp;open&nbsp;source &nbsp; ✓&nbsp;One-prompt&nbsp;Vercel&nbsp;deploy &nbsp; ✓&nbsp;Git-backed&nbsp;workspace&nbsp;history</sub></p>
