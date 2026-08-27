import { getVercelOidcToken } from "@vercel/oidc";
import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";

import type {
  ConnectedWorkspaceConfiguration,
  WorkflowControlConfiguration,
} from "./config.ts";
import { assertWorkspaceCheckoutReady } from "./workspace-checkout.ts";

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

type Sandbox = Pick<SandboxSession, "run">;

export type WorkflowRunPreview = {
  readonly head: string;
  readonly status: "ready";
  readonly dryRun: unknown;
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
};

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
    if (
      dryRun === null ||
      typeof dryRun !== "object" ||
      !("withinCaps" in dryRun) ||
      dryRun.withinCaps !== true
    ) {
      throw new Error("The workflow dry run failed or exceeded its accepted caps.");
    }
    if (result.exitCode !== 0) {
      throw new Error("The workflow dry run failed before any real run was started.");
    }
    return { dryRun, head: input.expectedHead, status: "ready" };
  }

  async startRun(input: {
    readonly checkpoint: number | null;
    readonly expectedHead: string;
    readonly inputPath: string;
    readonly workflowPath: string;
    readonly sandbox: Sandbox;
  }): Promise<{ readonly runKey: string; readonly status: "started" | "run_in_progress" }> {
    await this.previewRun(input);
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

  async getRun(runKey: string): Promise<SanitizedWorkflowRun> {
    validateRunKey(runKey);
    const response = await this.#workflowRequest(`/api/runs/${runKey}`, {}, [200]);
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

async function readWorkflowInput(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
  inputPath: string,
): Promise<unknown> {
  validateInputPath(inputPath);
  const script = `
import { lstatSync, readFileSync } from "node:fs";
const path = process.argv[1];
const stat = lstatSync(path);
if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ${MAX_INPUT_BYTES}) throw new Error("invalid input");
process.stdout.write(readFileSync(path).toString("base64"));
`;
  const result = await runSandboxCommand(
    sandbox,
    `set -euo pipefail\nrepo_dir="${workspace.checkoutDirectory}"\nfile="$repo_dir/${inputPath}"\nnode --input-type=module -e ${shellQuote(script)} "$file"`,
    "GTM workflow input read",
  );
  try {
    return JSON.parse(
      Buffer.from(result.stdout.replaceAll("\n", ""), "base64").toString("utf8"),
    );
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
  if (error !== null) Object.assign(sanitized, { error: error.slice(0, 1_000) });
  if (run.result !== undefined) {
    const result = redactResult(run.result);
    if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MAX_RESULT_BYTES) {
      Object.assign(sanitized, { result });
    }
  }
  return sanitized;
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
