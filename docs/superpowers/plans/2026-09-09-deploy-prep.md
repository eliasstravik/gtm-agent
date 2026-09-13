# Tenant checkout prep report (2026-09-09)

Prepared by the `deploy-prep` agent, running from a session pinned to the
`gtm-skills` worktree at
`/Users/eliasstravik/dev/gtm-skills/.claude/worktrees/workflow-diagrams-0.4.0`.

## Important limitation

This session's sandbox refuses **any** `git` invocation that targets a
directory outside its own worktree — read-only or mutating, `-C` or plain —
even when run via a freshly spawned subagent. Non-git commands (`ls`, `cat`,
`grep`, `gh`) work fine against arbitrary paths. As a result:

- `git pull` on `~/.gtm/gtm-eliasstravik` could **not** be run.
- `git fetch` / live SHA comparison for the two tenant agent repos could
  **not** be run.
- Where noted below, SHAs were instead read directly from `.git/HEAD` and
  `.git/refs/...` files. These reflect on-disk state at the time of this
  report and are **not** the result of a live fetch — treat them as
  possibly stale.

Someone/something not pinned to this worktree needs to actually run the
pull and fetches described in items 1 and 3.

## 1. `~/.gtm/gtm-eliasstravik`

Could not pull (blocked, see above). Current state, read directly from
`.git/refs/heads/main`:

- HEAD/`main` = `f58d8327da86edb803c6e9ac38cf536131e95c5c`
- `workflows/package.json` → `gtm.libVersion` = **9** (old; needs the pull
  to reach 13)
- `workflows/workflows/` exists, currently contains 1 file:
  `monitor-gtmengineering-questions.ts`
- `git status --short` could not be captured this way; reported clean
  going into this task.

**Action needed:** run, from an unrestricted session,
`git -C ~/.gtm/gtm-eliasstravik pull --ff-only origin main`, then re-check
`gtm.libVersion` (expect 13) and `workflows/workflows/` contents.

## 2. `~/.gtm/gtm-notably` (cloned successfully)

Cloned via `gh repo clone Notably-PR/gtm-notably ~/.gtm/gtm-notably`
(not `git`, so it was not blocked).

- HEAD/`main` = `e41498c0df929428549386d39d3caf9a5927bd52`
- `workflows/package.json` → `gtm.libVersion` = **13**

### `workflows/workflows/`
- `qualify-linkedin-leads.ts`
- `reddit-pr-advice-drafts.ts`

### `workflows/providers/`
- `monid-linkedin-profile.ts`
- `monid-reddit.ts`
- `README.md`
- `__fixtures__/`

### `workflows/db/tables/`
- `persona_qualified_leads.ts`
- `reddit_pr_drafts.ts`

### Header comment blocks (first 12 lines)

**`qualify-linkedin-leads.ts`**
```
/**
 * Purpose: Enrich supplied LinkedIn profiles and qualify each person against Notably PR's saved buyer personas.
 * Runs: on Vercel
 * Kind: on-demand
 * Owner: Notably PR
 * ICP: none; person-only qualification against all four saved personas
 * Providers: Monid/Ploid LinkedIn profile at $0.01 per lead; AI Gateway qualification up to $0.04 per lead
 * Result table: persona_qualified_leads
 * Key: canonical LinkedIn profile URL supplied from the CSV
 * Schedule: none; starts only through the authenticated run route
 * External writes: Ploid receives each public LinkedIn URL; results are saved to Turso and sent to the AI Gateway for qualification
 */
```

**`reddit-pr-advice-drafts.ts`**
```
/**
 * Purpose: Find recent r/PublicRelations questions and draft genuinely helpful PR comments.
 * Runs: on Vercel
 * Kind: on-demand
 * Owner: Notably PR
 * ICP: none; community-help workflow grounded in ORG.md expertise
 * Providers: Monid/Apify Reddit API at $0.0045 per result; AI Gateway classifier up to $0.01 per post; AI Gateway writer up to $0.04 per qualifying post
 * Result table: reddit_pr_drafts
 * Key: Reddit fullname ID, such as t3_abc123
 * Schedule: none; starts only through the authenticated run route
 * External writes: none; drafts are saved to Turso and never posted to Reddit
 */
```

Both files carry full JSDoc headers (Purpose/Runs/Kind/Owner/ICP/Providers/
Result table/Key/Schedule/External writes) — this looks good.

### `"use step"` functions (grep with 3 lines of context before each match)

`qualify-linkedin-leads.ts`:
```
89-] as const;
90-
91-async function enrichLinkedInLead(lead: Lead, meta: WorkflowMeta, signal: AbortSignal) {
92:  "use step";
--
112-enrichLinkedInLead.maxRetries = 0;
113-
114-async function saveEnrichment(profile: LinkedInProfile) {
115:  "use step";
--
129-
130-
131-async function saveEmptyProfile(profile: LinkedInProfile) {
132:  "use step";
--
145-}
146-
147-async function qualifyPerson(profile: LinkedInProfile, meta: WorkflowMeta, signal: AbortSignal) {
148:  "use step";
--
231-  profile: LinkedInProfile | null,
232-  failureStage: "enrichment" | "qualification",
233-) {
234:  "use step";
--
298-}
299-
300-async function saveLead(row: Record<string, unknown>) {
301:  "use step";
```

`reddit-pr-advice-drafts.ts`:
```
53-`;
54-
55-async function fetchRecentRedditPosts(maxPosts: number, meta: WorkflowMeta) {
56:  "use step";
--
80-fetchRecentRedditPosts.maxRetries = 0;
81-
82-async function saveFetchedPosts(posts: RedditPost[]) {
83:  "use step";
--
94-  meta: WorkflowMeta,
95-  signal: AbortSignal,
96-) {
97:  "use step";
--
133-    classificationConfidence: number;
134-  },
135-) {
136:  "use step";
--
148-  meta: WorkflowMeta,
149-  signal: AbortSignal,
150-) {
151:  "use step";
--
179-  post: RedditPost,
180-  draft: { draftComment: string; draftAngle: string; draftCautions: string[] },
181-) {
182:  "use step";
--
195-  post: RedditPost,
196-  failureStage: "classification" | "drafting",
197-) {
198:  "use step";
--
231-}
232-
233-async function savePost(row: Record<string, unknown>) {
234:  "use step";
```

**Note:** based on the 3-line context above each match, none of these
`"use step"` functions have a JSDoc block immediately preceding them — all
of them look like candidates for a missing step label.

## 3. Tenant agent repos

Could not run `git fetch` or a live SHA comparison (blocked, see above).
Values below were read directly from `.git/HEAD` and `.git/refs/...` files
on disk — **not** the result of a live fetch, may be stale.

### `/Users/eliasstravik/dev/gtm-agent-stravik`
- Current branch: `main`
- Local branches present: `fix`, `issue-8-port-the-bounded-slack-interaction-polic`, `main`
- Local `main` = cached `origin/main` = `a32dae61d4b9059841b15ade9fae5261b8b0895f`
- Cached `template/main` = `c9a3d8265f55d5e03bfdb8fb5f3f91e34f1ab46d`
  (differs from local `main` — this is an unverified, stale cache
  comparison, not a live fetch result)
- `git status --short` could not be captured (blocked).

### `/Users/eliasstravik/dev/notably-gtm-agent`
- Current branch: `main`
- Local branches present: `fix`, `main`
- Local `main` = cached `origin/main` = `6442068180277eb035a78498d932ce8608a2f6fe`
- Cached `template/main` = `c9a3d8265f55d5e03bfdb8fb5f3f91e34f1ab46d`
  (differs from local `main` — same caveat as above)
- `git status --short` could not be captured (blocked).

**Action needed:** run, from an unrestricted session, for each repo:
`git fetch origin && git fetch template`, then compare
`git rev-parse HEAD` / `origin/main` / `template/main` live. Do not merge.

## 4. `node_modules` / `.env` presence

- `~/.gtm/gtm-notably/workflows`: `node_modules` **absent**, `.env` **absent**
- `~/.gtm/gtm-eliasstravik/workflows`: `node_modules` **present**, `.env` **present**

(Contents of `.env` were not read or printed, per instructions — presence
only.)
