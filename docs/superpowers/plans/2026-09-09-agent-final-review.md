# Final Review — `feat/workflow-diagram-action`

Branch: `feat/workflow-diagram-action` (base `c9a3d82`, head `3d9127e`, 5 commits)
Reviewed against spec sections C, D, E of `../gtm-skills/docs/superpowers/specs/2026-09-09-workflow-visualization-and-output-design.md`, the plan, and the implementer report.

## Verdict

**needs fixes** — 0 critical, 6 important, 9 minor.

The trust boundary holds. The sandbox never sees the run secret, `getDiagram` is the only minting site, both the probe and the Slack download pass no `headers` object at all, and the tool output carries links only, never bytes. Signature parity with the workflows project is exact and the golden vectors reproduce. The defects are in the download bound, the classification of a 404, and one unvalidated URL that reaches a user-facing Slack link.

## Critical

None.

## Important

**I1. The Slack image download is not bounded when the response omits `content-length`.**
`agent/lib/slack-diagram-post.ts:86-89`. `Number(response.headers.get("content-length") ?? 0)` is `0` for a missing header, so the guard passes and `await response.arrayBuffer()` materialises the whole body before `byteLength` rejects it. Measured: an 8 MB chunked body was pulled in full before the 4 MB cap fired. The plan's own test only covers the case where `content-length` is declared, so the real path is untested. A slow or large body also burns the 15 s budget with no partial-read ceiling.
Fix: read the body through its reader and abort once the accumulated length passes `MAX_IMAGE_BYTES`, or treat an absent `content-length` as a refusal rather than as zero.

**I2. The download is not checked for `image/png` before it is uploaded as a `.png`.**
`agent/lib/slack-diagram-post.ts:87-101`. Only `status === 200` is checked. Measured: a `text/html` body posted into the thread as `account-scoring.png`. The host probe checked the content type, but the Slack fetch is a second, independent request, so an interstitial or an error page served on retry is uploaded as the picture.
Fix: require `response.headers.get("content-type")?.startsWith("image/png")` alongside the status check, and fall through to the existing "could not be downloaded" post otherwise.

**I3. `run_url` from the production response reaches a Slack link with no validation.**
`agent/lib/workflow-control.ts:309-311`, rendered by `whereToLookText` in `agent/lib/diagram-link.ts:52-58`. `directString(run, "run_url")` is used verbatim. Measured: a run record carrying `https://evil.example.com/x|Click here to sign in>` produced `links.runs` with that exact value, which in Slack mrkdwn both retargets the link to an arbitrary host and injects attacker text as the visible label. Every other component of the block is either host-minted or `encodeURIComponent`-escaped; this one is not. The value originates in the workspace's own workflows deployment, so the blast radius is a compromised or hostile workspace repo, but the block is presented by the agent as an official "Where to look" link.
Fix: accept the stored URL only when it parses, uses `https:`, has hostname `vercel.com`, and contains none of `<`, `>`, `|`; otherwise keep the derived Observability URL.

**I4. A failed Slack post escapes the `action.result` handler.**
`agent/lib/slack-diagram-post.ts:75, 95, 101`. The `try` covers only the fetch. Measured: a `thread.post` that rejects propagates out of the handler into Eve's event dispatch. A Slack upload failure (file size, channel permission, rate limit) is ordinary, and it should not surface as an unhandled rejection in the turn.
Fix: wrap the posts, swallow and log the failure. The model's own reply still carries the caption.

**I5. An HTML 404 is reported as deployment protection.**
`agent/lib/workflow-control.ts:345-355`. The `type.includes("text/html")` clause is evaluated before the `404` clause, so any 404 served as an HTML page — Vercel's own 404 for an unmatched route is one — returns `protected`. Measured: `404` with `text/html; charset=utf-8` returned `status: "protected"`. The user is then told to change Vercel Authentication settings for a workflow that simply is not deployed. This exact case is the likely one until 0.4.0 ships (see I6).
Fix: move the `probe.status === 404` branch above the protected branch.

**I6. The instructions and the action are ahead of the vendored skill and of any deployed scaffold.**
`agent/instructions.md:38-39`, `skills-lock.json` (locked at `b686702`, gtm-skills 0.3.2). The vendored `gtm-workflow` skill has no "Where to look moments" section, and the vendored scaffold under `agent/skills/gtm-workflow/templates/server/api/` has `approve`, `run`, `runs`, and `deployment.get.ts` only — no `diagram-image` route and no `/gtm/diagram` page. `gtm diagram` exists in the vendored CLI and supports `--format ascii`, so that half of the instruction works. Until 0.4.0 is synced and deployed, every hosted diagram call hits a nonexistent route and either throws or, per I5, misreports protection. The implementer flagged this and left plan Task 5 Steps 4–7 undone deliberately.
Fix: none in this branch. Gate the merge, or the deploy, on the gtm-skills 0.4.0 sync so the instruction never runs against a scaffold that cannot serve it.

## Minor

**M1.** `agent/lib/workflow-control.ts:469-487` — `readCheckoutFile` interpolates `relativePath` into a double-quoted shell string and performs no validation of its own, though its comment calls it "the one bounded reader". Both callers are safe today (`getDiagram` passes a literal, `readWorkflowInput` calls `validateInputPath` first). Add a path assertion inside the function so a third caller cannot introduce traversal or shell metacharacters. The symlink refusal, the `isFile` check, and the `MAX_INPUT_BYTES` cap are correct as written, and a rejected read yields the generic sandbox failure message with no file content echoed.

**M2.** `agent/lib/diagram-link.ts:40-43` — `diagramLinks` interpolates `claims.path` into the URL without the file-local `encodeWorkflowPath` helper that the run routes use. Safe only because `WORKFLOW_PATH_PATTERN` restricts the path to lowercase alphanumerics, hyphens, and slashes. Use the same helper for symmetry.

**M3.** `agent/lib/diagram-link.ts:36` — the Turso host regex assumes an org slug with no hyphen. A real org slug such as `acme-corp` mis-splits `gtm-acme-acme-corp` into db `gtm-acme-acme` and org `corp`, producing a plausible but wrong dashboard link rather than falling back to `https://app.turso.tech`. Anchoring on the last hyphen is no better; prefer carrying the org through configuration when 0.4.0 records it.

**M4.** `agent/lib/workflow-control.ts:330-334` — the probe response body is never read or cancelled. The socket stays occupied until GC. Add `await probe.body?.cancel()` after the classification.

**M5.** `tests/workflow-control.test.mjs` and `tests/slack-diagram-post.test.mjs` — the credential assertions read `init.headers.authorization`, which is `undefined` for any `Headers` instance whether or not it carries the header. The assertions pass today for the right reason (no `headers` key is passed at all), but they would not catch a regression that switched to a `Headers` object. Assert that `init.headers` is `undefined`.

**M6.** Spec D asks for one Slack message carrying the caption, the links, and the PNG. The implementation posts two: the channel's picture-plus-links message fires at `action.result`, before the model writes its caption, so the picture arrives first and the caption second. The spec anticipated the split ("the implementation plan verifies which path Eve supports"), so this is a documented deviation rather than a defect, but the reading order is the reverse of what the spec describes.

**M7.** `agent/lib/workflow-control.ts:304-306` — the runs link falls back to `https://vercel.com` when the manifest carries no `gtm.vercel` values, dropping the user on the dashboard root. The implementer raised this; it is the plan's behaviour.

**M8.** The image is fetched twice per diagram, once as the host probe and once by the Slack handler. Deliberate, and the right call given the model must not see bytes, but it doubles load on the image route and the two fetches can disagree (see I2).

**M9.** The signed page link, the signed image link, and the run key all appear in the tool output and therefore in the model's context. The only control against the model pasting them is the instruction sentence. That matches the spec's design for section D; noted so the tradeoff is explicit.

Nothing in the added tests asserts nothing. Every new test drives real behaviour: the golden signature vectors, the derived links, the probe classification at each branch, the fixed-clock expiry, the run-key rejection, the manifest error message, the schema parse for the `diagram` member, and the three handler paths. The two approval assertions the plan asked for are known-vacuous (Eve calls the approval callback with raw tool input), and the implementer both said so and added `"the diagram action is a read-only member of the tool schema"`, which parses through `operateTool.inputSchema` and is the assertion that actually goes red.

## Checks I ran

Read-only throughout; no git command, no mutation of the gtm-agent tree beyond writing this report.

- Reproduced both golden signature vectors and the `2027-01-15T08:00:00.000Z` expiry independently with `node:crypto`, outside the implementation.
- `node --test tests/*.test.mjs` on Node 24.20.0: 189 tests, 188 pass, 0 fail, 1 skipped. Matches the implementer report.
- `node node_modules/typescript/bin/tsc --noEmit` on Node 24.20.0: clean.
- Four ad-hoc probes against `createDiagramResultHandler` and `WorkflowControl.getDiagram` in the scratchpad, which produced the measurements behind I1, I2, I4, I5, and I3, plus a fixed-clock check that `exp` is exactly 24 hours out.
- Traced every `operate_gtm_workflow` return shape to confirm the handler's guard cannot be reached by sandbox- or model-controlled data: only host-built literals reach the top level, none carries `action: "diagram"`, so `output.imageUrl` is always the host-minted URL and the handler has no SSRF surface.
- Read `agent/lib/config.ts` to confirm `configuration.workflow.databaseUrl` is `https://<turso host>` and is the shape `tursoDashboardUrl` expects.
- Inspected `agent/channels/slack.ts`: the `input.requested` handler is unchanged and the new `action.result` key is additive.
- Inspected the vendored skill and scaffold to establish the state behind I6.
