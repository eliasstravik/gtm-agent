# GTM Agent Diagram Action — Implementation Report

Branch: `feat/workflow-diagram-action` (from `c9a3d82`, not pushed)
Plan: `docs/superpowers/plans/2026-09-09-gtm-agent-diagram-action.md`
Scope: Tasks 1–4 in full, plus Task 5 Steps 1–3 (the instructions). Task 5 Steps 4–7 (the skills sync, `pnpm check`, and the real-thread verification) were deliberately **not** done; they wait on the gtm-skills 0.4.0 release.

| Task | Commit | Subject |
| --- | --- | --- |
| 1 | `14d6fdc` | feat(workflow): sign diagram links and derive where-to-look links |
| 2 | `a47a198` | feat(workflow): mint and probe signed diagram links from the host |
| 3 | `c29655e` | feat(workflow): read-only diagram action |
| 4 | `0fe3d4b` | feat(slack): upload the workflow diagram with the where-to-look block |
| 5 (Steps 1–3) | `3d9127e` | feat(agent): show workflow diagrams and where-to-look links in Slack |

Final state: 189 tests, 188 pass, 1 skipped (the pre-existing `github-workspace.integration` skip), `pnpm typecheck` clean, `pnpm skills:check` clean, `pnpm build` succeeds on Node 24. The working tree is clean apart from untracked plan files that were left alone.

---

## Task 1: Signing and link derivation

**Implemented:** `agent/lib/diagram-link.ts` exactly as the plan specifies: `signDiagram`, the private `diagramQuery`, `diagramLinks`, `vercelObservabilityUrl`, `tursoDashboardUrl`, `whereToLookText`. Test file `tests/diagram-link.test.mjs` verbatim from the plan.

**RED** — `node --test tests/diagram-link.test.mjs`

```
not ok 1 - tests/diagram-link.test.mjs
  failureType: 'testCodeFailure'
```

(module not found, the whole file fails to import)

**GREEN** — same command

```
# tests 4
# pass 4
# fail 0
```

The two golden signature vectors match: `blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM` (no run) and `zyr8hay07tYU4meH4oDXDf-8dKFK8mIeNq4EZUFlcBw` (run `0123456789abcdef0123456789abcdef`).

**Deviations:** none.

---

## Task 2: `WorkflowControl.getDiagram`

**Implemented:** in `agent/lib/workflow-control.ts`:

- imported `diagramLinks`, `tursoDashboardUrl`, `vercelObservabilityUrl`, `WhereToLook` from `./diagram-link.ts`;
- added the exported `WorkflowDiagram` union after `SanitizedWorkflowRun`, plus `DIAGRAM_LINK_TTL_MS` and `PROTECTED_MESSAGE`;
- added `getDiagram` after `approveRun`. It validates the workflow path and (when present) the run key, reads `workflows/package.json` from the checkout for the Vercel team and project, prefers the run's stored `run_url` when a run key is given, mints the signed links, and probes the image route through `this.#dependencies.fetch` directly — no bearer, no OIDC token, `redirect: "manual"`. A 200 with `image/png` is `ready`; 401/403/3xx/`text/html` is `protected`; 404 and anything else throw;
- extracted `readCheckoutFile(sandbox, workspace, relativePath)` as the single bounded checkout reader, and rewrote `readWorkflowInput` to call it (it keeps its own path validation and its own "not valid bounded JSON" error).

Three tests added to `tests/workflow-control.test.mjs`, verbatim from the plan.

**RED** — `node --test tests/workflow-control.test.mjs`

```
not ok 11 - getDiagram mints a signed link, probes the image without credentials, and derives links
  error: 'controlAtFixedNow.getDiagram is not a function'
not ok 12 - getDiagram reports a protected deployment instead of a dead link
not ok 13 - getDiagram uses the run's stored URL for the runs link and refuses a bad run key
# tests 13
# pass 10
# fail 3
```

**GREEN** — same command

```
# tests 13
# pass 13
# fail 0
```

`expiresAt` comes out as `2027-01-15T08:00:00.000Z` for the fixed clock, and the probe call carries neither `authorization` nor `x-vercel-trusted-oidc-idp-token`.

**Deviations:**

1. `readCheckoutFile` decodes with `result.stdout.replaceAll("\n", "")` rather than the plan's `.trim()`. The existing input reader used `replaceAll`, and since the two readers are now one function I kept the strictly more tolerant behaviour so the run path cannot regress. The plan's test still passes either way.
2. The shared reader's `runSandboxCommand` label is the plan's `"GTM workflow file read"`, replacing the old `"GTM workflow input read"`. Nothing asserts on that label; it only appears inside the generic sandbox-failure message.
3. `getDiagram` parses the package file with the file's existing `parseJson` helper instead of a bare `JSON.parse`. See the concern below about its message.

---

## Task 3: The `diagram` tool action

**Implemented:** in `agent/tools/operate_gtm_workflow.ts` added the strict `diagram` member to the discriminated union (`workflowPath` plus a nullable `runKey` with the plan's description), extended the tool description with the plan's sentence, and added the early `diagram` branch in `execute` before the sandbox is created for the run paths. `approvalActionFor` was not touched: its `default` already returns `null`, so `diagram` is ungated.

**RED** — `node --test tests/workflow-operation-approval.test.mjs`

```
not ok 2 - the diagram action is a read-only member of the tool schema
# tests 5
# pass 4
# fail 1
```

**GREEN** — `node --test tests/workflow-operation-approval.test.mjs && pnpm typecheck`

```
# tests 5
# pass 5
# fail 0
```

typecheck clean.

**Deviations:**

1. **The configuration property is `workflow`, not `workflowHosting`.** `getConfiguration()` returns `readonly workflow: WorkflowHostConfiguration | null` (`agent/lib/config.ts:152`), built by `parseWorkflowConfiguration` from `TURSO_DATABASE_URL` around `agent/lib/config.ts:429`, whose `databaseUrl` is `https://<db>-<org>.turso.io`. The branch therefore passes `configuration.workflow?.databaseUrl ?? null`, which is exactly the shape `tursoDashboardUrl` expects.
2. **The plan's two assertions could not fail.** `approve({ action: "diagram", ... })` and `approvalActionFor({ action: "diagram" })` already returned `"not-applicable"` and `null` before the schema changed, because Eve calls the approval callback with the raw tool input and never validates it against `inputSchema` first. I kept both assertions (they lock the read-only contract) and added a separate test, `"the diagram action is a read-only member of the tool schema"`, that parses the action through `operateTool.inputSchema` — with and without a run key, and rejecting a missing `runKey`. That is the assertion that actually went red.

---

## Task 4: Post the PNG and the block from the Slack channel

**Implemented:** `agent/lib/slack-diagram-post.ts` with `createDiagramResultHandler`, and the handler wired into `agent/channels/slack.ts` as `events["action.result"]`. The handler ignores anything that is not a `tool-result` from `operate_gtm_workflow` carrying a well-formed `diagram` output, posts the protected message alone when the deployment is protected, and otherwise fetches the image with no credentials and posts `{ text, files: [{ filename, data }] }`.

I confirmed against `node_modules/eve/dist/src/public/channels/slack/api.js` that `toSlackFileUpload` reads `{ data, filename }`, and that a post carrying `text` plus `files` and no blocks/card/markdown goes through `uploadFiles(files, { initialComment: text })` — so the three mrkdwn link lines ride along as the file's initial comment and render as links.

**RED** — `node --test tests/slack-diagram-post.test.mjs`

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../agent/lib/slack-diagram-post.ts'
# tests 1
# pass 0
# fail 1
```

**Intermediate** (implementation written, plan's test unchanged):

```
ok 1 - uploads the PNG with the where-to-look block for a ready diagram
ok 2 - posts the protected message without a file
not ok 3 - ignores other tools, other actions, failed downloads, and oversized images
  expected: 1
  actual: 2
```

**GREEN** — `node --test tests/slack-diagram-post.test.mjs tests/slack-channel.test.mjs && pnpm typecheck`

```
# tests 13
# pass 13
# fail 0
```

typecheck clean.

**Deviations:**

1. **The plan's third test contradicted the plan's own implementation.** It asserts `posts.length === 1`, but the two negative cases it exercises last — a 500 download and a 5 MB image — both fall through to `bytes === null` and both post the "could not be downloaded" fallback, so two posts land. Posting the fallback in both cases is the right behaviour: the alternative is a user who asked for a picture seeing nothing at all. I corrected the assertion to expect two posts and to check that each one carries the where-to-look block, the "could not be downloaded" sentence, and no file. The first two calls (a different tool, a different action) still post nothing, which is what the test's name is really about.
2. **`ActionResultData["result"]` is wider than the plan's shape.** With the plan's `{ kind: string; toolName: string; output: unknown }`, typecheck failed:

   ```
   agent/channels/slack.ts(60,7): error TS2322: Type '(data: ActionResultData, channel: ThreadPoster) => Promise<void>' is not assignable to type 'SlackEventHandler<"action.result">'.
     Property 'toolName' is missing in type '{ callId: string; ...; kind: "load-skill-result"; ... }'
   ```

   Eve's `RuntimeActionResult` is a union of `RuntimeLoadSkillActionResult | RuntimeSubagentResult | RuntimeToolResultActionResult` (`node_modules/eve/dist/src/shared/action-types.d.ts:208`) and only the tool-result member has `toolName`. Making `toolName` and `output` optional on the local type is the smallest fix; the runtime guard already rejects any result whose `kind` is not `tool-result`.
3. **`tests/slack-channel.test.mjs` needed no change.** It does not assert the exact `events` keys — its "custom events" assertion is about `onEvent`/`onInteraction` being undefined. The file is untouched and still passes.

---

## Task 5 Steps 1–3: Instructions (Steps 4–7 deferred)

**Implemented:** added the plan's two patterns, `/read-only diagram action/` and `/never paste the image link/i`, to the list in `tests/instructions.test.mjs` that the second test (`"standing instructions declare the sandbox workflow runtime and its limits"`) asserts, and added the plan's two bullets to `agent/instructions.md` verbatim, immediately after the `For \`Runs: on Vercel\`` bullet and before "Run no remote Git command in sandbox mode."

The same commit resolves concern 1 from the first round: `getDiagram` now parses the manifest through a new `parseWorkflowPackage` helper that throws "The workspace's workflows/package.json is not valid JSON." instead of reusing `parseJson`, whose wording is aimed at an HTTP response. A test in `tests/workflow-control.test.mjs` (`"getDiagram names the workspace file when its package manifest is not JSON"`) pins the message; it discriminates, because the old path produced "The workflow returned a non-JSON response."

**RED** — `node --test tests/instructions.test.mjs`

```
not ok 2 - standing instructions declare the sandbox workflow runtime and its limits
# tests 4
# pass 3
# fail 1
```

**GREEN** — same command

```
# tests 4
# pass 4
# fail 0
```

**Not done (by instruction):** Step 4 (`node scripts/sync-gtm-skills.mjs ../gtm-skills`), Step 5 (`pnpm check`), Step 7 (the real-thread verification). `skills-lock.json` and `agent/skills/**` are untouched, so the synced `gtm-workflow` references do not yet carry the "Where to look moments" section.

**Deviations:** none. The plan did not say which of the four pattern lists to extend; the workflow list is the one whose test covers the section the bullets landed in.

---

## Verification

```
pnpm typecheck            → clean
pnpm skills:check         → "Vendored GTM skills match skills-lock.json."
pnpm test (Node 24)       → tests 189, pass 188, fail 0, skipped 1
pnpm build (Node 24)      → "[BUILD] built output at /Users/eliasstravik/dev/gtm-agent/.output"
```

The build line was measured before the Task 5 commit, which changes only Markdown, a test file, and one error string.

`pnpm build` fails on this machine's default shell Node (v22.23.2) with `eve requires Node.js >=24`; that is environmental and unrelated to these changes. Re-running it with the fnm-installed v24.20.0 on `PATH` succeeds. `pnpm typecheck` and `node --test` were also re-run on Node 24 with identical results.

## Concerns

1. ~~**A malformed `workflows/package.json` produces a misleading error.**~~ **Resolved in `3d9127e`** by the `parseWorkflowPackage` helper described under Task 5.
2. **The runs link falls back to `https://vercel.com`** when `workflows/package.json` carries no `gtm.vercel.team`/`project`. That is the plan's behaviour and it keeps the block's three lines intact, but a user clicking it lands on the Vercel dashboard root rather than their project. Worth revisiting once the 0.4.0 scaffold guarantees those fields.
3. **The image is fetched twice per diagram** — once by `getDiagram` as a probe on the host, once by the Slack handler for the bytes. That is deliberate (the model must never see the bytes, and the probe must be credential-free like a viewer) but it doubles the load on the image route.
4. **Nothing exercises the wired handler end to end.** `tests/slack-diagram-post.test.mjs` tests the factory against a channel spy, and typecheck proves the handler satisfies `SlackEventHandler<"action.result">`, but no test drives Eve's real dispatch. Plan Task 5 Step 7 (verify once in a real thread) remains the check that the PNG actually lands in a Slack thread.
5. **The skills sync is outstanding by design.** `agent/instructions.md` now tells the model when to call the diagram action and that it must never paste the image link, but the vendored skills under `agent/skills/**` are still at the locked 0.3.2 commit. The instructions point at "the moments the workflow skill names" and at `npm run gtm -- diagram <slug> --format ascii`, and neither exists in the vendored skill yet, so the instruction bullets are ahead of the skill text until Task 5 Steps 4–5 run against gtm-skills 0.4.0 on `main`.

## Fix wave — final review

Applied against `3d9127e`, addressing the important findings and four minors of `docs/superpowers/plans/2026-09-09-agent-final-review.md`. M3, M6, M7, M8 and M9 were left as documented tradeoffs, and I6 is a merge gate, not a code change.

**I1 — the download is now bounded by a running byte count.** `agent/lib/slack-diagram-post.ts:66-104` adds `downloadImage`, which reads the body through `response.body.getReader()` and accumulates chunks. A declared `content-length` above `MAX_IMAGE_BYTES` is refused before the body is touched, and the reader is cancelled the moment the accumulated length passes the cap, so an absent or lying header can no longer make the handler materialise the whole body. The handler at `agent/lib/slack-diagram-post.ts:134` now calls it instead of `arrayBuffer()`.

**I2 — the download must be a PNG.** `agent/lib/slack-diagram-post.ts:80-83` requires `content-type` to start with `image/png` alongside `status === 200`; anything else cancels the body and falls through to the existing "could not be downloaded" post.

**I3 — `run_url` is validated before it becomes a Slack link.** `agent/lib/workflow-control.ts:653-661` adds `safeRunUrl`, which accepts the stored value only when it parses, uses `https:`, has hostname exactly `vercel.com`, and contains none of `<`, `>`, `|`. `getDiagram` calls it at `agent/lib/workflow-control.ts:311`; a rejected value leaves the derived Observability URL in place.

**I4 — no Slack post escapes the handler.** `agent/lib/slack-diagram-post.ts:106-113` adds `postSafely`, which wraps `thread.post` in try/catch and logs a fixed `console.warn` message. All three post sites use it (`:128`, `:139`, `:145`).

**I5 — an HTML 404 is a missing workflow, not protection.** The `probe.status === 404` branch moved above the protected branch in `getDiagram`, `agent/lib/workflow-control.ts:349-354`.

**M1 — `readCheckoutFile` validates its own path.** `agent/lib/workflow-control.ts:481-487` asserts `CHECKOUT_PATH_PATTERN` (`agent/lib/workflow-control.ts:30`, `^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$`) and rejects any `..` segment before the path reaches the shell string.

**M2 — `diagramLinks` encodes the path.** `agent/lib/diagram-link.ts:20-35` adds a file-local `encodeWorkflowPath` matching the run routes and applies it to both the page and image URLs. The signature still covers the raw `claims.path`, so both golden vectors reproduce unchanged.

**M4 — the probe body is cancelled.** `agent/lib/workflow-control.ts:339` cancels `probe.body` after the status and content type are captured, guarded so a cancel failure cannot mask the classification.

**M5 — the credential assertions are meaningful.** `tests/slack-diagram-post.test.mjs:35` and `tests/workflow-control.test.mjs:421` now assert `init.headers` is `undefined` rather than reading `.authorization` off it, so a regression that passed a `Headers` object would go red.

### Tests added

- `tests/slack-diagram-post.test.mjs` — a 5 MB chunked body with no `content-length` produces the fallback post; the stream's `cancel` callback fires and only 66 of 80 chunks (4.125 MB) are pulled, against 80 and no cancel before the fix. A `text/html` 200 produces the fallback post. A `thread.post` that rejects on both the ready and the protected path is logged twice and never thrown.
- `tests/workflow-control.test.mjs` — four hostile `run_url` values, including the review's `https://evil.example.com/x|Click here to sign in>`, each leave `links.runs` at the derived Observability URL. A `404` served as `text/html; charset=utf-8` rejects with "does not know this workflow or run".

### Verification

```
tsc --noEmit (Node 24.20.0)        → clean
node --test tests/*.test.mjs       → tests 194, pass 193, fail 0, skipped 1
```

Five tests added, none removed. The previously skipped test is unchanged.
