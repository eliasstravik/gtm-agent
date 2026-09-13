# gtm-notably workspace upgrade to workflow library generation 14

Date: 2026-09-09
Repo: `/Users/eliasstravik/.gtm/gtm-notably` (Notably-PR/gtm-notably), branch `main`, not pushed.
Template source: `/Users/eliasstravik/dev/gtm-skills/.claude/worktrees/workflow-diagrams-0.4.0/skills/gtm-workflow/templates/` (gtm-skills release branch, commit 92c171b).

## Result

| Item | Before | After |
| --- | --- | --- |
| HEAD | `e41498c` | `c88b087` |
| `gtm.libVersion` | 13 | 14 |
| `gtm check` | not run (no install) | `{"ok":true,"workflows":2,"libVersion":14,"warnings":[]}` |

Two commits, both unpushed:

- `8884561 chore(workflows): adopt workflow library generation 14`
- `c88b087 feat(workflows): label steps and mark stages for the workflow diagram`

The fast-forward pull from `origin main` reported already up to date. The working tree was clean before and after.

## Local modifications found against the v13 template

Every `workflows/lib/*.ts`, every server route, `scripts/migrate-cloud.ts`, `scripts/verify-migrations.ts`, `drizzle.config.ts`, and `nitro.config.ts` matched the v13 template byte for byte.

One managed file carried a local modification, `workflows/scripts/gtm.ts`, four added lines inside the remote read-only-token guard:

```ts
  if (!readOnlyToken) {
    if (process.env.GTM_SANDBOX === "1") {
      delete process.env.TURSO_AUTH_TOKEN;
      return;
    }
    throw new AppError(
      "missing_read_only_token",
      "TURSO_READ_ONLY_AUTH_TOKEN is required for remote read-only commands; the write token is never used.",
      2,
    );
  }
```

This let a sandbox run remote read-only commands without a `TURSO_READ_ONLY_AUTH_TOKEN`, dropping the write token instead of failing. The string `GTM_SANDBOX` appears in neither the v13 nor the v14 `scripts/gtm.ts`, so this was a workspace-only patch and not an older template generation. Per the upgrade contract, managed files are recopied verbatim from the template, so the recopy dropped this patch. If the hosted sandbox depended on it, `gtm query --cloud` and the other remote read-only commands will now fail with `missing_read_only_token` until a read-only token is provided. This belongs upstream in the template if it is still wanted.

Two unmanaged files also differ from the template and were deliberately left alone:

- `workflows/.env.example` adds `MONID_API_KEY=` for the Monid provider adapters.
- The ignore files were not in the recopy set and were not compared.

## What was recopied

- All of `lib/` (10 files updated, 8 new: `diagram.ts`, `diagram-overlay.ts`, `diagram-page.ts`, `diagram-route.ts`, `diagram-svg.ts`, `diagram-text.ts`, `layout.ts`, `sign.ts`).
- All of `server/` (7 routes updated, 3 new: `api/diagram/[...workflow].get.ts`, `api/diagram-image/[...workflow].get.ts`, `routes/gtm/diagram/[...workflow].get.ts`).
- `scripts/gtm.ts`, `scripts/migrate-cloud.ts`, `scripts/verify-migrations.ts`, `drizzle.config.ts`, `nitro.config.ts`.
- `assets/fonts/Inter-Regular.ttf` and `assets/fonts/LICENSE-Inter.txt` (new directory).

Untouched, as instructed: `workflows/providers/`, `workflows/db/tables/`, `workflows/drizzle/`, the environment files, and the ignore files. There is no `vercel.json` in this workspace.

## package.json merge

Taken from the v14 template: `engines`, `scripts`, `dependencies`, `devDependencies`, `gtm.libVersion`, `gtm.libHashes`, `gtm.validatedAgainst`, `gtm.temporary`.

Kept from the workspace: `name` (`gtm-workflows`), `version`, `private`, `type`, `overrides` (`{"nanoid": "5.1.16"}`), and the whole `gtm.vercel` block (team `notably`, project `gtm-notably-workflows`, rootDirectory `workflows`, url `https://gtm-notably-workflows.vercel.app`).

The workspace had no workspace-only dependencies and no version drift against the v13 template, so nothing had to be carried across for the Monid providers. The three new v14 dependencies are `@dagrejs/dagre@3.1.1`, `@resvg/resvg-js@2.6.2`, and `typescript-parser` (`npm:typescript@5.9.3`).

`npm install --package-lock-only --ignore-scripts --no-audit --no-fund` regenerated the lockfile (247 added lines). The nanoid override survived: `node_modules/nanoid` resolves to `nanoid-5.1.16.tgz` even though `ai` requests `5.1.6`.

`npm ci --include=dev --ignore-scripts --no-audit --no-fund` added 529 packages cleanly.

## gtm check findings and fixes

The first `gtm check` after the recopy returned one `diagram_rules` error with 26 findings, exactly as expected for a v13 project:

- 14 `step_label_missing`, one per `"use step"` function across both workflows.
- 12 `step_hidden_in_helper`, all of them step calls made from the plain helpers `processLead` and `processPost`.

There were no `stage_attributes_missing` findings, because both workflows end in `runRows()`, which writes the stage attributes itself.

### Fixes applied

Every `"use step"` function received a JSDoc label on the line above it.

`qualify-linkedin-leads.ts`

| Step | Label |
| --- | --- |
| `enrichLinkedInLead` | Enrich the LinkedIn profile |
| `saveEnrichment` | Save the enriched profile |
| `saveEmptyProfile` | Save the empty profile |
| `qualifyPerson` | Qualify the person against the saved personas |
| `recordLeadFailure` | Record the failed lead |
| `processLead` | Enrich and qualify one lead |
| `saveLead` | Save the qualified lead |

`reddit-pr-advice-drafts.ts`

| Step | Label |
| --- | --- |
| `fetchRecentRedditPosts` | Fetch recent r/PublicRelations posts |
| `saveFetchedPosts` | Save the fetched posts |
| `classifyPost` | Classify the post as a PR question |
| `saveClassification` | Save the classification |
| `draftHelpfulComment` | Draft a helpful PR comment |
| `saveDraft` | Save the drafted comment |
| `recordPostFailure` | Record the failed post |
| `processPost` | Classify one post and draft its comment |
| `savePost` | Save the post row |

For `step_hidden_in_helper` the fix line offers two remedies: call the step from the workflow body, or make the helper a `"use step"` function with its own label. The first is not available here. `processLead` and `processPost` are the `rowStep` passed to `runRows()`, and the contract requires row bookkeeping to stay inside `runRows()`, so their step calls cannot move into the workflow body without abandoning the mandated helper. The second remedy was applied: both helpers became `"use step"` functions with labels, and both were given `maxRetries = 0`.

`lib/diagram.ts` confirms this is the intended v14 shape. Its `runRows` handler emits the row step as a single node inside a `For each row` loop group only when that name is a registered step, so `runRows()` expects its row step to be a labelled step.

Setting `maxRetries = 0` preserves current behaviour exactly. Before the change, `processLead` and `processPost` ran inline in the workflow context and a thrown error propagated straight into the per-row catch in `runRows()`. Without an explicit `maxRetries = 0` the runtime would have replayed the whole row on failure. With it, a row still fails once and is recorded once.

A `//` comment naming each branch decision was added above each `if` that changes the path:

- `qualify-linkedin-leads.ts`: `// Did the profile provider return nothing usable?` above `if (enrichment.status === "empty")`.
- `reddit-pr-advice-drafts.ts`: `// Does the post ask for PR help?` above `if (!classification.qualifies)`.

Neither workflow body contains a loop of its own, so no `For each ...` comments were needed. `runRows()` supplies the only loop.

No business behaviour changed. Provider calls, endpoints, TTLs, unit costs, caps (`MAX_ROWS`, `MAX_SPEND_USD`, `COST_PER_ROW_USD`), prompts, schemas, tables, and migrations are all untouched.

The second `gtm check` returned `{"ok":true,"workflows":2,"libVersion":14,"warnings":[]}`.

## Diagrams

`npm run gtm -- diagram qualify-linkedin-leads --format ascii`

```
Rows
[For each row]
  Enrich and qualify one lead
  Save the qualified lead
  Checkpoint
  (next: Enrich and qualify one lead)
Done
```

`npm run gtm -- diagram reddit-pr-advice-drafts --format ascii`

```
Rows
Fetch recent r/PublicRelations posts
Save the fetched posts
[For each row]
  Classify one post and draft its comment
  Save the post row
  Checkpoint
  (next: Classify one post and draft its comment)
Done
```

### JSON shape check

Both JSON graphs match the real control flow of the workflow bodies.

`qualify-linkedin-leads`: 5 nodes, 1 loop group, 5 edges. Start `Rows` feeds the `For each row` group; inside it `processLead` leads to `saveLead` (`kind: "save"`), then `Checkpoint` (`kind: "wait"`), then a back edge labelled `next`, then the exit to `Done`. That is the whole workflow body, which is a single `runRows()` call after the input parse.

`reddit-pr-advice-drafts`: 7 nodes, 1 loop group, 7 edges. Start `Rows`, then `fetchRecentRedditPosts` carrying `provider: "monid-reddit"`, then `saveFetchedPosts`, then the same `For each row` group with `processPost`, `savePost`, `Checkpoint`, the `next` back edge, and the exit to `Done`. The fetch is correctly shown before the loop.

The try/catch around the Reddit fetch does not produce an `on error` branch. Its catch block calls only `updateRun`, which `diagram.ts` lists among the hidden bookkeeping calls, so the block is not seen to contain a step and no error path is drawn. That matches the extractor's documented behaviour: error paths appear only when the catch block itself runs a step.

The per-row error paths inside `processLead` and `processPost` (`recordLeadFailure`, `recordPostFailure`) do not appear either, because the `runRows` handler never walks into the row step. See the concerns below.

## Dry runs

Both dry runs succeeded without credentials, so the workflows import cleanly and the caps still hold.

```
{"workflow":"qualify-linkedin-leads","rows":1,"stages":["Enrich and qualify one lead","Save the qualified lead"],"maxRows":100,"costPerRowUsd":0.05,"projectedCostUsd":0.05,"maxSpendUsd":5,"withinCaps":true}
{"workflow":"reddit-pr-advice-drafts","rows":1,"stages":["Fetch recent r/PublicRelations posts","Save the fetched posts","Classify one post and draft its comment","Save the post row"],"maxRows":10,"costPerRowUsd":0.055,"projectedCostUsd":0.055,"maxSpendUsd":0.6,"withinCaps":true}
```

No real run was attempted. The `--input` flag takes a file path, not inline JSON; the inline form is read as a filename and fails with `ENOENT`.

## Deviations and concerns

1. The sandbox patch in `scripts/gtm.ts` is gone. Recorded above. This is the only local modification the upgrade discarded, and it is a real behaviour change for remote read-only commands run without a read-only token.

2. The row step is now one opaque node on the diagram. Making `processLead` and `processPost` steps satisfies the checker, but the `runRows` handler renders the row step as a single node and never descends into it. The enrich/qualify split, the classify/draft split, the empty-profile branch, the qualifies branch, and both per-row failure paths are therefore invisible on the diagram. This is the v14 design for `runRows()`, not a mistake in these workflows, but it means the diagram understates what a row actually does. The alternative, hoisting each stage into the workflow body, would require abandoning `runRows()` and its centralized bookkeeping, which the contract forbids.

3. Nested steps. `processLead` and `processPost` are now steps that call other steps. The runtime supports this; the workflow package documents hierarchical step names of the form `processOrder/chargeCard`. Worth confirming on the first real run that the ledger's `step` attribution still reads the way the operator expects, since `runRows()` sets the row meta's step to the row step's name while the inner paid steps override it with their own.

4. The house rule "Paths are visible" is now in tension with the row step. The contract says a branch that changes the path should be an `if` in the workflow body, never a condition inside a step. The qualifies branch in `processPost` and the empty-profile branch in `processLead` are now inside a step. `gtm check` does not flag this, and the `//` comments document both, but the tension is real and is a consequence of the sanctioned fix.

5. `workflow.table` is null in both graphs. This looks like an upstream template bug. `lib/diagram.ts` reads the table name with a header lookup for the label `Table`, whose regex requires `Table:` immediately after the leading asterisk and has no case-insensitive flag. Both workflows use the documented header label `Result table:`, which cannot match. Nothing in the v14 skill documents a bare `Table:` header. The workspace headers were left as documented rather than bent to fit the regex. Either `diagram.ts` should read `Result table` or the skill should document `Table:`.

6. No environment file, so no real run and no `db:migrate` or `db:verify`. The v14 upgrade needs no schema change, so this is expected. `gtm check` validated the existing migrations, including the workspace's own `0004` and `0005`.

7. No type check was run. The workspace has no `tsconfig.json` and no typecheck script. `gtm check` uses the TypeScript compiler API for its own rules and both dry runs imported the workflows successfully through tsx, so the edits at least load and parse.
