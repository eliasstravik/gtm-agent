# GTM Agent Diagram Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Slack agent show a workflow as a picture plus a "Where to look" block: a read-only `diagram` action mints the signed production link on the host, the Slack channel uploads the PNG into the thread, and the model's reply carries the three links.

**Architecture:** The host already holds the production origin and run secret. A new library file signs diagram links exactly like the workflows project does (shared golden vector), derives the Vercel Observability and Turso dashboard links, and formats the block. `WorkflowControl.getDiagram` mints the link and probes the image route without credentials, the same way a Slack viewer's browser will, so a protected deployment is reported instead of posting a dead link. An `action.result` handler on the Slack channel fetches the PNG and posts it with the block; the model never sees image bytes.

**Tech Stack:** Node 24, Eve 0.49.1 (`events["action.result"]`, `thread.post({ text, files })` with `{ filename, data }`), node:test.

**Spec:** `../gtm-skills/docs/superpowers/specs/2026-09-09-workflow-visualization-and-output-design.md`, sections C, D, E. Depends on gtm-skills 0.4.0 (lib generation 14) being deployed to the workspace's workflows project; the routes it calls exist only there.

## Global Constraints

- The sandbox never mints links and never sees `GTM_WORKFLOW_RUN_SECRET`. Only `WorkflowControl` signs.
- The image probe and the Slack fetch send no authorization header and no OIDC token; they must behave like a viewer's browser.
- Signing must match the workflows project: `base64url(HMAC-SHA256(secret, "diagram|<path>|<run or ->|<exp>"))` with `exp` in unix seconds. Golden vector: secret `run-secret`, path `account-scoring`, no run, exp `1800000000` signs to `blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM`; with run `0123456789abcdef0123456789abcdef` it signs to `zyr8hay07tYU4meH4oDXDf-8dKFK8mIeNq4EZUFlcBw`.
- Links expire 24 hours after minting.
- The Slack block is exactly three lines: `Diagram:`, `Runs (needs Vercel access):`, `Data:`. No other host name or path appears in user-facing text.
- Run `pnpm check` (skills check, typecheck, tests, build) before finishing every task.

## File structure

- `agent/lib/diagram-link.ts` (new): signing, link derivation, block text.
- `agent/lib/workflow-control.ts` (modified): `getDiagram`.
- `agent/tools/operate_gtm_workflow.ts` (modified): `diagram` action.
- `agent/lib/slack-diagram-post.ts` (new): `action.result` handler factory.
- `agent/channels/slack.ts` (modified): wire the handler.
- `agent/instructions.md` (modified): when to call the action and how to reply.
- Tests: `tests/diagram-link.test.mjs` (new), `tests/slack-diagram-post.test.mjs` (new), `tests/workflow-control.test.mjs`, `tests/workflow-operation-approval.test.mjs`, `tests/instructions.test.mjs` (modified).

---

### Task 1: Signing and link derivation

**Files:**
- Create: `agent/lib/diagram-link.ts`
- Test: `tests/diagram-link.test.mjs`

**Interfaces:**

```ts
export type DiagramClaims = { path: string; run: string | null; exp: number };
export function signDiagram(claims: DiagramClaims, secret: string): string;
export function diagramLinks(input: { productionUrl: string; claims: DiagramClaims; secret: string }): { url: string; imageUrl: string };
export function vercelObservabilityUrl(team: string, project: string): string; // https://vercel.com/<team>/<project>/observability/workflows
export function tursoDashboardUrl(databaseUrl: string | null): string; // https://app.turso.tech/<org>/databases/<db> from <db>-<org>.turso.io, else https://app.turso.tech
export type WhereToLook = { diagram: string; runs: string; data: string };
export function whereToLookText(links: WhereToLook): string; // three Slack mrkdwn lines
```

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";

import {
  diagramLinks,
  signDiagram,
  tursoDashboardUrl,
  vercelObservabilityUrl,
  whereToLookText,
} from "../agent/lib/diagram-link.ts";

test("signs diagram claims like the workflows project", () => {
  assert.equal(signDiagram({ path: "account-scoring", run: null, exp: 1800000000 }, "run-secret"), "blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(
    signDiagram({ path: "account-scoring", run: "0123456789abcdef0123456789abcdef", exp: 1800000000 }, "run-secret"),
    "zyr8hay07tYU4meH4oDXDf-8dKFK8mIeNq4EZUFlcBw",
  );
});

test("builds the page and image links with the same query", () => {
  const links = diagramLinks({
    productionUrl: "https://acme-workflows.vercel.app",
    claims: { path: "nested/account-scoring", run: null, exp: 1800000000 },
    secret: "run-secret",
  });
  assert.equal(links.url, `https://acme-workflows.vercel.app/gtm/diagram/nested/account-scoring?exp=1800000000&sig=${signDiagram({ path: "nested/account-scoring", run: null, exp: 1800000000 }, "run-secret")}`);
  assert.equal(new URL(links.imageUrl).pathname, "/api/diagram-image/nested/account-scoring");
  assert.equal(new URL(links.imageUrl).search, new URL(links.url).search);
  const withRun = diagramLinks({ productionUrl: "https://acme-workflows.vercel.app", claims: { path: "a", run: "0123456789abcdef0123456789abcdef", exp: 1 }, secret: "s" });
  assert.equal(new URL(withRun.url).searchParams.get("run"), "0123456789abcdef0123456789abcdef");
});

test("derives the runs and data links", () => {
  assert.equal(vercelObservabilityUrl("stravik", "gtm-acme-workflows"), "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows");
  assert.equal(tursoDashboardUrl("libsql://gtm-acme-stravik.turso.io"), "https://app.turso.tech/stravik/databases/gtm-acme");
  assert.equal(tursoDashboardUrl("https://gtm-acme-stravik.aws-eu-west-1.turso.io"), "https://app.turso.tech/stravik/databases/gtm-acme");
  assert.equal(tursoDashboardUrl("libsql://weird.example.com"), "https://app.turso.tech");
  assert.equal(tursoDashboardUrl(null), "https://app.turso.tech");
});

test("formats the where-to-look block", () => {
  assert.equal(
    whereToLookText({ diagram: "https://d/1", runs: "https://r/2", data: "https://t/3" }),
    "Diagram: <https://d/1|Open the diagram>\nRuns (needs Vercel access): <https://r/2|Open the runs>\nData: <https://t/3|Open the data>",
  );
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/diagram-link.test.mjs
```

Expected: FAIL, module not found.

- [ ] **Step 3: Write `agent/lib/diagram-link.ts`**

```ts
import { createHmac } from "node:crypto";

export type DiagramClaims = { readonly path: string; readonly run: string | null; readonly exp: number };
export type WhereToLook = { readonly diagram: string; readonly runs: string; readonly data: string };

export function signDiagram(claims: DiagramClaims, secret: string): string {
  return createHmac("sha256", secret)
    .update(`diagram|${claims.path}|${claims.run ?? "-"}|${claims.exp}`)
    .digest("base64url");
}

function diagramQuery(claims: DiagramClaims, secret: string): string {
  const query = new URLSearchParams();
  if (claims.run) query.set("run", claims.run);
  query.set("exp", String(claims.exp));
  query.set("sig", signDiagram(claims, secret));
  return query.toString();
}

export function diagramLinks(input: {
  readonly productionUrl: string;
  readonly claims: DiagramClaims;
  readonly secret: string;
}): { url: string; imageUrl: string } {
  const query = diagramQuery(input.claims, input.secret);
  return {
    url: `${input.productionUrl}/gtm/diagram/${input.claims.path}?${query}`,
    imageUrl: `${input.productionUrl}/api/diagram-image/${input.claims.path}?${query}`,
  };
}

export function vercelObservabilityUrl(team: string, project: string): string {
  return `https://vercel.com/${encodeURIComponent(team)}/${encodeURIComponent(project)}/observability/workflows`;
}

/** Turso hosts look like `<db>-<org>.turso.io` or `<db>-<org>.<region>.turso.io`; the org has no hyphen. */
export function tursoDashboardUrl(databaseUrl: string | null): string {
  if (databaseUrl === null) return "https://app.turso.tech";
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return "https://app.turso.tech";
  }
  const match = host.match(/^([a-z0-9-]+)-([a-z0-9]+)(?:\.[a-z0-9-]+)*\.turso\.io$/);
  if (!match) return "https://app.turso.tech";
  return `https://app.turso.tech/${match[2]}/databases/${match[1]}`;
}

export function whereToLookText(links: WhereToLook): string {
  return [
    `Diagram: <${links.diagram}|Open the diagram>`,
    `Runs (needs Vercel access): <${links.runs}|Open the runs>`,
    `Data: <${links.data}|Open the data>`,
  ].join("\n");
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
node --test tests/diagram-link.test.mjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/lib/diagram-link.ts tests/diagram-link.test.mjs
git commit -m "feat(workflow): sign diagram links and derive where-to-look links"
```

---

### Task 2: `WorkflowControl.getDiagram`

**Files:**
- Modify: `agent/lib/workflow-control.ts`
- Test: `tests/workflow-control.test.mjs`

**Interfaces:**

```ts
export type WorkflowDiagram =
  | { readonly action: "diagram"; readonly status: "ready"; readonly workflowPath: string; readonly runKey: string | null; readonly url: string; readonly imageUrl: string; readonly expiresAt: string; readonly links: WhereToLook }
  | { readonly action: "diagram"; readonly status: "protected"; readonly workflowPath: string; readonly runKey: string | null; readonly message: string; readonly links: WhereToLook };

async getDiagram(input: { readonly workflowPath: string; readonly runKey: string | null; readonly databaseUrl: string | null; readonly sandbox: Sandbox }): Promise<WorkflowDiagram>;
```

- [ ] **Step 1: Write the failing tests**

Add to `tests/workflow-control.test.mjs`. The existing `configuration`, `workspace`, `sandboxWith`, `ok`, and `dependencies` helpers are reused. The package read returns the checkout's `workflows/package.json` as base64, matching the existing input-read command pattern (`readFileSync(path).toString`).

```js
const PACKAGE_JSON = JSON.stringify({ gtm: { vercel: { team: "stravik", project: "gtm-acme-workflows" } } });

function diagramSandbox() {
  return sandboxWith((command) => {
    if (command.includes("readFileSync(path).toString")) return ok(`${Buffer.from(PACKAGE_JSON).toString("base64")}\n`);
    return ok();
  });
}

function pngResponse(status = 200, type = "image/png") {
  return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status, headers: { "content-type": type } });
}

test("getDiagram mints a signed link, probes the image without credentials, and derives links", async () => {
  const calls = [];
  const fixedNow = 1800000000 * 1000 - 24 * 60 * 60 * 1000;
  const controlAtFixedNow = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    {
      ...dependencies(async (url, init) => {
        calls.push({ url: String(url), headers: init?.headers ?? {} });
        return pngResponse();
      }),
      now: () => fixedNow,
    },
  );
  const result = await controlAtFixedNow.getDiagram({
    workflowPath: "account-scoring",
    runKey: null,
    databaseUrl: "libsql://gtm-acme-stravik.turso.io",
    sandbox: diagramSandbox().sandbox,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://acme-workflows.vercel.app/gtm/diagram/account-scoring?exp=1800000000&sig=blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(result.imageUrl, "https://acme-workflows.vercel.app/api/diagram-image/account-scoring?exp=1800000000&sig=blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(result.expiresAt, "2027-01-15T08:00:00.000Z");
  assert.deepEqual(result.links, {
    diagram: result.url,
    runs: "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows",
    data: "https://app.turso.tech/stravik/databases/gtm-acme",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, result.imageUrl);
  assert.equal(calls[0].headers.authorization, undefined);
  assert.equal(calls[0].headers["x-vercel-trusted-oidc-idp-token"], undefined);
});

test("getDiagram reports a protected deployment instead of a dead link", async () => {
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async () => new Response("<html>Vercel Authentication</html>", { status: 401, headers: { "content-type": "text/html" } })),
  );
  const result = await control.getDiagram({ workflowPath: "account-scoring", runKey: null, databaseUrl: null, sandbox: diagramSandbox().sandbox });
  assert.equal(result.status, "protected");
  assert.match(result.message, /deployment protection/i);
  assert.equal(result.links.data, "https://app.turso.tech");
});

test("getDiagram uses the run's stored URL for the runs link and refuses a bad run key", async () => {
  const runKey = "0123456789abcdef0123456789abcdef";
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async (url) => {
      if (String(url).endsWith(`/api/runs/${runKey}`)) {
        return Response.json({ run_key: runKey, workflow: "account-scoring", status: "running", run_url: "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows/wrun_1" });
      }
      return pngResponse();
    }),
  );
  const result = await control.getDiagram({ workflowPath: "account-scoring", runKey, databaseUrl: null, sandbox: diagramSandbox().sandbox });
  assert.equal(result.status, "ready");
  assert.equal(new URL(result.url).searchParams.get("run"), runKey);
  assert.equal(result.links.runs, "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows/wrun_1");
  await assert.rejects(
    control.getDiagram({ workflowPath: "account-scoring", runKey: "nope", databaseUrl: null, sandbox: diagramSandbox().sandbox }),
    /run key is invalid/,
  );
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
node --test tests/workflow-control.test.mjs
```

Expected: FAIL, `control.getDiagram is not a function`.

- [ ] **Step 3: Implement `getDiagram`**

In `agent/lib/workflow-control.ts` add imports:

```ts
import { diagramLinks, tursoDashboardUrl, vercelObservabilityUrl, type WhereToLook } from "./diagram-link.ts";
```

Add the type after `SanitizedWorkflowRun`:

```ts
export type WorkflowDiagram =
  | {
      readonly action: "diagram";
      readonly status: "ready";
      readonly workflowPath: string;
      readonly runKey: string | null;
      readonly url: string;
      readonly imageUrl: string;
      readonly expiresAt: string;
      readonly links: WhereToLook;
    }
  | {
      readonly action: "diagram";
      readonly status: "protected";
      readonly workflowPath: string;
      readonly runKey: string | null;
      readonly message: string;
      readonly links: WhereToLook;
    };

const DIAGRAM_LINK_TTL_MS = 24 * 60 * 60 * 1000;
const PROTECTED_MESSAGE =
  "The diagram link is blocked by the production project's deployment protection. In the Vercel project settings, set Vercel Authentication to preview deployments only, or attach a production custom domain, then ask again.";
```

Add the method to the class after `approveRun`:

```ts
  async getDiagram(input: {
    readonly workflowPath: string;
    readonly runKey: string | null;
    readonly databaseUrl: string | null;
    readonly sandbox: Sandbox;
  }): Promise<WorkflowDiagram> {
    if (!WORKFLOW_PATH_PATTERN.test(input.workflowPath)) throw new Error("The workflow path is invalid.");
    if (input.runKey !== null) validateRunKey(input.runKey);
    const packageJson = record(JSON.parse(await readCheckoutFile(input.sandbox, this.#workspace, "workflows/package.json")));
    const vercel = record(record(packageJson?.gtm)?.vercel);
    const team = directString(vercel, "team");
    const project = directString(vercel, "project");
    let runs = team && project ? vercelObservabilityUrl(team, project) : "https://vercel.com";
    if (input.runKey !== null) {
      const run = await this.#getRawRun(input.runKey);
      const runUrl = directString(run, "run_url");
      if (runUrl) runs = runUrl;
    }
    const exp = Math.floor((this.#dependencies.now() + DIAGRAM_LINK_TTL_MS) / 1000);
    const claims = { path: input.workflowPath, run: input.runKey, exp };
    const { url, imageUrl } = diagramLinks({ productionUrl: this.#configuration.productionUrl, claims, secret: this.#configuration.runSecret });
    const links: WhereToLook = { diagram: url, runs, data: tursoDashboardUrl(input.databaseUrl) };
    const base = { action: "diagram" as const, workflowPath: input.workflowPath, runKey: input.runKey, links };
    const probe = await this.#dependencies.fetch(imageUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(20_000) });
    const type = probe.headers.get("content-type") ?? "";
    if (probe.status === 200 && type.startsWith("image/png")) {
      return { ...base, status: "ready", url, imageUrl, expiresAt: new Date(exp * 1000).toISOString() };
    }
    if (probe.status === 401 || probe.status === 403 || (probe.status >= 300 && probe.status < 400) || type.includes("text/html")) {
      return { ...base, status: "protected", message: PROTECTED_MESSAGE };
    }
    if (probe.status === 404) throw new Error("The production project does not know this workflow or run.");
    throw new Error(`The diagram request failed with status ${probe.status}.`);
  }
```

Add `readCheckoutFile` next to the existing input-read code, reusing its script and `runSandboxCommand`:

```ts
async function readCheckoutFile(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
  relativePath: string,
): Promise<string> {
  const script = `
import { lstatSync, readFileSync } from "node:fs";
const path = process.argv[1];
const stat = lstatSync(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ${MAX_INPUT_BYTES}) throw new Error("invalid input");
process.stdout.write(readFileSync(path).toString("base64"));
`;
  const result = await runSandboxCommand(
    sandbox,
    `set -euo pipefail\nrepo_dir="${workspace.checkoutDirectory}"\nfile="$repo_dir/${relativePath}"\nnode --input-type=module -e ${shellQuote(script)} "$file"`,
    "GTM workflow file read",
  );
  return Buffer.from(result.stdout.trim(), "base64").toString("utf8");
}
```

If the existing input read is an inline block rather than a function, replace that block with a call to `readCheckoutFile(sandbox, workspace, inputPath)` so there is one reader.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/workflow-control.test.mjs
```

Expected: PASS. The `expiresAt` value is `1800000000` seconds as ISO time.

- [ ] **Step 5: Commit**

```bash
git add agent/lib/workflow-control.ts tests/workflow-control.test.mjs
git commit -m "feat(workflow): mint and probe signed diagram links from the host"
```

---

### Task 3: The `diagram` tool action

**Files:**
- Modify: `agent/tools/operate_gtm_workflow.ts`
- Test: `tests/workflow-operation-approval.test.mjs`

- [ ] **Step 1: Write the failing test**

Add to the `read-only actions need no approval` test:

```js
  assert.equal(await approve({ action: "diagram", workflowPath: "score-leads", runKey: null }), "not-applicable");
  assert.equal(approvalActionFor({ action: "diagram" }), null);
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/workflow-operation-approval.test.mjs
```

Expected: FAIL: the schema rejects the unknown action.

- [ ] **Step 3: Add the action**

In the `inputSchema` union add:

```ts
  z
    .object({
      action: z.literal("diagram"),
      workflowPath,
      runKey: runKey.nullable().describe("Run key to overlay status and spend, or null for the workflow shape."),
    })
    .strict(),
```

`approvalActionFor` already returns `null` for unknown actions; no change. In `execute`, before `const sandbox = await ctx.getSandbox();` add:

```ts
    if (input.action === "diagram") {
      return control.getDiagram({
        workflowPath: input.workflowPath,
        runKey: input.runKey,
        databaseUrl: configuration.workflowHosting?.databaseUrl ?? null,
        sandbox: await ctx.getSandbox(),
      });
    }
```

`workflowHosting` is the name of the configuration object that `getConfiguration()` builds from `TURSO_DATABASE_URL` (the object whose `databaseUrl` is `https://<db>-<org>.turso.io`, built around `agent/lib/config.ts:431`); use that object's actual property name if it differs.

Extend the tool `description` with: `Diagram is read-only: it returns a signed link to the workflow picture, the image link the channel uploads, and the where-to-look links; it reports protected when deployment protection blocks the link.`

- [ ] **Step 4: Run the tests to verify they pass**

```bash
node --test tests/workflow-operation-approval.test.mjs && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add agent/tools/operate_gtm_workflow.ts tests/workflow-operation-approval.test.mjs
git commit -m "feat(workflow): read-only diagram action"
```

---

### Task 4: Post the PNG and the block from the Slack channel

**Files:**
- Create: `agent/lib/slack-diagram-post.ts`
- Modify: `agent/channels/slack.ts`
- Test: `tests/slack-diagram-post.test.mjs`

**Interfaces:**

```ts
export function createDiagramResultHandler(options?: { fetch?: typeof fetch }): (data: { result: { kind: string; toolName: string; output: unknown } }, channel: { thread: { post(input: unknown): Promise<unknown> } }) => Promise<void>;
```

- [ ] **Step 1: Write the failing test**

```js
import assert from "node:assert/strict";
import test from "node:test";

import { createDiagramResultHandler } from "../agent/lib/slack-diagram-post.ts";

const PNG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
const READY = {
  action: "diagram",
  status: "ready",
  workflowPath: "nested/account-scoring",
  runKey: null,
  url: "https://acme-workflows.vercel.app/gtm/diagram/nested/account-scoring?exp=1&sig=s",
  imageUrl: "https://acme-workflows.vercel.app/api/diagram-image/nested/account-scoring?exp=1&sig=s",
  expiresAt: "2027-01-15T08:00:00.000Z",
  links: { diagram: "https://d/1", runs: "https://r/2", data: "https://t/3" },
};

function channelSpy() {
  const posts = [];
  return { posts, channel: { thread: { async post(input) { posts.push(input); return { id: "1", raw: {} }; } } } };
}

test("uploads the PNG with the where-to-look block for a ready diagram", async () => {
  const fetched = [];
  const handler = createDiagramResultHandler({
    fetch: async (url, init) => {
      fetched.push({ url: String(url), headers: init?.headers ?? {} });
      return new Response(PNG, { status: 200, headers: { "content-type": "image/png" } });
    },
  });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, READY.imageUrl);
  assert.equal(fetched[0].headers.authorization, undefined);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "Diagram: <https://d/1|Open the diagram>\nRuns (needs Vercel access): <https://r/2|Open the runs>\nData: <https://t/3|Open the data>");
  assert.equal(posts[0].files.length, 1);
  assert.equal(posts[0].files[0].filename, "account-scoring.png");
  assert.deepEqual([...posts[0].files[0].data], [...PNG]);
});

test("posts the protected message without a file", async () => {
  const handler = createDiagramResultHandler({ fetch: async () => { throw new Error("must not fetch"); } });
  const { posts, channel } = channelSpy();
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: { ...READY, status: "protected", message: "The diagram link is blocked by deployment protection." } } }, channel);
  assert.equal(posts.length, 1);
  assert.equal(posts[0].text, "The diagram link is blocked by deployment protection.");
  assert.equal(posts[0].files, undefined);
});

test("ignores other tools, other actions, failed downloads, and oversized images", async () => {
  const { posts, channel } = channelSpy();
  const handler = createDiagramResultHandler({ fetch: async () => new Response("nope", { status: 500 }) });
  await handler({ result: { kind: "tool-result", toolName: "apply_gtm_workspace_changes", output: READY } }, channel);
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: { action: "status", status: "running" } } }, channel);
  await handler({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  const big = createDiagramResultHandler({
    fetch: async () => new Response(new Uint8Array(5 * 1024 * 1024), { status: 200, headers: { "content-type": "image/png", "content-length": String(5 * 1024 * 1024) } }),
  });
  await big({ result: { kind: "tool-result", toolName: "operate_gtm_workflow", output: READY } }, channel);
  assert.equal(posts.length, 1);
  assert.match(posts[0].text, /could not be downloaded/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/slack-diagram-post.test.mjs
```

Expected: FAIL, module not found.

- [ ] **Step 3: Write `agent/lib/slack-diagram-post.ts`**

```ts
import { whereToLookText, type WhereToLook } from "./diagram-link.ts";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

type ActionResultData = { readonly result: { readonly kind: string; readonly toolName: string; readonly output: unknown } };
type ThreadPoster = { readonly thread: { post(input: unknown): Promise<unknown> } };

type DiagramOutput =
  | { readonly action: "diagram"; readonly status: "ready"; readonly workflowPath: string; readonly imageUrl: string; readonly links: WhereToLook }
  | { readonly action: "diagram"; readonly status: "protected"; readonly message: string; readonly links: WhereToLook };

function diagramOutput(value: unknown): DiagramOutput | null {
  if (typeof value !== "object" || value === null) return null;
  const output = value as Record<string, unknown>;
  if (output.action !== "diagram") return null;
  const links = output.links as Record<string, unknown> | undefined;
  if (!links || typeof links.diagram !== "string" || typeof links.runs !== "string" || typeof links.data !== "string") return null;
  if (output.status === "ready" && typeof output.imageUrl === "string" && typeof output.workflowPath === "string") {
    return output as unknown as DiagramOutput;
  }
  if (output.status === "protected" && typeof output.message === "string") return output as unknown as DiagramOutput;
  return null;
}

export function createDiagramResultHandler(options: { readonly fetch?: typeof fetch } = {}) {
  const fetchImage = options.fetch ?? globalThis.fetch;
  return async (data: ActionResultData, channel: ThreadPoster): Promise<void> => {
    if (data.result.kind !== "tool-result" || data.result.toolName !== "operate_gtm_workflow") return;
    const output = diagramOutput(data.result.output);
    if (output === null) return;
    if (output.status === "protected") {
      await channel.thread.post({ text: output.message });
      return;
    }
    const text = whereToLookText(output.links);
    let bytes: Uint8Array | null = null;
    try {
      const response = await fetchImage(output.imageUrl, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (response.status === 200 && declared <= MAX_IMAGE_BYTES) {
        const buffer = new Uint8Array(await response.arrayBuffer());
        if (buffer.byteLength > 0 && buffer.byteLength <= MAX_IMAGE_BYTES) bytes = buffer;
      }
    } catch {
      bytes = null;
    }
    if (bytes === null) {
      await channel.thread.post({ text: `${text}\nThe picture could not be downloaded; open the diagram link instead.` });
      return;
    }
    const filename = `${output.workflowPath.split("/").at(-1)}.png`;
    await channel.thread.post({ text, files: [{ filename, data: bytes }] });
  };
}
```

- [ ] **Step 4: Wire the handler into the Slack channel**

In `agent/channels/slack.ts` import `createDiagramResultHandler` and extend the `events` object:

```ts
    events: {
      "input.requested": createInputRequestedHandler(),
      "action.result": createDiagramResultHandler(),
    },
```

Eve calls the handler as `(data, channel, ctx)`; the extra `ctx` argument is ignored.

- [ ] **Step 5: Run the tests to verify they pass**

```bash
node --test tests/slack-diagram-post.test.mjs tests/slack-channel.test.mjs && pnpm typecheck
```

Expected: PASS. If `tests/slack-channel.test.mjs` asserts the exact `events` keys, add `action.result` to its expectation.

- [ ] **Step 6: Commit**

```bash
git add agent/lib/slack-diagram-post.ts agent/channels/slack.ts tests/slack-diagram-post.test.mjs tests/slack-channel.test.mjs
git commit -m "feat(slack): upload the workflow diagram with the where-to-look block"
```

---

### Task 5: Instructions and the skill sync

**Files:**
- Modify: `agent/instructions.md`, `tests/instructions.test.mjs`, `skills-lock.json`, `agent/skills/**` (generated by the sync)

- [ ] **Step 1: Write the failing instructions assertion**

In `tests/instructions.test.mjs`, add to the pattern list that is asserted with `assert.match(instructions, pattern)`:

```js
    /read-only diagram action/,
    /never paste the image link/i,
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
node --test tests/instructions.test.mjs
```

Expected: FAIL on the new patterns.

- [ ] **Step 3: Add the instructions**

In `agent/instructions.md`, under "GTM workflows in this sandbox", add these bullets after the bullet that begins `For \`Runs: on Vercel\``:

```md
- Show the workflow picture at the moments the workflow skill names (inspect or `show me the workflow`; with a create or update proposal; at run start, each checkpoint, and completion) by calling the read-only diagram action with the workflow path and, for a run, its run key. The channel uploads the picture and the three "Where to look" lines into the thread on its own; your reply adds the caption the skill describes and does not repeat the links. For a create or update proposal, the picture comes from `npm run gtm -- diagram <slug> --format ascii` in the scratch draft, because the draft is not deployed yet. Never paste the image link, the signed link, or a run key into a message; when the action reports `protected`, relay its message and stop.
- Only a `Runs: on Vercel` workflow has a hosted picture. For a `Runs: on this computer` workflow, relay the ASCII diagram from the sandbox and say that the interactive page opens from a keyboard.
```

- [ ] **Step 4: Sync the skills**

After gtm-skills 0.4.0 is merged on its `main`:

```bash
node scripts/sync-gtm-skills.mjs ../gtm-skills
pnpm skills:check
git diff --stat skills-lock.json agent/skills | tail -3
```

Expected: `skills-lock.json` records the new commit; the synced `gtm-workflow` references include the "Where to look moments" section and the qualify skill carries the verdict-first shape.

- [ ] **Step 5: Run the full check**

```bash
pnpm check
```

Expected: skills check, typecheck, every test, and the build pass.

- [ ] **Step 6: Commit**

```bash
git add agent/instructions.md tests/instructions.test.mjs skills-lock.json agent/skills
git commit -m "feat(agent): show workflow diagrams and where-to-look links in Slack"
```

- [ ] **Step 7: Verify once in a real thread**

Deploy a preview, mention the agent in an allowlisted channel with `show me the <workflow> workflow`, and confirm: the PNG appears in the thread, the three links render as links, the diagram link opens the interactive page without a Vercel login, and the `Runs` link opens Observability for a Vercel team member. If the page shows a Vercel login, the production project still has Vercel Authentication on; follow the deploy reference's protection step.
