# Workspace gtm-eliasstravik: upgrade to workflow library generation 14

Date: 2026-09-09
Repo: `/Users/eliasstravik/.gtm/gtm-eliasstravik`
Template source: `/Users/eliasstravik/dev/gtm-skills/.claude/worktrees/workflow-diagrams-0.4.0/skills/gtm-workflow/templates/` (gtm-skills release branch, commit 92c171b)

## Result

The workspace is on generation 14 and `gtm check` passes. One commit was prepared on `main` and
nothing was pushed.

| Item | Value |
| --- | --- |
| HEAD before pull | `f58d832` chore: verify Vercel Git deployment |
| HEAD after pull | `96492d0` Remove 3 SMB ICPs |
| HEAD after upgrade | `cd5f6fd` chore(workflows): adopt workflow library generation 14 |
| `gtm.libVersion` before | 13 |
| `gtm.libVersion` after | 14 |
| `gtm check` | `{"ok":true,"workflows":0,"libVersion":14,"warnings":[]}` |

## Step 1: pull

`git status --short` was clean. `git pull --ff-only origin main` fast-forwarded from `f58d832` to
`96492d0` (verified `f58d832` is an ancestor of the new HEAD).

The pull brought in upstream commit `8094bae` "Remove monitor GTM engineering questions workflow".
**After the pull, `workflows/workflows/` does not exist and the workspace has zero workflows.** The
task brief assumed at least one workflow was present; that assumption was one commit stale.

`workflows/db/tables/reddit_posts.ts`, the six committed migrations under `workflows/drizzle/`, and
the `monid` and `slack` providers remain in place. `gtm check` does not flag the table as an orphan.

## Step 2: recopy of managed files

Compared the template against the workspace before copying. There were **no workspace-only files**
in `lib/` or `server/`, and **no workspace-only entries** in `dependencies` or `devDependencies`.

Copied verbatim from the template:

- All of `lib/` (11 files updated; 8 new: `diagram.ts`, `diagram-overlay.ts`, `diagram-page.ts`,
  `diagram-route.ts`, `diagram-svg.ts`, `diagram-text.ts`, `layout.ts`, `sign.ts`)
- All of `server/` (6 routes updated; 3 new: `api/diagram/[...workflow].get.ts`,
  `api/diagram-image/[...workflow].get.ts`, `routes/gtm/diagram/[...workflow].get.ts`)
- `scripts/gtm.ts`, `scripts/migrate-cloud.ts`, `scripts/verify-migrations.ts`
- `drizzle.config.ts`, `nitro.config.ts`
- `assets/fonts/Inter-Regular.ttf` and `assets/fonts/LICENSE-Inter.txt` (both new)
- `package-lock.json` (verbatim, since the workspace has no provider-only dependencies)

`package.json` took `gtm.libVersion`, `gtm.libHashes`, `gtm.validatedAgainst`, `gtm.temporary`,
`dependencies`, `devDependencies`, `scripts`, and `engines` from the template. The workspace `name`
(`gtm-workflows`, identical to the template) and the `gtm.vercel` block were kept:

```json
"vercel": {
  "team": "stravik",
  "project": "gtm-eliasstravik-workflows",
  "rootDirectory": "workflows",
  "url": "https://gtm-eliasstravik-workflows.vercel.app"
}
```

Three dependencies are new in generation 14: `@dagrejs/dagre` 3.1.1, `@resvg/resvg-js` 2.6.2, and
`typescript-parser` (aliased to `typescript@5.9.3`). They back the diagram layout, PNG rendering,
and graph extraction.

Not touched, as instructed: `providers/`, `db/tables/`, `drizzle/`, `.env*`, `vercel.json`.

### Ignore-file diff

`.vercelignore` was already identical to the template. `.gitignore` differed by one line: the
workspace carried a redundant trailing `.vercel` on line 11, already covered by `.vercel/` on line
3. The template content was copied over, removing the duplicate. No tracked pattern changed and
`.vercel/` remains ignored.

`.env.example` was left alone. It carries workspace provider keys (`MONID_API_KEY`,
`SLACK_BOT_TOKEN`, `SLACK_CHANNEL_ID`) beyond the template, and it is not a managed file.

## Step 3: check

`npm ci --include=dev --ignore-scripts --no-audit --no-fund` added 529 packages. `npm run gtm --
check` returned `{"ok":true,"workflows":0,"libVersion":14,"warnings":[]}` on the first attempt.

No `diagram_rules` findings were possible, because the workspace has no workflows.

## Steps 4 and 5: diagram and dry run, by smoke test

With zero workflows there was nothing to diagram or dry-run. To verify the generation 14 diagram
pipeline actually works in this workspace, the workflow deleted upstream was restored from
`8094bae~1` into `workflows/workflows/monitor-gtmengineering-questions.ts` **as a throwaway**, run
through the whole flow, and then deleted. It was never staged or committed. The workspace ended
clean and `gtm check` was re-run afterwards to confirm `workflows: 0`.

The unmodified generation 13 workflow produced exactly the six findings the contract predicts:

```
diagram_rules: 6 diagram rule findings.
step_label_missing  :70  fetchRecentRedditPosts has no label.
step_label_missing  :125 selectUnseenPosts has no label.
step_label_missing  :137 classifyRedditPost has no label.
step_label_missing  :182 saveRedditPost has no label.
step_label_missing  :190 publishQuestionToSlack has no label.
stage_attributes_missing :209 workflow body never calls setAttributes.
```

Applying the fixes exactly as each fix line described (a JSDoc label above each `"use step"`
function, `setAttributes({ stage })` imported from `"workflow"` before each stage, and a `//`
comment naming the loop and each `if` decision) turned the check green:
`{"ok":true,"workflows":1,"libVersion":14,"warnings":[]}`. No step needed to be moved out of a
helper or callback.

ASCII diagram:

```
Input
Fetch recent posts from the subreddit
Keep only posts not already saved
[For each post we have not seen before]
  Classify the post and summarise the ask
  Save the post to the results table
  Post the question card to Slack
  Save the post to the results table
  (next: Classify the post and summarise the ask)
Done
```

The JSON graph matched the workflow's real shape: eight nodes, one `loop` group, a back edge from
the final save to the classify step, and correct provider attribution (`monid` on the fetch step,
`model` on the classify step).

Zero-spend dry run with a minimal input under the ignored `data/` directory:

```
{"workflow":"monitor-gtmengineering-questions","rows":1,
 "stages":["Fetch recent posts from the subreddit","Keep only posts not already saved",
           "Classify the post and summarise the ask","Save the post to the results table",
           "Post the question card to Slack","Save the post to the results table"],
 "maxRows":1,"costPerRowUsd":0.26,"projectedCostUsd":0.26,"maxSpendUsd":0.26,"withinCaps":true}
```

No real run was started and no `.env` content was printed or written anywhere.

## Step 6: commits

One commit, on `main`, not pushed:

- `cd5f6fd` `chore(workflows): adopt workflow library generation 14` — 37 files, the managed
  library, server routes, scripts, configs, font assets, `package.json`, `package-lock.json`, and
  `.gitignore`.

The planned second commit, `feat(workflows): label steps and mark stages for the workflow diagram`,
**was not created**. It would have been empty: the workspace has no workflow files to label.

## Observations for the controller

1. **This workspace has no workflows.** The generation 14 upgrade is complete and correct, but the
   diagram feature has no subject here until someone authors a workflow. Anyone expecting the
   Reddit monitor to still exist should know it was removed upstream in `8094bae`.
2. **`if` branches do not appear in the graph.** The house rule "Paths are visible" asks for a `//`
   comment naming each `if` decision, but the generation 14 extractor rendered the smoke workflow's
   two `if` decisions as a straight sequence, with no branch node or group. Only the `for..of` loop
   became a group. If branch nodes are intended, the extractor or the rule wording needs a look.
3. **`npm ci --ignore-scripts` and `@resvg/resvg-js`.** The install was clean and `gtm check` and
   the ASCII and JSON diagram formats all work. PNG rendering through `@resvg/resvg-js` was not
   exercised, and that package ships a native binary. Worth a check before relying on the
   `diagram-image` route.
4. `workflows/drizzle/` holds six migrations against the template's four. That is expected: the
   extra two are this workspace's own `reddit_posts` table history, and generation 14 needs no
   schema change.
