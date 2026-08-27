import { createHash } from "node:crypto";

import { getVercelOidcToken } from "@vercel/oidc";
import { VercelCore } from "@vercel/sdk/core.js";
import { deploymentsCreateDeployment } from "@vercel/sdk/funcs/deploymentsCreateDeployment.js";
import { deploymentsGetDeployment } from "@vercel/sdk/funcs/deploymentsGetDeployment.js";
import { deploymentsUploadFile } from "@vercel/sdk/funcs/deploymentsUploadFile.js";
import { projectsFilterProjectEnvs } from "@vercel/sdk/funcs/projectsFilterProjectEnvs.js";
import type { SandboxCommandResult, SandboxSession } from "eve/sandbox";

import type {
  ConnectedWorkspaceConfiguration,
  WorkflowControlConfiguration,
} from "./config.ts";
import { assertWorkspaceCheckoutReady } from "./workspace-checkout.ts";

const MAX_DEPLOYMENT_FILES = 512;
const MAX_DEPLOYMENT_FILE_BYTES = 1_000_000;
const MAX_DEPLOYMENT_BYTES = 4_000_000;
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
const RUN_KEY_PATTERN = /^[0-9a-f]{32}$/;

type Sandbox = Pick<SandboxSession, "run">;

type DeploymentFile = {
  readonly data: Uint8Array;
  readonly file: string;
  readonly sha: string;
  readonly size: number;
};

type DeploymentSnapshot = {
  readonly files: readonly DeploymentFile[];
  readonly head: string;
  readonly migrationCount: number;
  readonly packageMetadata: {
    readonly libVersion: number;
    readonly project: string;
    readonly team: string | null;
    readonly url: string;
  };
  readonly requiredEnvironmentNames: readonly string[];
  readonly totalBytes: number;
};

export type WorkflowDeploymentPreview = {
  readonly environmentReady: true;
  readonly fileCount: number;
  readonly head: string;
  readonly libVersion: number;
  readonly migrationCount: number;
  readonly status: "ready";
  readonly totalBytes: number;
  readonly validation: unknown;
};

export type WorkflowDeploymentResult = {
  readonly head: string;
  readonly productionUrl: string;
  readonly status: "ready";
};

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

type VercelDeploymentState = {
  readonly id: string;
  readonly meta: Readonly<Record<string, string>>;
  readonly projectId: string;
  readonly readyState: string;
  readonly url: string;
};

type VercelAdapter = {
  readonly deployments: {
    readonly createDeployment: (input: unknown) => Promise<unknown>;
    readonly getDeployment: (input: unknown) => Promise<unknown>;
    readonly uploadFile: (input: unknown) => Promise<unknown>;
  };
  readonly projects: {
    readonly filterProjectEnvs: (input: unknown) => Promise<unknown>;
  };
};

type WorkflowControlDependencies = {
  readonly createVercel: (token: string) => VercelAdapter;
  readonly getOidcToken: () => Promise<string>;
  readonly now: () => number;
  readonly pause: (milliseconds: number) => Promise<void>;
};

const defaultDependencies: WorkflowControlDependencies = {
  createVercel: createVercelAdapter,
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
    dependencies: WorkflowControlDependencies = defaultDependencies,
  ) {
    this.#configuration = configuration;
    this.#workspace = workspace;
    this.#dependencies = dependencies;
  }

  async previewDeployment(
    expectedHead: string,
    sandbox: Sandbox,
  ): Promise<WorkflowDeploymentPreview> {
    const snapshot = await this.#prepareDeployment(expectedHead, sandbox);
    return deploymentPreview(snapshot);
  }

  async deploy(
    expectedHead: string,
    sandbox: Sandbox,
  ): Promise<WorkflowDeploymentResult> {
    const snapshot = await this.#prepareDeployment(expectedHead, sandbox);
    await runSandboxCommand(
      sandbox,
      workflowCommand(this.#workspace, "npm run db:migrate"),
      "Committed cloud migration",
    );

    const vercel = this.#dependencies.createVercel(
      this.#configuration.vercelToken,
    );
    try {
      for (let index = 0; index < snapshot.files.length; index += 8) {
        await Promise.all(
          snapshot.files.slice(index, index + 8).map((file) =>
            vercel.deployments.uploadFile({
              contentLength: file.size,
              requestBody: file.data,
              teamId: this.#configuration.teamId,
              xVercelDigest: file.sha,
            }),
          ),
        );
      }

      const created = await vercel.deployments.createDeployment({
        forceNew: "1",
        skipAutoDetectionConfirmation: "1",
        teamId: this.#configuration.teamId,
        requestBody: {
          files: snapshot.files.map(({ file, sha, size }) => ({ file, sha, size })),
          meta: {
            gtmWorkspaceHead: snapshot.head,
            gtmWorkspaceRepository: this.#workspace.repository,
          },
          name: this.#configuration.projectName,
          project: this.#configuration.projectId,
          target: "production",
        },
      });
      const createdState = deploymentState(created);
      const ready = await this.#waitForDeployment(vercel, createdState.id);
      if (
        ready.projectId !== this.#configuration.projectId ||
        ready.meta.gtmWorkspaceHead !== expectedHead
      ) {
        throw new Error("Vercel returned a deployment outside the fixed workflow target.");
      }
      return {
        head: expectedHead,
        productionUrl: this.#configuration.productionUrl,
        status: "ready",
      };
    } catch {
      throw new Error(
        "The approved workflow deployment did not reach READY. Inspect the fixed Vercel workflow project before retrying.",
      );
    }
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
    await this.#assertProductionHead(input.expectedHead);
    const body = await readWorkflowInput(
      input.sandbox,
      this.#workspace,
      input.inputPath,
    );
    const path = `/api/run/${encodeWorkflowPath(input.workflowPath)}`;
    const suffix = input.checkpoint === null ? "" : `?checkpoint=${input.checkpoint}`;
    const response = await this.#workflowRequest(`${path}${suffix}`, {
      method: "POST",
      body: JSON.stringify(body),
    }, [200, 409]);
    if (response.status === 409) {
      const runKey = nestedString(response.body, "error", "runKey");
      if (runKey === null || !RUN_KEY_PATTERN.test(runKey)) {
        throw new Error("The workflow reported a duplicate run without a valid run key.");
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
    await this.#workflowRequest(`/api/approve/${encodeURIComponent(token)}`, {
      method: "POST",
      body: JSON.stringify({ approved: input.approved, comment: input.comment }),
    }, [200]);
    return this.getRun(input.runKey);
  }

  async #prepareDeployment(
    expectedHead: string,
    sandbox: Sandbox,
  ): Promise<DeploymentSnapshot> {
    await assertWorkspaceCheckoutReady({
      workspace: this.#workspace,
      expectedHead,
      paths: ["workflows"],
      sandbox,
    });
    await ensureWorkflowDependencies(sandbox, this.#workspace);
    const check = await runSandboxCommand(
      sandbox,
      workflowCommand(this.#workspace, "npm run gtm -- check"),
      "GTM workflow validation",
    );
    const validation = lastJson(check.stdout);
    if (validation === null) {
      throw new Error("GTM workflow validation returned no structured result.");
    }
    const snapshot = await readDeploymentSnapshot(
      sandbox,
      this.#workspace,
      expectedHead,
    );
    validatePackageMetadata(snapshot, this.#configuration);
    await this.#assertEnvironment(snapshot.requiredEnvironmentNames);
    return Object.assign(snapshot, { validation });
  }

  async #assertEnvironment(requiredNames: readonly string[]): Promise<void> {
    try {
      const response = await this.#dependencies
        .createVercel(this.#configuration.vercelToken)
        .projects.filterProjectEnvs({
          decrypt: "false",
          idOrName: this.#configuration.projectId,
          teamId: this.#configuration.teamId,
        });
      const responseRecord = record(response);
      const envs = Array.isArray(responseRecord?.envs) ? responseRecord.envs : [];
      const production = new Set(
        envs
          .map(record)
          .filter((entry): entry is Record<string, unknown> => entry !== null)
          .filter((entry) => hasTarget(entry.target, "production"))
          .map((entry) => directString(entry, "key"))
          .filter((name): name is string => name !== null),
      );
      const missing = requiredNames.filter((name) => !production.has(name));
      if (missing.length > 0) {
        throw new Error(`Missing production environment names: ${missing.join(", ")}`);
      }
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Missing production")) {
        throw error;
      }
      throw new Error(
        "The fixed Vercel workflow project's production environment could not be verified.",
      );
    }
  }

  async #assertProductionHead(expectedHead: string): Promise<void> {
    try {
      const hostname = new URL(this.#configuration.productionUrl).hostname;
      const deployment = await this.#dependencies
        .createVercel(this.#configuration.vercelToken)
        .deployments.getDeployment({
          idOrUrl: hostname,
          teamId: this.#configuration.teamId,
        });
      const state = deploymentState(deployment);
      if (
        state.projectId !== this.#configuration.projectId ||
        state.readyState !== "READY" ||
        state.meta.gtmWorkspaceHead !== expectedHead
      ) {
        throw new Error("head mismatch");
      }
    } catch {
      throw new Error(
        "The production workflow deployment does not match this workspace HEAD. Deploy it before starting a real run.",
      );
    }
  }

  async #waitForDeployment(
    vercel: VercelAdapter,
    deploymentId: string,
  ): Promise<VercelDeploymentState> {
    const deadline = this.#dependencies.now() + DEPLOYMENT_TIMEOUT_MS;
    while (this.#dependencies.now() < deadline) {
      const state = deploymentState(
        await vercel.deployments.getDeployment({
          idOrUrl: deploymentId,
          teamId: this.#configuration.teamId,
        }),
      );
      if (state.readyState === "READY") return state;
      if (["ERROR", "CANCELED"].includes(state.readyState)) {
        throw new Error("deployment failed");
      }
      await this.#dependencies.pause(POLL_INTERVAL_MS);
    }
    throw new Error("deployment timed out");
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
    let oidcToken: string;
    try {
      oidcToken = await this.#dependencies.getOidcToken();
    } catch {
      throw new Error(
        "The Eve deployment could not obtain its Vercel OIDC identity for the protected workflow project.",
      );
    }
    const response = await fetch(`${this.#configuration.productionUrl}${path}`, {
      ...init,
      headers: {
        ...init.headers,
        "authorization": `Bearer ${this.#configuration.runSecret}`,
        "content-type": "application/json",
        "x-vercel-trusted-oidc-idp-token": oidcToken,
      },
      signal: AbortSignal.timeout(20_000),
    });
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_REMOTE_RESPONSE_BYTES) {
      throw new Error("The workflow response exceeded the host control limit.");
    }
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error("The workflow returned a non-JSON response.");
    }
    if (!acceptedStatuses.includes(response.status)) {
      throw new Error(`The workflow request failed with status ${response.status}.`);
    }
    return { body, status: response.status };
  }
}

function createVercelAdapter(token: string): VercelAdapter {
  const client = new VercelCore({ bearerToken: token });
  return {
    deployments: {
      createDeployment: (input) =>
        unwrapSdk(
          deploymentsCreateDeployment(
            client,
            input as Parameters<typeof deploymentsCreateDeployment>[1],
          ),
        ),
      getDeployment: (input) =>
        unwrapSdk(
          deploymentsGetDeployment(
            client,
            input as Parameters<typeof deploymentsGetDeployment>[1],
          ),
        ),
      uploadFile: (input) =>
        unwrapSdk(
          deploymentsUploadFile(
            client,
            input as Parameters<typeof deploymentsUploadFile>[1],
          ),
        ),
    },
    projects: {
      filterProjectEnvs: (input) =>
        unwrapSdk(
          projectsFilterProjectEnvs(
            client,
            input as Parameters<typeof projectsFilterProjectEnvs>[1],
          ),
        ),
    },
  };
}

async function unwrapSdk<T>(
  promise: Promise<{ readonly ok: true; readonly value: T } | { readonly ok: false }>,
): Promise<T> {
  const result = await promise;
  if (!result.ok) throw new Error("Vercel request failed.");
  return result.value;
}

function deploymentPreview(
  snapshot: DeploymentSnapshot & { readonly validation?: unknown },
): WorkflowDeploymentPreview {
  return {
    environmentReady: true,
    fileCount: snapshot.files.length,
    head: snapshot.head,
    libVersion: snapshot.packageMetadata.libVersion,
    migrationCount: snapshot.migrationCount,
    status: "ready",
    totalBytes: snapshot.totalBytes,
    validation: snapshot.validation ?? null,
  };
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

async function readDeploymentSnapshot(
  sandbox: Sandbox,
  workspace: ConnectedWorkspaceConfiguration,
  expectedHead: string,
): Promise<DeploymentSnapshot> {
  const script = `
import { lstatSync, readFileSync } from "node:fs";
const input = [];
for await (const chunk of process.stdin) input.push(chunk);
const paths = Buffer.concat(input).toString("utf8").split("\\0").filter(Boolean);
if (paths.length === 0 || paths.length > ${MAX_DEPLOYMENT_FILES}) throw new Error("invalid file count");
let total = 0;
const files = paths.map((path) => {
  if (!path.startsWith("workflows/") || path.includes("..")) throw new Error("invalid path");
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > ${MAX_DEPLOYMENT_FILE_BYTES}) throw new Error("invalid file");
  total += stat.size;
  if (total > ${MAX_DEPLOYMENT_BYTES}) throw new Error("source too large");
  return { file: path.slice("workflows/".length), size: stat.size, data: readFileSync(path).toString("base64") };
});
process.stdout.write(JSON.stringify({ files, totalBytes: total }));
`;
  const command = `set -euo pipefail\ncd "${workspace.checkoutDirectory}"\ntest "$(git rev-parse HEAD)" = "${expectedHead}"\ngit ls-files -z -- workflows/ | node --input-type=module -e ${shellQuote(script)}`;
  const result = await runSandboxCommand(
    sandbox,
    command,
    "GTM workflow deployment source collection",
  );
  const raw = JSON.parse(result.stdout) as {
    files?: { data?: string; file?: string; size?: number }[];
    totalBytes?: number;
  };
  if (!Array.isArray(raw.files) || typeof raw.totalBytes !== "number") {
    throw new Error("The workflow deployment source was invalid.");
  }
  const files = raw.files.map((entry) => {
    if (
      typeof entry.file !== "string" ||
      typeof entry.data !== "string" ||
      typeof entry.size !== "number"
    ) {
      throw new Error("The workflow deployment source contained an invalid file.");
    }
    const data = Buffer.from(entry.data, "base64");
    if (data.byteLength !== entry.size) {
      throw new Error("The workflow deployment source size did not match.");
    }
    return {
      data,
      file: entry.file,
      sha: createHash("sha1").update(data).digest("hex"),
      size: entry.size,
    };
  });
  const packageFile = files.find((file) => file.file === "package.json");
  if (packageFile === undefined) {
    throw new Error("The tracked workflow project has no package.json.");
  }
  const packageJson = JSON.parse(Buffer.from(packageFile.data).toString("utf8"));
  const metadata = record(record(packageJson)?.gtm);
  const vercel = record(metadata?.vercel);
  const envExample = files.find((file) => file.file === ".env.example");
  if (envExample === undefined) {
    throw new Error("The tracked workflow project has no .env.example.");
  }
  const requiredEnvironmentNames = new Set(
    Buffer.from(envExample.data)
      .toString("utf8")
      .split("\n")
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined),
  );
  for (const name of ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN", "GTM_RUN_SECRET"]) {
    requiredEnvironmentNames.add(name);
  }
  const vercelFile = files.find((file) => file.file === "vercel.json");
  if (vercelFile !== undefined) {
    const vercelJson = record(JSON.parse(Buffer.from(vercelFile.data).toString("utf8")));
    if (Array.isArray(vercelJson?.crons) && vercelJson.crons.length > 0) {
      requiredEnvironmentNames.add("CRON_SECRET");
    }
  }
  return {
    files,
    head: expectedHead,
    migrationCount: files.filter((file) => /^drizzle\/[^/]+\.sql$/.test(file.file)).length,
    packageMetadata: {
      libVersion: typeof metadata?.libVersion === "number" ? metadata.libVersion : -1,
      project: directString(vercel, "project") ?? "",
      team: directString(vercel, "team"),
      url: directString(vercel, "url") ?? "",
    },
    requiredEnvironmentNames: [...requiredEnvironmentNames].sort(),
    totalBytes: raw.totalBytes,
  };
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
    return JSON.parse(Buffer.from(result.stdout.replaceAll("\n", ""), "base64").toString("utf8"));
  } catch {
    throw new Error("The workflow input file is not valid bounded JSON.");
  }
}

function validatePackageMetadata(
  snapshot: DeploymentSnapshot,
  configuration: WorkflowControlConfiguration,
): void {
  if (
    snapshot.packageMetadata.libVersion !== 4 ||
    snapshot.packageMetadata.project !== configuration.projectName ||
    snapshot.packageMetadata.url !== configuration.productionUrl
  ) {
    throw new Error(
      "The committed workflow deployment metadata does not match the fixed Vercel workflow project.",
    );
  }
}

function validateRunInput(input: {
  readonly checkpoint: number | null;
  readonly expectedHead: string;
  readonly inputPath: string;
  readonly workflowPath: string;
}): void {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input.expectedHead)) {
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

function deploymentState(value: unknown): VercelDeploymentState {
  const deployment = record(value);
  const id = deployment === null ? null : directString(deployment, "id") ?? directString(deployment, "uid");
  const projectId = deployment === null ? null : directString(deployment, "projectId");
  const readyState = deployment === null ? null : directString(deployment, "readyState");
  const url = deployment === null ? null : directString(deployment, "url");
  if (id === null || projectId === null || readyState === null || url === null) {
    throw new Error("Vercel returned an invalid deployment record.");
  }
  const meta = record(deployment?.meta) ?? {};
  return {
    id,
    meta: Object.fromEntries(
      Object.entries(meta).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    ),
    projectId,
    readyState,
    url,
  };
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
      const value = JSON.parse(line);
      const parsed = record(value);
      if (parsed !== null) return parsed;
    } catch {}
  }
  return null;
}

function encodeWorkflowPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

function hasTarget(value: unknown, target: string): boolean {
  return Array.isArray(value) ? value.includes(target) : value === target;
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
