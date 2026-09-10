import { getVercelOidcToken } from "@vercel/oidc";
import { isDeepStrictEqual } from "node:util";
import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";

import type {
  ConnectedWorkspaceConfiguration,
  WorkflowControlConfiguration,
} from "./config.ts";
import {
  diagramLinks,
  tursoDashboardUrl,
  vercelObservabilityUrl,
  type WhereToLook,
} from "./diagram-link.ts";
import { assertWorkspaceCheckoutReady } from "./workspace-checkout.ts";
import { previewExecution, workflowExecutionSchema, type WorkflowExecution } from "./workflow-execution.ts";

const MAX_INPUT_BYTES = 1_000_000;
const MAX_REMOTE_RESPONSE_BYTES = 1_000_000;
const MAX_RESULT_BYTES = 50_000;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;
const DEPLOYMENT_TIMEOUT_MS = 8 * 60 * 1_000;
const POLL_INTERVAL_MS = 2_000;

const WORKFLOW_PATH_PATTERN =
  /^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/;
const INPUT_PATH_PATTERN =
  /^workflows\/data\/[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,220}[A-Za-z0-9])?\.json$/;
const HEAD_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;
const RUN_KEY_PATTERN = /^[0-9a-f]{32}$/;
/** Every path `readCheckoutFile` will interpolate into its shell command. */
const CHECKOUT_PATH_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,239}$/;

type Sandbox = Pick<SandboxSession, "run">;

export type WorkflowRunPreview = {
  readonly head: string;
  readonly status: "ready";
  readonly dryRun: unknown;
  readonly execution: WorkflowExecution | null;
  /** Rows the dry run counted; start must carry this exact number. */
  readonly rows: number;
  /** Projected spend the dry run reported; start must carry this exact value. */
  readonly projectedCostUsd: number;
};

export type SanitizedWorkflowRun = {
  readonly approval: null | {
    readonly approved?: boolean;
    readonly comment?: string | null;
    readonly stage?: string;
    readonly summary?: string;
  };
  readonly checkpoint: number | null;
  readonly completed: number;
  readonly costUsd: number;
  readonly error?: string;
  readonly failed: number;
  readonly finishedAt: number | null;
  readonly method: string;
  readonly path: string;
  readonly result?: unknown;
  readonly runKey: string;
  readonly startedAt: number;
  readonly status: string;
  readonly workflow: string;
  readonly remainingKeys?: readonly string[];
  readonly children?: readonly {
    readonly runKey: string;
    readonly workflow: string;
    readonly status: string;
    readonly completed: number;
    readonly failed: number;
    readonly costUsd: number;
    readonly remainingKeys: readonly string[];
  }[];
};

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

type WorkflowControlDependencies = {
  readonly fetch: typeof fetch;
  readonly getOidcToken: () => Promise<string>;
  readonly now: () => number;
  readonly pause: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: WorkflowControlDependencies = {
  fetch: globalThis.fetch,
  getOidcToken: getVercelOidcToken,
  now: Date.now,
  pause: (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
};

export class WorkflowControl {
  readonly #configuration: WorkflowControlConfiguration;
  readonly #dependencies: WorkflowControlDependencies;
  readonly #workspace: ConnectedWorkspaceConfiguration;

  constructor(
    configuration: WorkflowControlConfiguration,
    workspace: ConnectedWorkspaceConfiguration,
    dependencies: Partial<WorkflowControlDependencies> = {},
  ) {
    this.#configuration = configuration;
    this.#workspace = workspace;
    this.#dependencies = { ...defaultDependencies, ...dependencies };
  }

  async previewRun(input: {
    readonly checkpoint: number | null;
    readonly expectedHead: string;
    readonly inputPath: string;
    readonly workflowPath: string;
    readonly sandbox: Sandbox;
  }): Promise<WorkflowRunPreview> {
    validateRunInput(input);
    await assertWorkspaceCheckoutReady({
      workspace: this.#workspace,
      expectedHead: input.expectedHead,
      paths: [`workflows/workflows/${input.workflowPath}.ts`],
      sandbox: input.sandbox,
    });
    await ensureWorkflowDependencies(input.sandbox, this.#workspace);
    const result = await input.sandbox.run({
      command: workflowCommand(
        this.#workspace,
        `npm run gtm -- run ${input.workflowPath} --input ${input.inputPath.slice("workflows/".length)} --dry-run${input.checkpoint === null ? "" : ` --checkpoint ${input.checkpoint}`}`,
      ),
      abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
    });
    const dryRun = lastJson(result.stdout);
    if (dryRun === null) {
      const failure = lastJson(result.stderr);
      const code = nestedString(failure, "error", "code");
      const message = nestedString(failure, "error", "message");
      throw new Error(
        code === null
          ? "The workflow dry run failed before any real run was started."
          : `The workflow dry run failed with ${code}: ${message ?? "no message"}. No run was started.`,
      );
    }
    if (dryRun.withinCaps !== true) {
      throw new Error("The workflow dry run exceeded its accepted caps. No run was started.");
    }
    if (result.exitCode !== 0) {
      throw new Error("The workflow dry run failed before any real run was started.");
    }
    const rows = directNumber(dryRun, "rows");
    const projectedCostUsd = directNumber(dryRun, "projectedCostUsd");
    if (rows === null || projectedCostUsd === null) {
      throw new Error("The workflow dry run did not report rows and projected cost.");
    }
    const execution = previewExecution(dryRun, rows, input.checkpoint);
    return { dryRun, execution, head: input.expectedHead, projectedCostUsd, rows, status: "ready" };
  }

  async startRun(input: {
    readonly checkpoint: number | null;
    readonly expectedHead: string;
    readonly expectedProjectedCostUsd: number;
    readonly expectedCapabilitiesHash?: string;
    readonly expectedExecution?: WorkflowExecution | null;
    readonly expectedRows: number;
    readonly inputPath: string;
    readonly workflowPath: string;
    readonly sandbox: Sandbox;
  }): Promise<{ readonly runKey: string; readonly status: "started" | "run_in_progress" }> {
    validateAcceptedScope(input);
    const preview = await this.previewRun(input);
    const acceptedExecution = input.expectedExecution == null ? null
      : workflowExecutionSchema.parse(input.expectedExecution);
    if (!isDeepStrictEqual(preview.execution, acceptedExecution)) {
      throw new Error("The accepted execution limits differ from the fresh preview. Review concurrency, checkpoint, batch size/count, and parent deadline before starting. No run was started.");
    }
    const capabilitiesHash = directString(record(preview.dryRun), "capabilitiesHash");
    if ((capabilitiesHash !== null || input.expectedCapabilitiesHash !== undefined) &&
        capabilitiesHash !== input.expectedCapabilitiesHash) {
      throw new Error("The accepted agent capabilities differ from the fresh preview. Review tools, destinations, skills, and limits before starting. No run was started.");
    }
    if (
      preview.rows !== input.expectedRows ||
      Math.abs(preview.projectedCostUsd - input.expectedProjectedCostUsd) >= 0.005
    ) {
      throw new Error(
        `The fresh dry run reports ${preview.rows} rows and $${preview.projectedCostUsd.toFixed(2)}, not the accepted ${input.expectedRows} rows and $${input.expectedProjectedCostUsd.toFixed(2)}. Show the new preview and ask again. No run was started.`,
      );
    }
    await this.#waitForProductionHead(input.expectedHead);
    const body = await readWorkflowInput(
      input.sandbox,
      this.#workspace,
      input.inputPath,
    );
    const path = `/api/run/${encodeWorkflowPath(input.workflowPath)}`;
    const suffix = input.checkpoint === null ? "" : `?checkpoint=${input.checkpoint}`;
    const response = await this.#workflowRequest(
      `${path}${suffix}`,
      {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "x-gtm-workspace-head": input.expectedHead },
      },
      [200, 409],
    );
    if (response.status === 409) {
      const errorCode = nestedString(response.body, "error", "code");
      if (errorCode === "deployment_not_ready") {
        throw new Error(
          "Production changed before the workflow could start. No run was started.",
        );
      }
      const runKey = nestedString(response.body, "error", "runKey");
      if (runKey === null || !RUN_KEY_PATTERN.test(runKey)) {
        throw new Error("The workflow reported a conflict without a valid run key.");
      }
      return { runKey, status: "run_in_progress" };
    }
    const runKey = directString(record(response.body), "runKey");
    if (runKey === null || !RUN_KEY_PATTERN.test(runKey)) {
      throw new Error("The workflow start did not return a valid run key.");
    }
    return { runKey, status: "started" };
  }

  /** Read-only: whether the protected production project serves this workspace commit. */
  async getDeployment(
    expectedHead: string,
  ): Promise<{ readonly status: "live" | "not_live"; readonly expectedHead: string }> {
    if (!HEAD_PATTERN.test(expectedHead)) {
      throw new Error("The expected workspace commit is invalid.");
    }
    const head = await this.#readProductionHead();
    return { status: head === expectedHead ? "live" : "not_live", expectedHead };
  }

  async getRun(runKey: string): Promise<SanitizedWorkflowRun> {
    validateRunKey(runKey);
    const response = await this.#workflowRequest(`/api/runs/${runKey}`, {}, [200]);
    return sanitizeRun(response.body);
  }

  async cancelRun(input: {
    readonly reason: string | null;
    readonly runKey: string;
  }): Promise<SanitizedWorkflowRun> {
    validateRunKey(input.runKey);
    const response = await this.#workflowRequest(
      `/api/runs/${input.runKey}/cancel`,
      {
        method: "POST",
        body: JSON.stringify({ reason: input.reason }),
      },
      [200, 409],
    );
    if (response.status === 409) {
      if (nestedString(response.body, "error", "code") !== "run_not_active") {
        throw new Error("The workflow reported a conflict while cancelling the run.");
      }
      return this.getRun(input.runKey);
    }
    return sanitizeRun(response.body);
  }

  async approveRun(input: {
    readonly approved: boolean;
    readonly comment: string | null;
    readonly runKey: string;
  }): Promise<SanitizedWorkflowRun> {
    const run = await this.#getRawRun(input.runKey);
    const approval = record(run.approval);
    const token = approval === null ? null : directString(approval, "token");
    if (run.status !== "waiting" || token === null) {
      throw new Error("This run has no pending approval.");
    }
    await this.#workflowRequest(
      `/api/approve/${encodeURIComponent(token)}`,
      {
        method: "POST",
        body: JSON.stringify({ approved: input.approved, comment: input.comment }),
      },
      [200],
    );
    return this.getRun(input.runKey);
  }

  async triggerRun(input: { readonly runKey: string; readonly payload: Record<string, unknown> }) {
    validateRunKey(input.runKey);
    const body = JSON.stringify(input.payload);
    if (Buffer.byteLength(body) > MAX_INPUT_BYTES) throw new Error("The callback payload exceeds the workflow input limit.");
    const response = await this.#workflowRequest(`/api/runs/${input.runKey}/trigger`, {
      method: "POST", body,
    }, [200, 409]);
    if (response.status === 409) throw new Error("This run has no pending trigger. No callback was delivered.");
    if (record(response.body)?.accepted !== true || directString(record(response.body), "runKey") !== input.runKey) {
      throw new Error("The workflow did not confirm the callback receipt.");
    }
    return { runKey: input.runKey, status: "triggered" as const };
  }

  /**
   * Read-only: mint a signed diagram link and probe the image route exactly as
   * a Slack viewer's browser will, with no bearer and no OIDC token, so a
   * protected deployment is reported instead of posting a dead link.
   */
  async getDiagram(input: {
    readonly workflowPath: string;
    readonly runKey: string | null;
    readonly databaseUrl: string | null;
    readonly sandbox: Sandbox;
  }): Promise<WorkflowDiagram> {
    if (!WORKFLOW_PATH_PATTERN.test(input.workflowPath)) {
      throw new Error("The workflow path is invalid.");
    }
    if (input.runKey !== null) validateRunKey(input.runKey);
    const packageJson = record(
      parseWorkflowPackage(
        await readCheckoutFile(input.sandbox, this.#workspace, "workflows/package.json"),
      ),
    );
    const vercel = record(record(packageJson?.gtm)?.vercel);
    const team = directString(vercel, "team");
    const project = directString(vercel, "project");
    let runs = team !== null && project !== null
      ? vercelObservabilityUrl(team, project)
      : "https://vercel.com";
    if (input.runKey !== null) {
      const run = await this.#getRawRun(input.runKey);
      const runUrl = safeRunUrl(directString(run, "run_url"));
      if (runUrl !== null) runs = runUrl;
    }
    const exp = Math.floor((this.#dependencies.now() + DIAGRAM_LINK_TTL_MS) / 1000);
    const claims = { path: input.workflowPath, run: input.runKey, exp };
    const { url, imageUrl } = diagramLinks({
      productionUrl: this.#configuration.productionUrl,
      claims,
      secret: this.#configuration.runSecret,
    });
    const links: WhereToLook = {
      diagram: url,
      runs,
      data: tursoDashboardUrl(input.databaseUrl),
    };
    const base = {
      action: "diagram" as const,
      workflowPath: input.workflowPath,
      runKey: input.runKey,
      links,
    };
    const probe = await this.#dependencies.fetch(imageUrl, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(20_000),
    });
    const type = probe.headers.get("content-type") ?? "";
    const status = probe.status;
    await probe.body?.cancel().catch(() => {});
    if (status === 200 && type.startsWith("image/png")) {
      return {
        ...base,
        status: "ready",
        url,
        imageUrl,
        expiresAt: new Date(exp * 1000).toISOString(),
      };
    }
    // A 404 is decided before the protection branch: Vercel serves its own
    // not-found page as `text/html`, and reading that as protection would send
    // the user to the authentication settings for a workflow that is simply
    // not deployed.
    if (status === 404) {
      throw new Error("The production project does not know this workflow or run.");
    }
    if (
      status === 401 ||
      status === 403 ||
      (status >= 300 && status < 400) ||
      type.includes("text/html")
    ) {
      return { ...base, status: "protected", message: PROTECTED_MESSAGE };
    }
    throw new Error(`The diagram request failed with status ${status}.`);
  }

  async #waitForProductionHead(expectedHead: string): Promise<void> {
    const deadline = this.#dependencies.now() + DEPLOYMENT_TIMEOUT_MS;
    while (this.#dependencies.now() < deadline) {
      const head = await this.#readProductionHead();
      if (head === expectedHead) return;
      await this.#dependencies.pause(POLL_INTERVAL_MS);
    }
    throw new Error(
      "The production workflow did not reach this workspace commit in time. No run was started.",
    );
  }

  async #readProductionHead(): Promise<string | null> {
    const response = await this.#authenticatedFetch("/api/deployment", {});
    const text = await boundedText(response);
    if (response.status === 404 || response.status === 503) return null;
    if (response.status !== 200) {
      throw new Error(
        `The workflow deployment check failed with status ${response.status}.`,
      );
    }
    const head = directString(record(parseJson(text)), "head");
    if (head === null || !HEAD_PATTERN.test(head)) {
      throw new Error("The workflow deployment returned an invalid Git commit.");
    }
    return head;
  }

  async #getRawRun(runKey: string): Promise<Record<string, unknown>> {
    validateRunKey(runKey);
    const response = await this.#workflowRequest(`/api/runs/${runKey}`, {}, [200]);
    const body = record(response.body);
    if (body === null) throw new Error("The workflow returned an invalid run record.");
    return body;
  }

  async #workflowRequest(
    path: string,
    init: RequestInit,
    acceptedStatuses: readonly number[],
  ): Promise<{ readonly body: unknown; readonly status: number }> {
    const response = await this.#authenticatedFetch(path, init);
    const body = parseJson(await boundedText(response));
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(`The workflow request failed with status ${response.status}.`);
    }
    return { body, status: response.status };
  }

  async #authenticatedFetch(path: string, init: RequestInit): Promise<Response> {
    let oidcToken: string;
    try {
      oidcToken = await this.#dependencies.getOidcToken();
    } catch {
      throw new Error(
        "The Eve deployment could not obtain its Vercel OIDC identity for the protected workflow project.",
      );
    }
    return this.#dependencies.fetch(`${this.#configuration.productionUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        authorization: `Bearer ${this.#configuration.runSecret}`,
        "content-type": "application/json",
        "x-vercel-trusted-oidc-idp-token": oidcToken,
      },
      signal: AbortSignal.timeout(20_000),
    });
  }
}

async function boundedText(response: Response): Promise<string> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_RESPONSE_BYTES) {
    throw new Error("The workflow response exceeded the host control limit.");
  }
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The workflow returned a non-JSON response.");
  }
}

function parseWorkflowPackage(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("The workspace's workflows/package.json is not valid JSON.");
  }
}

async function ensureWorkflowDependencies(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
): Promise<void> {
  await runSandboxCommand(
    sandbox,
    workflowCommand(
      workspace,
      "test -x node_modules/.bin/tsx || npm ci --include=dev --ignore-scripts --no-audit --no-fund",
    ),
    "GTM workflow dependency installation",
  );
}

/** The one bounded reader for a file inside the connected workspace checkout. */
async function readCheckoutFile(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
  relativePath: string,
): Promise<string> {
  if (
    !CHECKOUT_PATH_PATTERN.test(relativePath) ||
    relativePath.split("/").includes("..")
  ) {
    throw new Error("The workspace file path is invalid.");
  }
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
  return Buffer.from(result.stdout.replaceAll("\n", ""), "base64").toString("utf8");
}

async function readWorkflowInput(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
  inputPath: string,
): Promise<unknown> {
  validateInputPath(inputPath);
  const contents = await readCheckoutFile(sandbox, workspace, inputPath);
  try {
    return JSON.parse(contents);
  } catch {
    throw new Error("The workflow input file is not valid bounded JSON.");
  }
}

function validateRunInput(input: {
  readonly checkpoint: number | null;
  readonly expectedHead: string;
  readonly inputPath: string;
  readonly workflowPath: string;
}): void {
  if (!HEAD_PATTERN.test(input.expectedHead)) {
    throw new Error("The workflow action requires one full committed workspace HEAD.");
  }
  if (!WORKFLOW_PATH_PATTERN.test(input.workflowPath)) {
    throw new Error("The workflow path is invalid.");
  }
  validateInputPath(input.inputPath);
  if (
    input.checkpoint !== null &&
    (!Number.isSafeInteger(input.checkpoint) || input.checkpoint < 1)
  ) {
    throw new Error("The checkpoint must be a positive integer or null.");
  }
}

function validateAcceptedScope(input: {
  readonly expectedProjectedCostUsd: number;
  readonly expectedRows: number;
}): void {
  if (!Number.isSafeInteger(input.expectedRows) || input.expectedRows < 0) {
    throw new Error("The accepted row count must be a non-negative integer.");
  }
  if (!Number.isFinite(input.expectedProjectedCostUsd) || input.expectedProjectedCostUsd < 0) {
    throw new Error("The accepted projected cost must be a non-negative number.");
  }
}

function validateInputPath(inputPath: string): void {
  if (
    !INPUT_PATH_PATTERN.test(inputPath) ||
    inputPath.includes("..") ||
    inputPath.includes("//")
  ) {
    throw new Error("The workflow input must be one JSON file beneath workflows/data/.");
  }
}

function validateRunKey(runKey: string): void {
  if (!RUN_KEY_PATTERN.test(runKey)) throw new Error("The run key is invalid.");
}

function sanitizeRun(value: unknown): SanitizedWorkflowRun {
  const run = record(value);
  if (run === null) throw new Error("The workflow returned an invalid run record.");
  const runKey = directString(run, "runKey");
  if (runKey === null || !RUN_KEY_PATTERN.test(runKey)) {
    throw new Error("The workflow returned an invalid run key.");
  }
  const approval = record(run.approval);
  const sanitized: SanitizedWorkflowRun = {
    approval:
      approval === null
        ? null
        : compact({
            approved: directBoolean(approval, "approved"),
            comment: nullableString(approval, "comment"),
            stage: directString(approval, "stage") ?? undefined,
            summary: directString(approval, "summary") ?? undefined,
          }),
    checkpoint: nullableNumber(run, "checkpoint") ?? null,
    completed: directNumber(run, "completed") ?? 0,
    costUsd: directNumber(run, "costUsd") ?? directNumber(run, "cost_usd") ?? 0,
    failed: directNumber(run, "failed") ?? 0,
    finishedAt: nullableNumber(run, "finishedAt") ?? null,
    method: directString(run, "method") ?? "",
    path: directString(run, "path") ?? "",
    runKey,
    startedAt: directNumber(run, "startedAt") ?? 0,
    status: directString(run, "status") ?? "unknown",
    workflow: directString(run, "workflow") ?? "",
  };
  const error = directString(record(run.error), "message") ?? directString(run, "error");
  const remainingKeys = run.remaining_keys ?? run.remainingKeys;
  if (Array.isArray(remainingKeys)) Object.assign(sanitized, { remainingKeys: safeRowKeys(remainingKeys) });
  if (Array.isArray(run.children)) {
    Object.assign(sanitized, { children: run.children.slice(0, 100).map((value) => {
      const child = record(value);
      const childKey = directString(child, "runKey");
      if (child === null || childKey === null || !RUN_KEY_PATTERN.test(childKey)) {
        throw new Error("The workflow returned an invalid child run.");
      }
      return {
        runKey: childKey,
        workflow: directString(child, "workflow") ?? "",
        status: directString(child, "status") ?? "unknown",
        completed: directNumber(child, "completed") ?? 0,
        failed: directNumber(child, "failed") ?? 0,
        costUsd: directNumber(child, "costUsd") ?? 0,
        remainingKeys: safeRowKeys(child.remainingKeys),
      };
    }) });
  }
  if (error !== null) Object.assign(sanitized, { error: error.slice(0, 1_000) });
  if (run.result !== undefined) {
    const result = redactResult(run.result);
    if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_RESULT_BYTES) {
      Object.assign(sanitized, { result });
    }
  }
  return sanitized;
}

function safeRowKeys(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((key): key is string => typeof key === "string").slice(0, 30_000) : [];
}

function redactResult(value: unknown): unknown {
  if (Array.isArray(value)) return value.slice(0, 500).map(redactResult);
  const item = record(value);
  if (item === null) return value;
  return Object.fromEntries(
    Object.entries(item)
      .filter(([key]) => !/(?:authorization|password|secret|token|webhook.?url)/i.test(key))
      .map(([key, child]) => [key, redactResult(child)]),
  );
}

function workflowCommand(
  workspace: ConnectedWorkspaceConfiguration,
  command: string,
): string {
  return `set -euo pipefail\ncd "${workspace.checkoutDirectory}/workflows"\n${command}`;
}

async function runSandboxCommand(
  sandbox: Sandbox,
  command: string,
  label: string,
): Promise<SandboxCommandResult> {
  const result = await sandbox.run({
    command,
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed. Start a fresh Slack thread after inspecting the workspace.`);
  }
  return result;
}

function lastJson(output: string): Record<string, unknown> | null {
  for (const line of output.trim().split("\n").reverse()) {
    try {
      const parsed = record(JSON.parse(line));
      if (parsed !== null) return parsed;
    } catch {}
  }
  return null;
}

/**
 * A stored `run_url` comes from the workspace's own deployment and is rendered
 * as a Slack mrkdwn link, where `<`, `>` and `|` retarget the link and rewrite
 * its visible label. Accept it only as a plain `https://vercel.com` URL.
 */
function safeRunUrl(value: string | null): string | null {
  if (value === null || /[<>|]/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === "https:" && url.hostname === "vercel.com" ? value : null;
}

function encodeWorkflowPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function directString(value: Record<string, unknown> | null, key: string): string | null {
  const item = value?.[key];
  return typeof item === "string" ? item : null;
}

function nullableString(value: Record<string, unknown>, key: string): string | null | undefined {
  const item = value[key];
  return item === null ? null : typeof item === "string" ? item : undefined;
}

function directNumber(value: Record<string, unknown>, key: string): number | null {
  const item = value[key];
  return typeof item === "number" && Number.isFinite(item) ? item : null;
}

function nullableNumber(value: Record<string, unknown>, key: string): number | null | undefined {
  const item = value[key];
  return item === null ? null : typeof item === "number" && Number.isFinite(item) ? item : undefined;
}

function directBoolean(value: Record<string, unknown>, key: string): boolean | undefined {
  const item = value[key];
  return typeof item === "boolean" ? item : undefined;
}

function nestedString(value: unknown, outer: string, inner: string): string | null {
  return directString(record(record(value)?.[outer]), inner);
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}
