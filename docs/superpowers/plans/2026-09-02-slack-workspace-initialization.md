# Slack Workspace Initialization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a client finish GTM workspace setup from Slack against a repository that was created on GitHub with only a README, across `gtm-skills`, `gtm-agent`, the `eve` deployment, and the `gtm-eliasstravik` workspace.

**Architecture:** The `gtm-workspace` skill's Create flow gains environment-answered substitutions so it runs on a connected repository that has no organization file yet, while the surface refusal narrows to connection changes. The agent's bootstrap stops treating a missing `ORG.md` as an error and the mutation preflight enforces "first write must include `ORG.md`" instead. The write tool, approval gates, credential brokering, and commit path are unchanged. Changes flow upstream-first: `gtm-skills` releases 0.2.0, `gtm-agent` vendors it alongside its own code change, `eve` ports the same change, and `gtm-eliasstravik` is verified unchanged.

**Tech Stack:** Node 24, pnpm 10.14.0, TypeScript, `node --test`, Eve 0.47.1 sandbox (bash commands over Vercel Sandbox), Octokit; Python 3.13 for `gtm-skills` checks and evals.

**Spec:** `docs/superpowers/specs/2026-09-02-slack-workspace-initialization-design.md`

## Global Constraints

- `gtm-agent/AGENTS.md`: never hand-edit `agent/skills/`; sync it with `pnpm skills:sync /path/to/gtm-skills`. `skills-lock.json` is the integrity manifest.
- `gtm-agent/AGENTS.md`: `apply_gtm_workspace_changes` stays the only direct-to-`main` write tool. Add no tool, no host-side write at bootstrap, no session-environment token delivery, no new sandbox egress.
- The approval order is fixed: the skill's numbered accept loop, then native tool approval, then one atomic commit. Nothing in this plan moves it.
- `gtm-skills/CONTRIBUTING.md`: update `VERSIONS.md` and `CHANGELOG.md` when behavior changes; release requires an annotated `v<version>` tag on the merged `main` commit. Workflow library generation stays **13** because no managed workflow file changes.
- `gtm-skills` skill text must keep `SKILL.md` under 500 lines and 5,000 tokens and pass `python3 scripts/check_skill_compatibility.py`, `python3 scripts/check_repo_layout.py`, and `python3 evals/run_quality.py`.
- All `gtm-agent` release checks run with `pnpm check` (skills check, typecheck, tests, build).
- Existing wording the `gtm-agent` instruction tests still require: a sentence matching `/create.*import.*sharing.*whole-(?:repository|workspace) deletion/is` and one matching `/\/gtm-workspace.*keyboard/is`.
- Never print `.env.local` values, connector tokens, or Turso tokens in any step.
- Commit only on feature branches. Every repository here uses `main` as the protected default branch with PR review.

## Order of work

```
Phase 1  gtm-skills  (Tasks 1–6)   → merge → tag v0.2.0
Phase 2  gtm-agent   (Tasks 7–13)  code tasks can start in parallel with Phase 1;
                                   Task 13 (vendor sync) waits for the v0.2.0 tag
Phase 3  eve         (Tasks 14–15) after gtm-agent merges
Phase 4  gtm-eliasstravik + rehearsal (Tasks 16–17) after eve deploys
```

Local checkouts used below:

| Repository | Path |
| --- | --- |
| gtm-skills | `/Users/eliasstravik/dev/gtm-skills` |
| gtm-agent | `/Users/eliasstravik/dev/gtm-agent` |
| eve | `/Users/eliasstravik/dev/eve` |
| gtm-eliasstravik | `/Users/eliasstravik/dev/gtm-eliasstravik` |

---

# Phase 1: gtm-skills

### Task 1: Narrow the surface refusal and add connected-repo substitutions to Create

**Files:**
- Modify: `skills/gtm-workspace/references/flows.md` (Contents, Interaction protocol resolve bullet, Surface refusal, Create heading)

**Interfaces:**
- Produces: the phrase "connected-repo substitutions" and the state name "not set up yet", which `SKILL.md` (Task 2), `contract.md` (Task 3), the host requirements doc (Task 5), and `gtm-agent/agent/instructions.md` (Task 10) all reference verbatim.

- [ ] **Step 1: Create a branch**

```bash
cd /Users/eliasstravik/dev/gtm-skills
git checkout main && git pull --ff-only
git checkout -b hosted-workspace-setup
```

- [ ] **Step 2: Update the Contents list**

In `skills/gtm-workspace/references/flows.md`, replace:

```markdown
- [Create](#create-keyboard-surfaces-only)
```

with:

```markdown
- [Create](#create)
```

Leave `- [Import](#import-keyboard-surfaces-only)` as is.

- [ ] **Step 3: Update the repo-resolution bullet in Interaction protocol**

Replace the final sentence of the bullet that begins `- Resolve the connected GTM workspace repo first:`. Old sentence:

```markdown
If update, delete, or doctor has no repo to use, explain that; on a keyboard surface offer create/import through the guided menu, and on a fixed-connection surface use the surface refusal.
```

New sentence:

```markdown
If update, delete, or doctor has no repo to use, explain that; on a keyboard surface offer create/import through the guided menu. On a fixed-connection surface, a connected repo whose root has neither `ORG.md` nor legacy `org.md` is not set up yet: offer create for that connected repo; otherwise use the surface refusal.
```

- [ ] **Step 4: Rewrite the Surface refusal section**

Replace the whole `## Surface refusal` section with:

```markdown
## Surface refusal

Creating a different repo, import, sharing setup, and whole-repo deletion change which repo is connected, not just its contents, so they need a human at a keyboard. When one is requested while the repo connection is fixed by the deployment, refuse in one short message and perform nothing for that request:

- Why: this deployment's repo connection is part of its configuration, so a conversation here cannot create, replace, or remove it.
- What to do: run gtm-workspace from Claude Code or Codex CLI at a keyboard to create a different context, import one, set up sharing, or delete a whole context.
- What happens after: once a repo is connected to this deployment, updating, deleting content, and doctoring all work right here.

Write nothing, draft nothing, and research nothing for the refused request; do not produce carry-over artifacts in chat. A create request for the connected repo itself, when that repo is not set up yet, is not a connection change: run [Create](#create) with its connected-repo substitutions instead of refusing. Every other flow proceeds on any surface with a connected repo.
```

- [ ] **Step 5: Rename the Create heading and add the substitutions**

Replace:

```markdown
## Create (keyboard surfaces only)

1. Check that git is installed before touching the target.
```

with:

```markdown
## Create

On a fixed-connection surface whose connected repo has no root `ORG.md` or legacy `org.md`, run this flow for that repo with these connected-repo substitutions and no others: skip step 1; in step 2 do not create `~/.gtm/` and use the org slug only for display, because the target is the connected checkout; skip step 3; in step 6 do not create a repo, initialize git, or set an identity, and instead save `ORG.md` together with `AGENTS.md`, `CLAUDE.md`, and `.gitignore` rendered from the templates as one durable change through the environment's declared mechanism; save every later accepted artifact the same way; in step 12 do not set repo-local git identity for the operator; skip step 15 because the deployment already shares the repo; in step 16 say the workspace is saved in the connected repository instead of describing local or shared mode. Every question, proposal opening, accept loop, research rule, and completion criterion stays exactly as written.

1. Check that git is installed before touching the target.
```

(Keep the rest of step 1's original text after "before touching the target." unchanged.)

- [ ] **Step 6: Run the deterministic checks**

```bash
cd /Users/eliasstravik/dev/gtm-skills
python3 scripts/check_repo_layout.py
python3 scripts/check_skill_compatibility.py
python3 evals/run_quality.py
```

Expected: all three exit 0. The skill body line and token limits are unaffected because only `references/flows.md` changed.

- [ ] **Step 7: Commit**

```bash
git add skills/gtm-workspace/references/flows.md
git commit -m "gtm-workspace: run create on a connected repo that is not set up yet"
```

---

### Task 2: Update the SKILL.md procedure table

**Files:**
- Modify: `skills/gtm-workspace/SKILL.md` (Procedure table rows, Outputs paragraph)

- [ ] **Step 1: Replace the first Procedure row and add a second**

Old row:

```markdown
| A fixed-connection deployment receives create, import, sharing setup, whole-workspace deletion, or another connection-changing request | Refuse and redirect through the surface-refusal flow; perform nothing for that request |
```

New rows (the second is new, inserted directly after the first):

```markdown
| A fixed-connection deployment receives import, sharing setup, whole-workspace deletion, a create for a repo other than the connected one, or another connection-changing request | Refuse and redirect through the surface-refusal flow; perform nothing for that request |
| Create is requested on a fixed-connection deployment whose connected repo has no root `ORG.md` or legacy `org.md` | Guide the create flow with its connected-repo substitutions; the first saved change writes `ORG.md` together with the contract files |
```

- [ ] **Step 2: Update the Outputs paragraph**

Old:

```markdown
Produce the requested workspace state and a path-based summary, or a complete health report for doctor. A refused fixed-connection operation produces only the prescribed explanation and CLI redirect.
```

New:

```markdown
Produce the requested workspace state and a path-based summary, or a complete health report for doctor. A refused fixed-connection operation produces only the prescribed explanation and CLI redirect; a connected repo that is not set up yet is created in place, not refused.
```

- [ ] **Step 3: Check body size and compatibility**

```bash
wc -l skills/gtm-workspace/SKILL.md
python3 scripts/check_skill_compatibility.py
python3 evals/run_quality.py
```

Expected: line count under 500; both checks exit 0. `run_quality.py` lints the description, which is unchanged.

- [ ] **Step 4: Commit**

```bash
git add skills/gtm-workspace/SKILL.md
git commit -m "gtm-workspace: procedure rows for hosted create on a connected repo"
```

---

### Task 3: State the uninitialized-repo rule in the persistence contract

**Files:**
- Modify: `skills/gtm-workspace/references/contract.md` (Persistence contract section)

- [ ] **Step 1: Append one paragraph to `## Persistence contract`**

After the paragraph that begins `The background git ritual below is the default mechanism.` add:

```markdown
A connected repo whose root has neither `ORG.md` nor legacy `org.md` is not yet a canonical workspace. Its first saved change writes root `ORG.md` together with the contract files (`AGENTS.md`, `CLAUDE.md`, `.gitignore`) in one history entry; a hosting environment may refuse every other write until root `ORG.md` exists. Files outside the contract that the repo already carries, such as a README, are left untouched.
```

- [ ] **Step 2: Run checks and commit**

```bash
python3 scripts/check_skill_compatibility.py
git add skills/gtm-workspace/references/contract.md
git commit -m "gtm-workspace: persistence rule for a connected repo that is not set up yet"
```

---

### Task 4: Add the hosted-create eval case

**Files:**
- Create: `evals/gtm-workspace/fixtures/hosted-create-connected-unset/home/.gtm/northwind-gtm/README.md`
- Modify: `evals/gtm-workspace/evals.json` (append case 14)
- Modify: `evals/gtm-workspace/scripts/run_evals.py` (`seed_home`)
- Modify: `evals/gtm-workspace/scripts/grade_evals.py` (`checks_for`)

**Interfaces:**
- Consumes: `run_git`, `result`, `git`, `user_output`, `executor_commands`, `attempted_git_write`, `has_contract`, `bold_question`, `conversation_turns`, `ROOT_IDENTITY_QUESTION` already defined in the scripts.
- Produces: eval name `hosted-create-connected-unset`.

- [ ] **Step 1: Create the fixture**

```bash
mkdir -p evals/gtm-workspace/fixtures/hosted-create-connected-unset/home/.gtm/northwind-gtm
printf '# northwind-gtm\n' > evals/gtm-workspace/fixtures/hosted-create-connected-unset/home/.gtm/northwind-gtm/README.md
```

- [ ] **Step 2: Append the eval case**

Append this object to the `"evals"` array in `evals/gtm-workspace/evals.json` (after id 13):

```json
{
  "id": 14,
  "name": "hosted-create-connected-unset",
  "prompt": "You are running as a hosted chat agent, not a CLI: your deployment's configuration fixed the repo connection at deploy time, the connected repo is already checked out at ~/.gtm/northwind-gtm inside your workspace with intentionally no git remote, and it contains only a README.md with no ORG.md because the team has not set it up yet. Your environment instructions declare that durable writes happen by committing locally on main, which the platform then mirrors durably, and that the environment answers the create flow's keyboard steps: git is present, the checkout is the target, no git init or identity is needed, and the sharing question is skipped. Simulate Priya, a non-technical GTM lead chatting in the team channel. She asks: 'Set up our GTM workspace.' Use only this fact sheet for her replies: organization name Northwind Gear; website https://northwind-gear.example; no other links; she accepts the complete proposed ORG.md as drafted; no suborganizations; skip member onboarding. Drive the guided flow to completion inside this run's HOME.",
  "expected_output": "The create flow runs on the connected repo instead of refusing: the root intake questions are asked verbatim, the accepted ORG.md is saved together with AGENTS.md, CLAUDE.md, and .gitignore as one history entry on main, the README is untouched, no sharing question is asked, and no remote, push, or keyboard redirect appears.",
  "files": [
    "evals/gtm-workspace/fixtures/hosted-create-connected-unset"
  ],
  "assertions": [
    "No keyboard or CLI redirect appears in the user-facing output.",
    "The first assistant turn asks the exact root identity question.",
    "~/.gtm/northwind-gtm/ORG.md exists with H1 '# Northwind Gear' and a complete Company data section.",
    "AGENTS.md, CLAUDE.md, and .gitignore in the repo match the skill templates byte for byte.",
    "README.md is unchanged and still tracked.",
    "The repo is on main, clean, has exactly two history entries, and the second contains exactly ORG.md, AGENTS.md, CLAUDE.md, and .gitignore.",
    "No git remote is added, no push is attempted, and the sharing question is never asked.",
    "Fictional prompt examples are absent from research arguments, artifact proposals, and generated context artifacts unless explicitly user-supplied."
  ],
  "allowed_example_values": []
}
```

- [ ] **Step 3: Seed the fixture repository in `run_evals.py`**

In `seed_home`, directly after the `if eval_case["name"] in HOSTED_CONNECTED_EVALS:` block, add:

```python
    if eval_case["name"] == "hosted-create-connected-unset":
        repo = home / ".gtm" / "northwind-gtm"
        run_git(repo, "init", "-b", "main", env=env)
        run_git(repo, "config", "--local", "user.name", "GTM Workspace", env=env)
        run_git(repo, "config", "--local", "user.email", "gtm@local", env=env)
        run_git(repo, "add", "README.md", env=env)
        run_git(repo, "commit", "-m", "Initial commit", env=env)
```

Do not add the name to `HOSTED_CONNECTED_EVALS`; that set selects the populated fixture.

- [ ] **Step 4: Add the grader branch in `grade_evals.py`**

Inside `checks_for`, directly before the `if name == "hosted-update-proceeds":` line, add:

```python
    if name == "hosted-create-connected-unset":
        repo = root / "northwind-gtm"
        org = repo / "ORG.md"
        org_text = org.read_text() if org.is_file() else ""
        output = user_output(run_dir).lower()
        commands = executor_commands(run_dir)
        turns, _alternating = conversation_turns(run_dir)
        first_question = bold_question(turns[0][1]) if turns and turns[0][0] == "Assistant" else None
        templates = SKILL_ROOT / "templates"
        contract_matches = (
            (repo / "AGENTS.md").read_bytes() == (templates / "AGENTS.md").read_bytes()
            and (repo / "CLAUDE.md").read_bytes() == (templates / "CLAUDE.md").read_bytes()
            and (repo / ".gitignore").read_bytes() == (templates / "gitignore").read_bytes()
        ) if all((repo / p).is_file() for p in ("AGENTS.md", "CLAUDE.md", ".gitignore")) else False
        readme_intact = git(repo, "show", "HEAD:README.md") == "# northwind-gtm"
        history_ok = (
            git(repo, "branch", "--show-current") == "main"
            and not git(repo, "status", "--porcelain")
            and int(git(repo, "rev-list", "--count", "HEAD") or 0) == 2
            and set(git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "HEAD").split())
            == {"ORG.md", "AGENTS.md", "CLAUDE.md", ".gitignore"}
        )
        pushed = any(re.search(r"\bgit\b.*\bpush\b", command, re.I | re.S) for command in commands)
        return [
            result("keyboard" not in output and "command line" not in output and " cli" not in output, "Checked user-facing output for absence of a keyboard or CLI redirect."),
            result(first_question == ROOT_IDENTITY_QUESTION, "Checked that the first assistant turn asks the exact root identity question."),
            result(org_text.startswith("# Northwind Gear") and "## Company data" in org_text, "Checked ORG.md H1 and Company data section."),
            result(contract_matches, "Compared AGENTS.md, CLAUDE.md, and .gitignore with the skill templates byte for byte."),
            result(readme_intact, "Checked that README.md is unchanged at HEAD."),
            result(history_ok, "Checked main, a clean tree, exactly two history entries, and the exact four-file scaffold in the second."),
            result(not git(repo, "remote") and not pushed and "multiplayer" not in output, "Checked that no remote was added, no push ran, and the sharing question was not asked."),
        ]
```

`SKILL_ROOT` (line 15), `ROOT_IDENTITY_QUESTION` (line 18), `conversation_turns`, `bold_question`, `user_output`, `executor_commands`, `git`, and `result` are already defined in `grade_evals.py`; no new imports or constants are needed.

- [ ] **Step 5: Validate the JSON and Python**

```bash
python3 -c "import json; json.load(open('evals/gtm-workspace/evals.json'))"
python3 -m py_compile evals/gtm-workspace/scripts/run_evals.py evals/gtm-workspace/scripts/grade_evals.py
python3 evals/run_quality.py
```

Expected: no output from the first two; `run_quality.py` exits 0.

- [ ] **Step 6: Run the live eval for the new case only (requires Codex auth; optional but recommended)**

```bash
mkdir -p evals/gtm-workspace/runs/hosted-create-connected-unset-1
python3 evals/gtm-workspace/scripts/run_evals.py evals/gtm-workspace/runs/hosted-create-connected-unset-1 --ids 14 --configurations with_skill
python3 evals/gtm-workspace/scripts/grade_evals.py evals/gtm-workspace/runs/hosted-create-connected-unset-1
```

Expected: the grader reports all seven checks for `hosted-create-connected-unset` as passed. If the redirect check fails, the flows.md wording from Task 1 is the place to fix, not the grader. Do not commit the run directory unless the repository's existing practice is to keep evidence runs; check `git status` before staging.

- [ ] **Step 7: Commit**

```bash
git add evals/gtm-workspace/fixtures/hosted-create-connected-unset evals/gtm-workspace/evals.json evals/gtm-workspace/scripts/run_evals.py evals/gtm-workspace/scripts/grade_evals.py
git commit -m "gtm-workspace evals: hosted create on a connected repo that is not set up yet"
```

---

### Task 5: Document the host contract for hosted set-up

**Files:**
- Modify: `docs/gtm-agent-requirements.md` (new section before `## Setup that remains manual`)

- [ ] **Step 1: Add the section**

Insert before `## Setup that remains manual`:

```markdown
## Workspace set-up from the hosted surface

A connected repository may start with only a README: `main` exists with at least one commit, and the root has neither `ORG.md` nor legacy `org.md`. The host treats this as "not set up yet", not as a configuration error.

The host must:

1. hydrate and verify that checkout exactly as it would a populated one, so the agent can read it and the skill can see that the organization file is missing;
2. refuse every `apply_gtm_workspace_changes` request against that checkout unless its manifest writes root `ORG.md`, so the first saved change is the scaffold;
3. declare in its standing instructions which Create steps the environment answers: git is present, the checkout is the target with no local collision check, no git init or repo-local identity is set, the sharing question is skipped, and the first save carries `ORG.md` with `AGENTS.md`, `CLAUDE.md`, and `.gitignore` from the skill templates;
4. keep refusing creation of a different repository, import, sharing setup, and whole-repository deletion exactly as before.

The README and any other file outside the workspace path contract stay untouched. The write tool, approval order, credential brokering, and commit path do not change.
```

- [ ] **Step 2: Update the manual-setup paragraph**

In `## Setup that remains manual`, change `A human initially creates or selects the Vercel workflow project,` to `A human initially creates the workspace repository on GitHub (a new repository with "Add a README file" is enough), creates or selects the Vercel workflow project,`.

- [ ] **Step 3: Commit**

```bash
git add docs/gtm-agent-requirements.md
git commit -m "docs: host contract for hosted workspace set-up"
```

---

### Task 6: Release gtm-skills 0.2.0

**Files:**
- Modify: `VERSIONS.md` (table row)
- Modify: `CHANGELOG.md` (new entry)

- [ ] **Step 1: Add the VERSIONS.md row**

Insert as the first data row of the table:

```markdown
| 0.2.0 | <merge date YYYY-MM-DD> | `gtm-workspace`, `gtm-icp`, `gtm-persona`, `gtm-qualify-prospects`, `gtm-workflow` | 13 | <merge date YYYY-MM-DD> |
```

- [ ] **Step 2: Add the CHANGELOG entry**

Insert after `# Changelog`:

```markdown
## 0.2.0, <merge date YYYY-MM-DD>

Workflow library generation 13, unchanged.

- `gtm-workspace` now creates a workspace in place on a hosted surface when the connected repository has no root `ORG.md` or legacy `org.md`, for example a repository created on GitHub with only a README. The Create flow runs with connected-repo substitutions: no git check, no local collision check, no git init or identity, no sharing question, and the first saved change writes `ORG.md` together with the contract files. The surface refusal now covers only connection changes: creating a different repository, import, sharing setup, and whole-repository deletion.
- Added the `hosted-create-connected-unset` eval and documented the host contract hosted deployments must satisfy.
```

- [ ] **Step 3: Run every check, push, and open the PR**

```bash
python3 scripts/check_repo_layout.py
python3 scripts/check_skill_compatibility.py
python3 evals/run_quality.py
python3 -m unittest evals/test_run_quality.py
git add VERSIONS.md CHANGELOG.md
git commit -m "Release 0.2.0: hosted workspace set-up on a connected repo"
git push -u origin hosted-workspace-setup
gh pr create --title "Create a GTM workspace in place on a hosted surface (0.2.0)" --body-file - <<'EOF'
## Summary
- `gtm-workspace` Create runs on a connected repo that is not set up yet (README-only repo), with connected-repo substitutions
- Surface refusal narrowed to connection changes
- New eval `hosted-create-connected-unset`; host contract documented
- Release 0.2.0, library generation 13 unchanged

## Checks
- check_repo_layout, check_skill_compatibility, run_quality, test_run_quality all pass
EOF
```

- [ ] **Step 4: After merge, tag**

```bash
git checkout main && git pull --ff-only
git tag -a v0.2.0 -m "GTM Skills 0.2.0"
git push origin v0.2.0
```

Record the merge commit SHA; Task 13 vendors exactly that commit.

---

# Phase 2: gtm-agent

### Task 7: Verification accepts a checkout without an organization file

**Files:**
- Modify: `agent/lib/workspace-checkout.ts:284-296` (`createVerificationCommand`)
- Modify: `agent/lib/workspace-checkout.ts:112-125` (`hydrateWorkspaceCheckout` error)
- Test: `tests/workspace-checkout.test.mjs`

**Interfaces:**
- Produces: `verifyWorkspaceCheckout` now resolves for a README-only checkout. Signature unchanged: `(sandbox, workspace, expectedHead?) => Promise<string>`.

- [ ] **Step 1: Create a branch**

```bash
cd /Users/eliasstravik/dev/gtm-agent
git checkout main && git pull --ff-only
git checkout -b slack-workspace-setup
```

- [ ] **Step 2: Change the existing failing-case test into the new accepted-case test**

In `tests/workspace-checkout.test.mjs`, replace the whole test named `real Git verification rejects a checkout without a root organization file` with:

```js
test("real Git verification accepts a README-only checkout as not yet set up", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-workspace-unset-"),
  );
  const repository = join(temporaryRoot, "repository");
  const fixtureWorkspace = {
    ...workspace,
    checkoutDirectory: repository,
    staleMarker: join(temporaryRoot, ".stale"),
  };
  const sandbox = {
    async run({ command }) {
      const result = spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        env: { HOME: temporaryRoot, PATH: process.env.PATH },
      });
      return {
        exitCode: result.status ?? 1,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
  };

  try {
    await mkdir(repository, { recursive: true });
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.email", "fixture@example.test"]);
    git(repository, ["config", "user.name", "Fixture"]);
    await writeFile(join(repository, "README.md"), "# Workspace\n", "utf8");
    git(repository, ["add", "README.md"]);
    git(repository, ["commit", "-m", "Initial commit"]);
    const head = git(repository, ["rev-parse", "HEAD"]);

    assert.equal(await verifyWorkspaceCheckout(sandbox, fixtureWorkspace, head), head);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
```

Also in the test `hydration clones main without credentials and restores deny-all`, replace these two lines:

```js
  assert.match(commands[1], /ORG\.md/);
  assert.match(commands[1], /else[\s\S]+org\.md/);
```

with:

```js
  assert.doesNotMatch(commands[1], /ORG\.md|org\.md/);
```

And in the test `hydration fails closed and never includes authorization in errors`, add after `assert.match(error.message, /checkout failed/i);`:

```js
      assert.match(error.message, /at least one commit/i);
```

- [ ] **Step 3: Run the tests to see them fail**

```bash
node --test tests/workspace-checkout.test.mjs
```

Expected: the README-only test fails with `GTM workspace verification failed`, the hydration test fails on the `doesNotMatch`, and the fail-closed test fails on `at least one commit`.

- [ ] **Step 4: Remove the organization-file requirement from the verification command**

In `createVerificationCommand`, delete these lines:

```bash
if test -f "$repo_dir/ORG.md" && test ! -L "$repo_dir/ORG.md"; then
  :
else
  test -f "$repo_dir/org.md"
  test ! -L "$repo_dir/org.md"
fi
```

The tracked-symlink check that follows (`ls-files --stage` with modes `120000`/`160000`) still rejects a symlinked organization file, and `status --porcelain` still rejects an untracked one.

- [ ] **Step 5: Make the clone error say what a deployer must fix**

In `hydrateWorkspaceCheckout`, replace:

```ts
  try {
    await runCredentialFree(
      sandbox,
      createCloneCommand(workspace),
      "GTM workspace checkout",
    );
  } finally {
    await closeSandboxEgress(sandbox, baselinePolicy);
  }
```

with:

```ts
  try {
    await runCredentialFree(
      sandbox,
      createCloneCommand(workspace),
      "GTM workspace checkout",
    );
  } catch (error) {
    if (error instanceof Error && /^GTM workspace checkout failed/.test(error.message)) {
      throw new Error(
        "GTM workspace checkout failed. Confirm GTM_WORKSPACE_REPOSITORY names a repository whose main branch has at least one commit (a new repository created with a README is enough) and that the GitHub connector can read it, then start a fresh Slack thread.",
      );
    }
    throw error;
  } finally {
    await closeSandboxEgress(sandbox, baselinePolicy);
  }
```

- [ ] **Step 6: Run the tests**

```bash
node --test tests/workspace-checkout.test.mjs
```

Expected: PASS for every test in the file.

- [ ] **Step 7: Commit**

```bash
git add agent/lib/workspace-checkout.ts tests/workspace-checkout.test.mjs
git commit -m "Accept a connected workspace checkout that is not set up yet"
```

---

### Task 8: Mutation preflight enforces ORG.md-first on an uninitialized checkout

**Files:**
- Modify: `agent/lib/workspace-checkout.ts:181-196` (`assertWorkspaceCheckoutReady`)
- Modify: `agent/lib/workspace-checkout.ts:320-339` (`createMutationPreflightCommand`)
- Modify: `agent/lib/workspace-checkout.ts:398-412` (`assertPreflightSucceeded`)
- Test: `tests/workspace-checkout.test.mjs`

**Interfaces:**
- Produces: `assertWorkspaceCheckoutReady({ workspace, expectedHead, paths, sandbox, initializing?: boolean })`. `initializing` defaults to `false`. When `false` and the checkout has neither `ORG.md` nor `org.md`, it rejects with a message containing `not set up yet`.

- [ ] **Step 1: Add the failing tests**

Append to `tests/workspace-checkout.test.mjs`:

```js
test("mutation preflight refuses a non-scaffold write until root ORG.md exists", async () => {
  const commands = [];
  const sandbox = {
    async run(input) {
      commands.push(input.command);
      return { exitCode: 0, stderr: "", stdout: "" };
    },
  };
  await assertWorkspaceCheckoutReady({
    workspace,
    expectedHead: "d".repeat(40),
    paths: ["icps/enterprise/ICP.md"],
    sandbox,
  });
  assert.match(commands[0], /fail UNINITIALIZED/);
  assert.match(commands[0], /test -f "\$repo_dir\/ORG\.md" \|\| test -f "\$repo_dir\/org\.md"/);

  await assertWorkspaceCheckoutReady({
    workspace,
    expectedHead: "d".repeat(40),
    paths: ["ORG.md", "AGENTS.md", "CLAUDE.md", ".gitignore"],
    initializing: true,
    sandbox,
  });
  assert.doesNotMatch(commands[1], /UNINITIALIZED/);
});

test("real Git preflight rejects an ordinary write to a README-only checkout and accepts the scaffold", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-workspace-unset-preflight-"),
  );
  const repository = join(temporaryRoot, "repository");
  const fixtureWorkspace = {
    ...workspace,
    checkoutDirectory: repository,
    staleMarker: join(temporaryRoot, ".stale"),
  };
  const sandbox = {
    async run({ command }) {
      const result = spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        env: { HOME: temporaryRoot, PATH: process.env.PATH },
      });
      return {
        exitCode: result.status ?? 1,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
  };

  try {
    await mkdir(repository, { recursive: true });
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.email", "fixture@example.test"]);
    git(repository, ["config", "user.name", "Fixture"]);
    await writeFile(join(repository, "README.md"), "# Workspace\n", "utf8");
    git(repository, ["add", "README.md"]);
    git(repository, ["commit", "-m", "Initial commit"]);
    const head = git(repository, ["rev-parse", "HEAD"]);

    await assert.rejects(
      assertWorkspaceCheckoutReady({
        workspace: fixtureWorkspace,
        expectedHead: head,
        paths: ["icps/enterprise/ICP.md"],
        sandbox,
      }),
      /not set up yet/i,
    );
    await assertWorkspaceCheckoutReady({
      workspace: fixtureWorkspace,
      expectedHead: head,
      paths: ["ORG.md", "AGENTS.md", "CLAUDE.md", ".gitignore"],
      initializing: true,
      sandbox,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run to see them fail**

```bash
node --test tests/workspace-checkout.test.mjs
```

Expected: both new tests fail (`fail UNINITIALIZED` not found; the real-Git rejection does not happen).

- [ ] **Step 3: Implement**

Change `assertWorkspaceCheckoutReady`:

```ts
export async function assertWorkspaceCheckoutReady({
  workspace,
  expectedHead,
  paths,
  sandbox,
  initializing = false,
}: {
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly expectedHead: string;
  readonly paths: readonly string[];
  readonly sandbox: Pick<SandboxSession, "run">;
  /**
   * True when the mutation writes root `ORG.md`. Only such a mutation may
   * touch a checkout that has no organization file yet, so the first saved
   * change on a README-only repository is always the workspace scaffold.
   */
  readonly initializing?: boolean;
}): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    createMutationPreflightCommand(workspace, expectedHead, paths, initializing),
  );
  assertPreflightSucceeded(result);
}
```

Change `createMutationPreflightCommand`:

```ts
function createMutationPreflightCommand(
  workspace: ConnectedWorkspaceConfiguration,
  expectedHead: string,
  paths: readonly string[],
  initializing: boolean,
): string {
  const symlinkChecks = paths
    .flatMap((path) => pathPrefixes(path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .map((path) => `test ! -L "$repo_dir/${path}"`)
    .join("\n");
  const organizationCheck = initializing
    ? ""
    : `test -f "$repo_dir/ORG.md" || test -f "$repo_dir/org.md" || fail UNINITIALIZED\n`;

  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
fail() { printf '%s\n' "$1"; exit 1; }
test ! -e "${workspace.staleMarker}" || fail STALE
test -z "$(git -C "$repo_dir" status --porcelain)" || fail DIRTY
test "$(git -C "$repo_dir" branch --show-current)" = "${workspace.branch}" || fail WRONG_BRANCH
test "$(git -C "$repo_dir" rev-parse HEAD)" = "${expectedHead}" || fail WRONG_HEAD
${organizationCheck}${symlinkChecks}`;
}
```

Add the message in `assertPreflightSucceeded`:

```ts
    UNINITIALIZED:
      "The connected workspace is not set up yet: the first saved change must write root ORG.md. Run the gtm-workspace create flow for the connected repository.",
```

- [ ] **Step 4: Run the tests**

```bash
node --test tests/workspace-checkout.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/lib/workspace-checkout.ts tests/workspace-checkout.test.mjs
git commit -m "Require the first write to an unset workspace to be the ORG.md scaffold"
```

---

### Task 9: The write tool passes `initializing` from the manifest

**Files:**
- Modify: `agent/tools/apply_gtm_workspace_changes.ts:117-119` (description) and `:161-168` (`assertWorkspaceReady`)
- Test: none added (see Step 1)

- [ ] **Step 1: Confirm no existing test reaches the preflight through the tool**

`tests/template-surface.test.mjs` calls the tool only in Slack-only mode and with an invalid path, and both cases throw before `getSandbox` is used (verified 2026-09-02). The preflight behavior is covered by the `assertWorkspaceCheckoutReady` tests from Task 8, so this task adds no test.

- [ ] **Step 2: Pass the flag**

Replace:

```ts
        assertWorkspaceReady: (expectedHead, paths) =>
          assertWorkspaceCheckoutReady({
            workspace,
            expectedHead,
            paths,
            sandbox,
          }),
```

with:

```ts
        assertWorkspaceReady: (expectedHead, paths) =>
          assertWorkspaceCheckoutReady({
            workspace,
            expectedHead,
            paths,
            sandbox,
            initializing: mutation.manifest.some(
              (entry) => entry.path === "ORG.md" && entry.operation === "write",
            ),
          }),
```

- [ ] **Step 3: Extend the tool description**

Append to the `description` string, before the closing quote:

```
 On a connected repository that has no root ORG.md yet, the first change must write ORG.md together with AGENTS.md, CLAUDE.md, and .gitignore; any other write is refused until then.
```

- [ ] **Step 4: Run the full test suite and typecheck**

```bash
pnpm typecheck && pnpm test
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/tools/apply_gtm_workspace_changes.ts
git commit -m "apply_gtm_workspace_changes: allow only the ORG.md scaffold on an unset workspace"
```

---

### Task 10: Standing instructions declare the connected-repo substitutions

**Files:**
- Modify: `agent/instructions.md` (section `# Fixed connection boundaries`)
- Test: `tests/instructions.test.mjs`

- [ ] **Step 1: Add the failing test patterns**

In `tests/instructions.test.mjs`, in the first test's pattern list, add after `/\/gtm-workspace.*keyboard/is,`:

```js
    /not set up yet/i,
    /connected-repo substitutions/i,
    /ORG\.md[\s\S]*AGENTS\.md[\s\S]*CLAUDE\.md[\s\S]*\.gitignore/,
    /refuses any other write until root `ORG\.md` exists/i,
    /create a different (?:workspace )?repository/i,
```

- [ ] **Step 2: Run to see it fail**

```bash
node --test tests/instructions.test.mjs
```

Expected: FAIL on `not set up yet`.

- [ ] **Step 3: Rewrite the boundary bullets**

In `agent/instructions.md`, under `# Fixed connection boundaries`, replace the bullet that begins `- This Slack deployment may update, delete, or doctor content` with these two bullets:

```markdown
- This Slack deployment may update, delete, or doctor content inside its configured repository. Refuse requests to create a different workspace repository, import, configure connection sharing, or perform whole-workspace deletion; those change which repository is connected and require `/gtm-workspace` at a keyboard.
- When the connected checkout has no root `ORG.md` and no legacy `org.md`, the connected workspace is not set up yet, and a request to create or set up the workspace targets the connected repository: run the `gtm-workspace` create flow with its connected-repo substitutions. This environment answers the keyboard steps: git is present, the checkout is the target and needs no `~/.gtm/<org-slug>` collision check, no git init or repo-local identity is set, and the sharing question is skipped because the deployment already shares the repository. The first accepted proposal is one `apply_gtm_workspace_changes` request that writes `ORG.md` together with `AGENTS.md`, `CLAUDE.md`, and `.gitignore` rendered from the skill templates; the tool refuses any other write until root `ORG.md` exists. Later accepted artifacts use the ordinary write path. Leave a README or any other file outside the contract untouched.
```

- [ ] **Step 4: Run the test**

```bash
node --test tests/instructions.test.mjs
```

Expected: PASS, including the pre-existing `create.*import.*sharing.*whole-workspace deletion` and `/gtm-workspace.*keyboard` patterns.

- [ ] **Step 5: Commit**

```bash
git add agent/instructions.md tests/instructions.test.mjs
git commit -m "Instructions: set up a connected workspace from Slack when it is not set up yet"
```

---

### Task 11: Deployment docs and env example

**Files:**
- Modify: `docs/getting-started.md` (prerequisites line 14, section 4, troubleshooting line 106)
- Modify: `README.md` (three-step table cell 3, FAQ)
- Modify: `.env.example` (comment above `GTM_WORKSPACE_REPOSITORY`)

- [ ] **Step 1: getting-started prerequisites**

Replace:

```markdown
- For workspace mode, one existing GitHub repository with a `main` branch and root `ORG.md`; a legacy root `org.md` is accepted so the workspace can be migrated
```

with:

```markdown
- For workspace mode, one GitHub repository with a `main` branch that has at least one commit. A new private repository created with "Add a README file" ticked is enough: the agent sets up the workspace from Slack. An existing workspace with root `ORG.md`, or a legacy root `org.md` that the agent can migrate, also works
```

- [ ] **Step 2: getting-started first question**

In `## 4. Ask the first question in Slack`, add before the `With a workspace connected, try:` paragraph:

```markdown
With a fresh repository that has only a README, try:

```text
Set up our GTM workspace.
```

The agent asks for the organization's name, website, and links, researches them, shows the complete proposed organization file, and after your acceptance and approval saves it with the workspace contract files as the first commit on `main`. Suborganizations, members, ICPs, and personas follow in the same thread.
```

- [ ] **Step 3: getting-started troubleshooting**

Replace:

```markdown
- **The agent fails at startup:** confirm `SLACK_CONNECTOR` is set. For workspace mode, confirm both GitHub variables are set and the repository uses `main` with root `ORG.md` or the migratable legacy root `org.md`.
```

with:

```markdown
- **The agent fails at startup:** confirm `SLACK_CONNECTOR` is set. For workspace mode, confirm both GitHub variables are set and the repository has a `main` branch with at least one commit; a repository created without a README has no branch to clone, so push any first commit or recreate it with a README.
- **The agent says the workspace is not set up yet:** the connected repository has no root `ORG.md`. Ask it in Slack to set up the GTM workspace. Until that first scaffold is saved, every other workspace write is refused.
```

- [ ] **Step 4: README**

In the three-step table, replace cell 3's `<sub>` text with:

```html
<sub>Point the deployment at one repository, even a brand-new one with only a README, and finish the workspace setup from Slack. Add a Turso database to host saved workflows.</sub>
```

In `## Get your questions answered`, add after the `### Can I use it without a workspace repository?` answer:

```markdown
### Do I have to build the workspace before deploying?

No. Create a repository on GitHub with a README, point the deployment at it, and say "set up our GTM workspace" in Slack. The agent runs the guided setup and its first approved change becomes the workspace scaffold on `main`.
```

- [ ] **Step 5: .env.example**

Replace the comment line `# Optional, but both values are required when a persistent GTM workspace is enabled.` with:

```
# Optional, but both values are required when a persistent GTM workspace is enabled.
# The repository needs a main branch with at least one commit; a new repository
# created with "Add a README file" is enough, and the agent sets it up from Slack.
```

- [ ] **Step 6: Run the tests and commit**

```bash
pnpm test
git add docs/getting-started.md README.md .env.example
git commit -m "Docs: onboard a client from a README-only repository"
```

---

### Task 12: Live eval for the fresh-workspace path (optional, needs a deployment on a README-only repo)

**Files:**
- Create: `evals/fresh-workspace.eval.ts`

- [ ] **Step 1: Write the eval**

```ts
import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default [
  defineEval({
    description:
      "A connected repository without an organization file starts the create flow in Slack instead of refusing.",
    async test(t) {
      await t.send("Set up our GTM workspace.");
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(
        t.reply,
        includes(
          /\*\*What is the organization's name, website, and any social profiles such as LinkedIn\?\*\*/,
        ),
      );
      t.check(
        t.reply,
        satisfies(
          (reply) => typeof reply === "string" && !/keyboard|Claude Code|Codex/i.test(reply),
          "must not redirect a connected, unset workspace to a keyboard",
        ),
      );
    },
  }),
  defineEval({
    description: "A different-repository create request is still refused.",
    async test(t) {
      await t.send(
        "Create a brand new GTM workspace repository for our sister company in another-owner/another-repo.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(t.reply, includes(/keyboard|gtm-workspace|deployment|configured/i));
    },
  }),
];
```

- [ ] **Step 2: Run it against a deployment whose `GTM_WORKSPACE_REPOSITORY` is a README-only repository**

```bash
pnpm eval
```

Select the fresh-workspace target explicitly as the harness prompts. Expected: both evals pass. This is the same target Task 17 creates, so it can run there.

- [ ] **Step 3: Commit**

```bash
git add evals/fresh-workspace.eval.ts
git commit -m "Evals: fresh workspace setup from Slack"
```

---

### Task 13: Vendor gtm-skills 0.2.0 and open the gtm-agent PR

**Files:**
- Regenerated: `agent/skills/**`, `skills-lock.json`, `LICENSES/gtm-skills-MIT.txt`

Prerequisite: Task 6 merged and `v0.2.0` tagged.

- [ ] **Step 1: Put the local gtm-skills checkout on the tagged commit**

```bash
cd /Users/eliasstravik/dev/gtm-skills
git checkout main && git pull --ff-only
git status --porcelain   # must be empty
git rev-parse HEAD       # must equal the v0.2.0 tag: git rev-parse v0.2.0
```

- [ ] **Step 2: Sync**

```bash
cd /Users/eliasstravik/dev/gtm-agent
pnpm skills:sync /Users/eliasstravik/dev/gtm-skills
git diff --stat
```

Expected output ends with `Vendored 5 GTM skills from <sha>.`; the diff touches `agent/skills/gtm-workspace/**`, `skills-lock.json`, and nothing else unexpected.

- [ ] **Step 3: Full release check**

```bash
pnpm check
```

Expected: skills check, typecheck, tests, and build all pass.

- [ ] **Step 4: Commit, push, PR**

```bash
git add agent/skills skills-lock.json LICENSES
git commit -m "Vendor GTM Skills 0.2.0 (workflow generation 13)"
git push -u origin slack-workspace-setup
gh pr create --title "Set up a connected workspace from Slack" --body-file - <<'EOF'
## Summary
- Bootstrap verification accepts a connected repository whose root has no ORG.md yet (README-only repos)
- Mutation preflight refuses every write to such a checkout unless it writes root ORG.md, so the first commit is always the scaffold
- Instructions declare the gtm-workspace connected-repo substitutions; different-repo create, import, sharing, and whole deletion stay keyboard-only
- Docs: onboard a client from a README-only repository
- Vendors GTM Skills 0.2.0 (library generation 13)

Spec: docs/superpowers/specs/2026-09-02-slack-workspace-initialization-design.md

## Test plan
- pnpm check
- Task 17 rehearsal against a README-only repository
EOF
```

- [ ] **Step 5: After review, merge to `main`**

---

# Phase 3: eve (Elias's deployment of the template)

### Task 14: Port the gtm-agent change into eve, preserving local customizations

**Files (in `/Users/eliasstravik/dev/eve`):**
- Modify: `agent/lib/workspace-checkout.ts`, `agent/tools/apply_gtm_workspace_changes.ts`, `agent/instructions.md`, `.env.example`
- Modify: `tests/workspace-checkout.test.mjs`, `tests/instructions.test.mjs`
- Regenerated: `agent/skills/**`, `skills-lock.json`, `LICENSES/gtm-skills-MIT.txt`

`eve` is a customized copy, not a fork with a shared remote; earlier template changes were re-applied by hand (compare `eve` commit `f3a46a7` with `gtm-agent` `062bf43`). Preserve these eve-only differences while porting: the identity line `You are Elias Stråvik's Eve agent`, the `# Slack response budget` section, the `/workspace/.gtm/` resolution note and the "Durable GitHub persistence is mandatory" sentence in the workspace section, `resolveSourceEditorModel` and its defaults in `config.ts`, and the extra tests `no-web-chat.test.mjs` and `slack-response-budget.test.mjs`.

- [ ] **Step 1: Branch and apply the code patch**

```bash
cd /Users/eliasstravik/dev/gtm-agent
git checkout main && git pull --ff-only
git diff 9869519..main -- agent/lib/workspace-checkout.ts agent/tools/apply_gtm_workspace_changes.ts .env.example tests/workspace-checkout.test.mjs tests/template-surface.test.mjs > /tmp/eve-port.patch

cd /Users/eliasstravik/dev/eve
git checkout main && git pull --ff-only
git checkout -b slack-workspace-setup
git apply --3way /tmp/eve-port.patch
```

`9869519` is `gtm-agent` `main` before this work ("Vendor GTM Skills 0.1.2"). Expected: applies cleanly; these files are identical between the two repositories before this change (verified with `diff -rq` on 2026-09-02). Resolve any conflict by taking the gtm-agent side. Drop `tests/template-surface.test.mjs` from the path list if Task 9 left it untouched.

- [ ] **Step 2: Apply the instructions change by hand**

In `eve/agent/instructions.md`, under `# Fixed connection boundaries`, replace the `- This Slack deployment may update, delete, or doctor content` bullet with the two bullets from Task 10 Step 3, verbatim. Do not touch the identity line, the Slack response budget section, or the eve-specific workspace bullets.

In `eve/tests/instructions.test.mjs`, add the five patterns from Task 10 Step 1 in the same place.

- [ ] **Step 3: Vendor 0.2.0 and run checks**

```bash
pnpm skills:sync /Users/eliasstravik/dev/gtm-skills
pnpm check
```

Expected: `Vendored 5 GTM skills from <same sha as gtm-agent>.` and all checks pass, including the eve-only tests.

- [ ] **Step 4: Commit, push, PR**

```bash
git add -A
git commit -m "Set up a connected workspace from Slack; vendor GTM Skills 0.2.0 (#N)"
git push -u origin slack-workspace-setup
gh pr create --title "Set up a connected workspace from Slack; vendor GTM Skills 0.2.0" --body "Ports eliasstravik/gtm-agent PR for Slack workspace setup, preserving eve customizations. Vendors gtm-skills v0.2.0."
```

---

### Task 15: Deploy eve and smoke-test in Slack

No env changes are required: `GTM_WORKSPACE_REPOSITORY` still points at `eliasstravik/gtm-eliasstravik`, which is already set up.

- [ ] **Step 1: Merge the PR; Vercel deploys `main` through the project's Git connection**

Watch the production deployment for Vercel project `eve` (team `team_bBA4TJIEGG9AijukSUUyjeV6`) reach Ready.

- [ ] **Step 2: Health**

Open the production deployment's `/eve/v1/health`. Expected: healthy.

- [ ] **Step 3: Slack smoke tests, one per fresh thread**

| Message | Expected |
| --- | --- |
| `Check and repair our GTM workspace.` | Doctor runs on the connected checkout, reports a clean bill of health, writes nothing. The missing remote is not reported as a defect. |
| `Set up a brand new GTM workspace for our sister company Delta Robotics.` | Refusal: creating a different repository needs `/gtm-workspace` at a keyboard. Nothing drafted or researched. |
| `Update Elias Stråvik's member record: add the role line "Founder". Show the exact change.` | Ordinary update: preview, numbered accept loop, native approval, one commit URL. Then deny at approval in a second run to confirm "no durable change was made". |

- [ ] **Step 4: Record the outcome**

Note the deployment URL, commit SHA, and the three results in the PR conversation.

---

# Phase 4: gtm-eliasstravik and client rehearsal

### Task 16: Confirm the live workspace needs no change

**Files:** none modified.

`gtm-eliasstravik` already has root `ORG.md`, so the new "not set up yet" path never triggers for it. Its `AGENTS.md`, `CLAUDE.md`, and `.gitignore` are byte-identical to the 0.2.0 skill templates (verified 2026-09-02), and this release does not change those templates.

- [ ] **Step 1: Verify contract files still match the vendored templates after Task 13**

```bash
cd /Users/eliasstravik/dev/gtm-eliasstravik && git pull --ff-only
for f in AGENTS.md CLAUDE.md; do diff /Users/eliasstravik/dev/gtm-agent/agent/skills/gtm-workspace/templates/$f $f && echo "$f in sync"; done
diff /Users/eliasstravik/dev/gtm-agent/agent/skills/gtm-workspace/templates/gitignore .gitignore && echo ".gitignore in sync"
```

Expected: three "in sync" lines. If any differ, run the doctor flow from Slack (Task 15 Step 3) and accept its repair as the fix; do not hand-edit.

- [ ] **Step 2: Confirm the Task 15 doctor run left the repository unchanged**

```bash
git log --oneline -3
```

Expected: HEAD is still `78ffec1` unless a doctor repair was accepted in Task 15.

---

### Task 17: Rehearse the client onboarding end to end

This exercises the actual client path with the template, not the customized `eve` deployment. It is the acceptance test for the whole plan.

- [ ] **Step 1: Create a README-only repository**

On GitHub, in the `eliasstravik` account: new private repository `gtm-onboarding-rehearsal`, default branch `main`, "Add a README file" ticked, no license, no `.gitignore`.

- [ ] **Step 2: Deploy the template**

Use the "Recommended" Deploy button in `docs/getting-started.md`. Project name `gtm-onboarding-rehearsal`, connect Slack (a test workspace or a dedicated channel), `GTM_WORKSPACE_REPOSITORY=eliasstravik/gtm-onboarding-rehearsal`.

- [ ] **Step 3: Connector and redeploy**

```bash
vercel connect create github
```

Grant only `eliasstravik/gtm-onboarding-rehearsal`, set `GITHUB_CONNECTOR` on the project, redeploy. Check `/eve/v1/health`.

While here, re-check the current Vercel Deploy Button and Connect documentation for whether a GitHub connector with a repository grant can now be created by the button. If it can, update the `connect=` parameter of both Deploy buttons in `docs/getting-started.md` and `README.md` in a follow-up PR; that removes this manual step for every future client.

- [ ] **Step 4: Run the setup from Slack**

In the connected channel: `@GTM Agent set up our GTM workspace.`

Expected sequence:

1. First reply is the exact bold root identity question; no keyboard redirect.
2. Answer with a fictional org and website; answer `none` for sources.
3. The agent shows `Here is the complete proposed ~/.gtm/<slug>/ORG.md:` with all 13 company-data fields, then the three numbered choices.
4. Reply `1`. The native approval card lists exactly `ORG.md`, `AGENTS.md`, `CLAUDE.md`, `.gitignore`.
5. Approve. The reply reports the four paths and a GitHub commit URL. The repository now has two commits and the README is untouched.
6. Choose no suborganizations, skip members. The close says the workspace is saved in the connected repository and recommends the ICP step. No sharing question was asked.

- [ ] **Step 5: Run the fresh-workspace evals against this deployment (Task 12)**

```bash
cd /Users/eliasstravik/dev/gtm-agent && pnpm eval
```

Select the rehearsal deployment. Expected: pass.

- [ ] **Step 6: Tear down**

Delete the Vercel project `gtm-onboarding-rehearsal`, its connectors, and the GitHub repository, or keep the repository as a reference example of a freshly initialized workspace.

- [ ] **Step 7: Update the onboarding page**

Republish the shareable onboarding page (artifact "GTM Agent Onboarding") only if the rehearsal changed any step; otherwise it already matches this plan.
