<p align="center"><img src="https://img.shields.io/badge/GTM%20Agent-Open%20source%20agent%20for%20GTM-2ea44f?style=flat-square&labelColor=24292f" alt="GTM Agent — Open source agent for GTM" /></p>

<h3 align="center">Maintain your GTM workspace from one Slack agent</h3>

<p align="center">GTM Agent lets your team maintain its organization, ICPs, personas, members, suborganizations, and saved GTM workflows through five open source GTM skills in Slack, backed by one optional Git workspace and the workspace's own Turso database.</p>

<p align="center"><img src="assets/gtm-agent-slack-hero.png" width="88%" alt="A teammate asks GTM Agent in Slack to work with shared organization and ICP information from the connected GTM workspace." /></p>

<p align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a>&nbsp;&nbsp;<a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></p>

<p align="center"><sub>✓&nbsp;100%&nbsp;free&nbsp;and&nbsp;open&nbsp;source &nbsp; ✓&nbsp;Four&nbsp;GTM&nbsp;skills,&nbsp;one&nbsp;Slack&nbsp;agent &nbsp; ✓&nbsp;Git-backed&nbsp;workspace&nbsp;history</sub></p>

<p align="center"><small>⭐ Used by top GTM teams</small></p>

<br />

## Make Slack the front door to your GTM operating system

An allowlisted teammate mentions GTM Agent in an allowlisted channel. GTM Agent selects the workspace, ICP, persona, or workflow skill, reads the connected organization workspace when required, and returns a proposal where the rest of the team can review it. Every later request needs another mention. DMs, bot messages, and ordinary channel messages are ignored. With a Turso database configured, the agent can also build and dry-run saved GTM workflows in the sandbox and run them on Vercel against the workspace's own data.

> [!IMPORTANT]
> **Breaking deployment change:** upgrading deployments must rename `GTM_CONTEXT_REPOSITORY` to `GTM_WORKSPACE_REPOSITORY` before redeploying. The former variable is no longer recognized.

## Choose between rebuilding prompts, switching between tools, wiring a generic chatbot — or deploying one purpose-built GTM agent in Slack

| | **GTM Agent** | Repeated prompts | Standalone templates | Generic AI chat |
|---|:---:|:---:|:---:|:---:|
| **Ships as a ready-to-deploy Eve Slack agent** | ✅ | ❌ | ❌ | ❌ |
| **Includes the exact five GTM Skills** | ✅ | ❌ | ❌ | ❌ |
| **Pins one workspace repository at deployment** | ✅ | ❌ | ❌ | ❌ |
| **Keeps connector tokens out of sandbox commands** | ✅ | ❌ | ❌ | ❌ |
| **Uses native approval for workspace writes** | ✅ | ❌ | ❌ | ❌ |
| **Commits an approved change atomically on main** | ✅ | ❌ | ❌ | ❌ |
| **Stops a write when the repository HEAD changes** | ✅ | ❌ | ❌ | ❌ |
| **Runs saved workflows on Vercel against your own Turso database** | ✅ | ❌ | ❌ | ❌ |
| **Brokers every workflow token at the sandbox firewall** | ✅ | ❌ | ❌ | ❌ |
| **Adds no agent-owned database, web UI, or alternate memory** | ✅ | ❌ | ❌ | ❌ |

GTM Agent arrives as a deliberately narrow Eve template: one Slack interface, one exact workflow inventory, one deployment-fixed workspace target, and one approval-gated path for durable changes.

## Ask the question. See the GTM basis. Take the next action.

### 📈 Run the GTM work where the request appears

Ask for workspace, ICP, persona, or workflow lifecycle work, or an in-session prospect qualification, in Slack without sending the team into a separate GTM application.

### ⚙️ Build and run reusable GTM workflows

Create, update, inspect, delete, or run a saved workflow. Each workflow declares a typed result table, commits its migrations, and upserts rows by a stable key. The sandbox authors and dry-runs; real runs happen on a Git-connected Vercel workflow project, always with a zero-spend dry run, a checkpoint before real spend, and an approval-gated cancel.

### ⚡ Use one agent for five focused jobs

The agent routes each request to a named workflow instead of relying on one giant prompt to improvise the method.

### 💬 Keep durable changes reviewable

When the connected workspace needs an update, the agent shows the complete proposal and applies it only through native approval and one atomic commit.

## Deploy the agent and ask the first GTM question in three steps

<table>
<tr>
<td align="center" valign="top" width="33%"><h3>1️⃣</h3><b>Deploy GTM Agent</b><br /><sub>Create the Vercel project from this Eve template and configure the required model access.</sub></td>
<td align="center" valign="top" width="33%"><h3>2️⃣</h3><b>Connect Slack</b><br /><sub>Authorize the generated Slack app and verify the standard Eve health endpoint.</sub></td>
<td align="center" valign="top" width="33%"><h3>3️⃣</h3><b>Connect your GTM workspace</b><br /><sub>Point the deployment at one repository, even a brand-new one with only a README, and finish the workspace setup from Slack. Add a Turso database to host saved workflows.</sub></td>
</tr>
</table>

## Choose how to get started

<table>
<tr>
<td align="center" valign="top" width="50%"><h3>Self-serve</h3><sub>For GTM builders and teams using Slack</sub><br /><h2>Free</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; One open-source Eve Slack agent<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Four focused GTM skills<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Slack-only deployment<br />&nbsp;&nbsp;&nbsp;✓&nbsp; One Git-backed GTM workspace repository<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Approval-gated atomic workspace updates<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Organization, ICP, persona, member, and workflow lifecycles<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Workflow runs against your own Turso database</div></td>
<td align="center" valign="top" width="50%"><h3>Done-with-you</h3><sub>Hands-on setup and rollout for your GTM team</sub><br /><h2>Let's talk</h2><div align="left">&nbsp;&nbsp;&nbsp;✓&nbsp; Everything in self-serve<br />&nbsp;&nbsp;&nbsp;✓&nbsp; GTM Agent deployment<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Slack and GitHub connector setup<br />&nbsp;&nbsp;&nbsp;✓&nbsp; GTM workspace repository configuration<br />&nbsp;&nbsp;&nbsp;✓&nbsp; ICP, persona, and workflow design<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Turso and provider host configuration<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Team rollout, training, and best practices<br />&nbsp;&nbsp;&nbsp;✓&nbsp; Dedicated Slack channel support</div></td>
</tr>
<tr>
<td align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a></td>
<td align="center"><a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></td>
</tr>
</table>

## Get your questions answered

### What does GTM Agent deploy?

One deliberately small Eve agent with Slack as its only channel, the exact approved GTM workflow inventory, and an optional connection to one fixed GTM workspace repository.

### Can I use it without a workspace repository?

Yes. Slack-only mode can load the workflows and explain their prerequisites. Jobs that require saved ICPs, personas, or organization workspace content stop and explain what is missing.

### Do I have to build the workspace before deploying?

No. Create a repository on GitHub with a README, point the deployment at it, and say "set up our GTM workspace" in Slack. The agent runs the guided setup and its first approved change becomes the workspace scaffold on `main`.

### What changes when I connect GitHub?

The agent can read the GTM workspace from the configured repository and propose in-contract workspace changes through its sole approval-gated write tool.

### How does GTM Agent write workspace content safely?

It validates the complete path manifest and expected HEAD, asks for native approval, compares remote `main`, and creates one atomic commit or no write. Tracked files of the root `workflows/` project go through the same tool; secrets, dependencies, and runtime state never do.

### Can the agent run GTM workflows?

Yes, when the deployment sets `TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`, and `TURSO_READ_ONLY_AUTH_TOKEN` for the workspace's own Turso database. The sandbox drafts the workflow project in scratch space, validates and dry-runs it, and submits accepted tracked files for approval; it never starts a real run and can only read the database. Vercel workflows deploy when that approved atomic commit reaches workspace `main`, with declared migrations applied through a write credential that exists only for that step. The commit uses a configured, verified Git author recognized by Vercel while the repository-bound GitHub App remains the committer. Eve waits for the exact Git SHA before starting production, refuses a start whose fresh dry run differs from the accepted rows and cost, and can cancel a live run through a separate approval. No workflow credential enters the sandbox.

### Can the agent browse the web or update our CRM?

Skills may inspect safe public sources when browsing is available. They do not write to a CRM or another external system; accepted workspace changes use the sole approval-gated GitHub tool.

### Can the agent update itself?

For a configured owner, yes—but only as a proposal. The dedicated source editor can change instructions or native schedules in an isolated checkout, show the complete diff for acceptance, and open an approval-gated draft pull request. It cannot update `main`, merge, or deploy. Broader code changes still require an external coding session. GTM skills remain owned by `gtm-skills` and are synced into the agent after their source changes. See [agent self-management](docs/agent-self-management.md).

### What does it cost?

GTM Agent is free, open source, and [MIT licensed](LICENSE). The bundled GTM Skills carry their separate [MIT license](LICENSES/gtm-skills-MIT.txt). Vercel, Slack, GitHub, Turso, model, and research-provider usage may be subject to their own plans and charges.

## Put the next GTM decision in Slack

<p align="center">Your team asks in the conversation. GTM Agent brings the workflow, connected workspace, and next action into the same thread.</p>

<p align="center"><a href="docs/getting-started.md"><img src="assets/buttons/deploy-gtm-agent.svg" alt="Deploy GTM Agent" /></a>&nbsp;&nbsp;<a href="https://cal.com/stravik/demo?projects=GTM%20Agent" target="_blank" rel="noopener noreferrer"><img src="assets/buttons/book-a-demo.svg" alt="Book a demo" /></a></p>

<p align="center"><sub>✓&nbsp;100%&nbsp;free&nbsp;and&nbsp;open&nbsp;source &nbsp; ✓&nbsp;Four&nbsp;GTM&nbsp;skills,&nbsp;one&nbsp;Slack&nbsp;agent &nbsp; ✓&nbsp;Git-backed&nbsp;workspace&nbsp;history</sub></p>

<p align="center"><small>⭐ Used by top GTM teams</small></p>
