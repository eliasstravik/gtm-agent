import type {
  SandboxCommandResult,
  SandboxNetworkPolicy,
  SandboxSession,
  SandboxSessionUseFn,
} from "eve/sandbox";

import {
  WORKSPACE_BRANCH,
  type ConnectedWorkspaceConfiguration,
} from "./config.ts";

type VercelSessionUse = SandboxSessionUseFn<{
  readonly networkPolicy?: SandboxNetworkPolicy;
}>;

const SANDBOX_COMMAND_TIMEOUT_MS = 30_000;
const WORKFLOW_PREPARATION_TIMEOUT_MS = 2 * 60 * 1000;

type CustomNetworkPolicy = Exclude<SandboxNetworkPolicy, string>;
type NetworkAllowMap = Extract<CustomNetworkPolicy["allow"], Record<string, unknown>>;

/**
 * Variables that must never reach the session environment. Connector tokens
 * are brokered into Git upload-pack only; the Turso token and workflow
 * Gateway key are brokered at the firewall for their exact hosts.
 */
const FORBIDDEN_SESSION_VARIABLES = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_AUTH_TOKEN",
  "GTM_WORKFLOW_RUN_SECRET",
  "CONNECT_TOKEN",
  "TURSO_AUTH_TOKEN",
  "GTM_WORKFLOW_GATEWAY_API_KEY",
] as const;

export type WorkspaceCheckoutMetadata = {
  readonly branch: typeof WORKSPACE_BRANCH;
  readonly checkoutDirectory: string;
  readonly head: string;
  readonly repository: string;
};

export class EgressNotClosedError extends Error {
  constructor() {
    super(
      "Sandbox egress could not be restored to its session baseline. End this session immediately.",
    );
    this.name = "EgressNotClosedError";
  }
}

export function createGitBasicAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

/**
 * Egress for a clone or refresh: the session baseline (deny-all, or the
 * workflow allowlist) plus credentialed access to this repository's
 * upload-pack endpoints only. Keeping the baseline means a workflow run in
 * progress does not lose its database or provider egress mid-refresh.
 */
export function createGitNetworkPolicy(
  workspace: ConnectedWorkspaceConfiguration,
  authorization: string,
  baseline: SandboxNetworkPolicy = "deny-all",
): CustomNetworkPolicy {
  return {
    allow: {
      ...baselineAllowMap(baseline),
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: `/${workspace.owner}/${workspace.repo}.git/info/refs` },
            queryString: [
              {
                key: { exact: "service" },
                value: { exact: "git-upload-pack" },
              },
            ],
          },
          transform: [{ headers: { authorization } }],
        },
        {
          match: {
            method: ["POST"],
            path: {
              exact: `/${workspace.owner}/${workspace.repo}.git/git-upload-pack`,
            },
          },
          transform: [{ headers: { authorization } }],
        },
      ],
    },
  };
}

export async function hydrateWorkspaceCheckout({
  authorization,
  baselinePolicy = "deny-all",
  prepareWorkflowRuntime = false,
  workspace,
  use,
}: {
  readonly authorization: string;
  readonly baselinePolicy?: SandboxNetworkPolicy;
  readonly prepareWorkflowRuntime?: boolean;
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly use: VercelSessionUse;
}): Promise<WorkspaceCheckoutMetadata> {
  const sandbox = await use({
    networkPolicy: createGitNetworkPolicy(workspace, authorization, baselinePolicy),
  });

  try {
    await runCredentialFree(
      sandbox,
      createCloneCommand(workspace),
      "GTM workspace checkout",
    );
  } finally {
    await closeSandboxEgress(sandbox, baselinePolicy);
  }

  const head = await verifyWorkspaceCheckout(sandbox, workspace);
  if (prepareWorkflowRuntime) {
    await prepareWorkspaceWorkflowRuntime(sandbox, workspace);
  }
  return {
    branch: workspace.branch,
    checkoutDirectory: workspace.checkoutDirectory,
    head,
    repository: workspace.repository,
  };
}

async function prepareWorkspaceWorkflowRuntime(
  sandbox: Pick<SandboxSession, "run">,
  workspace: ConnectedWorkspaceConfiguration,
): Promise<void> {
  await runCredentialFree(
    sandbox,
    createWorkflowRuntimePreparationCommand(workspace),
    "GTM workflow dependency installation",
    WORKFLOW_PREPARATION_TIMEOUT_MS,
  );
}

export async function verifyWorkspaceCheckout(
  sandbox: Pick<SandboxSession, "run">,
  workspace: ConnectedWorkspaceConfiguration,
  expectedHead?: string,
): Promise<string> {
  const result = await runSandboxCommand(
    sandbox,
    createVerificationCommand(workspace, expectedHead),
  );
  assertSucceeded("GTM workspace verification", result);

  const head = result.stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head)) {
    throw new Error("GTM workspace verification returned an invalid HEAD.");
  }
  return head;
}

export async function assertWorkspaceCheckoutReady({
  workspace,
  expectedHead,
  paths,
  sandbox,
}: {
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly expectedHead: string;
  readonly paths: readonly string[];
  readonly sandbox: Pick<SandboxSession, "run">;
}): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    createMutationPreflightCommand(workspace, expectedHead, paths),
  );
  assertPreflightSucceeded(result);
}

export async function refreshWorkspaceCheckout({
  authorization,
  baselinePolicy = "deny-all",
  commitSha,
  workspace,
  sandbox,
}: {
  readonly authorization: string;
  readonly baselinePolicy?: SandboxNetworkPolicy;
  readonly commitSha: string;
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly sandbox: Pick<SandboxSession, "run" | "setNetworkPolicy">;
}): Promise<void> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commitSha)) {
    throw new Error("Refusing to refresh to an invalid Git object ID.");
  }
  await sandbox.setNetworkPolicy(
    createGitNetworkPolicy(workspace, authorization, baselinePolicy),
  );
  try {
    await runCredentialFree(
      sandbox,
      createRefreshCommand(workspace, commitSha),
      "GTM workspace refresh",
    );
  } finally {
    await closeSandboxEgress(sandbox, baselinePolicy);
  }

  const head = await verifyWorkspaceCheckout(sandbox, workspace, commitSha);
  if (head !== commitSha) {
    throw new Error("GTM workspace refresh did not reach the durable commit.");
  }
}

export async function markWorkspaceCheckoutStale(
  sandbox: Pick<SandboxSession, "run">,
  workspace: ConnectedWorkspaceConfiguration,
): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    `set -euo pipefail\numask 077\nmkdir -p "$HOME/.gtm"\n: > "${workspace.staleMarker}"`,
  );
  assertSucceeded("GTM workspace stale marker", result);
}

function createCloneCommand(workspace: ConnectedWorkspaceConfiguration): string {
  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
mkdir -p "$HOME/.gtm"
mkdir "$repo_dir"
git clone --depth=1 --single-branch --branch "${workspace.branch}" --no-tags \\
  "https://github.com/${workspace.repository}.git" "$repo_dir"
git -C "$repo_dir" remote remove origin`;
}

function createRefreshCommand(
  workspace: ConnectedWorkspaceConfiguration,
  commitSha: string,
): string {
  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
git -C "$repo_dir" fetch --depth=1 --no-tags \\
  "https://github.com/${workspace.repository}.git" "${commitSha}"
test "$(git -C "$repo_dir" rev-parse FETCH_HEAD)" = "${commitSha}"
git -C "$repo_dir" reset --hard "${commitSha}"`;
}

function createWorkflowRuntimePreparationCommand(
  workspace: ConnectedWorkspaceConfiguration,
): string {
  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
workflow_dir="$repo_dir/workflows"
if test ! -f "$workflow_dir/package.json"; then
  exit 0
fi
test -f "$workflow_dir/package-lock.json"
test ! -L "$workflow_dir"
test ! -L "$workflow_dir/package.json"
test ! -L "$workflow_dir/package-lock.json"
cd "$workflow_dir"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
test -x node_modules/.bin/tsx`;
}

function createVerificationCommand(
  workspace: ConnectedWorkspaceConfiguration,
  expectedHead?: string,
): string {
  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
if test -f "$repo_dir/ORG.md" && test ! -L "$repo_dir/ORG.md"; then
  :
else
  test -f "$repo_dir/org.md"
  test ! -L "$repo_dir/org.md"
fi
test "$(git -C "$repo_dir" branch --show-current)" = "${workspace.branch}"
test -z "$(git -C "$repo_dir" status --porcelain)"
test -z "$(git -C "$repo_dir" remote)"
test ! -e "${workspace.staleMarker}"
if git -C "$repo_dir" ls-files --stage | awk '$1 == "120000" || $1 == "160000" { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "Unsupported symlink or gitlink in GTM workspace checkout" >&2
  exit 1
fi
for variable in ${FORBIDDEN_SESSION_VARIABLES.join(" ")}; do
  if printenv "$variable" >/dev/null 2>&1; then
    echo "Unexpected credential variable: $variable" >&2
    exit 1
  fi
done
if git -C "$repo_dir" config --local --get-regexp '(^credential\\.|^http\\..*\\.extraheader$)' >/dev/null 2>&1; then
  echo "Unexpected Git credential configuration" >&2
  exit 1
fi
head="$(git -C "$repo_dir" rev-parse HEAD)"
${expectedHead === undefined ? "" : `test "$head" = "${expectedHead}"`}
printf '%s\\n' "$head"`;
}

function createMutationPreflightCommand(
  workspace: ConnectedWorkspaceConfiguration,
  expectedHead: string,
  paths: readonly string[],
): string {
  const symlinkChecks = paths
    .flatMap((path) => pathPrefixes(path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .map((path) => `test ! -L "$repo_dir/${path}"`)
    .join("\n");

  return `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
fail() { printf '%s\n' "$1"; exit 1; }
test ! -e "${workspace.staleMarker}" || fail STALE
test -z "$(git -C "$repo_dir" status --porcelain)" || fail DIRTY
test "$(git -C "$repo_dir" branch --show-current)" = "${workspace.branch}" || fail WRONG_BRANCH
test "$(git -C "$repo_dir" rev-parse HEAD)" = "${expectedHead}" || fail WRONG_HEAD
${symlinkChecks}`;
}

function pathPrefixes(path: string): string[] {
  const segments = path.split("/");
  return segments.map((_, index) => segments.slice(0, index + 1).join("/"));
}

async function runCredentialFree(
  sandbox: Pick<SandboxSession, "run">,
  command: string,
  label: string,
  timeoutMs = SANDBOX_COMMAND_TIMEOUT_MS,
): Promise<void> {
  const result = await runSandboxCommand(sandbox, command, timeoutMs);
  assertSucceeded(label, result);
}

function runSandboxCommand(
  sandbox: Pick<SandboxSession, "run">,
  command: string,
  timeoutMs = SANDBOX_COMMAND_TIMEOUT_MS,
): ReturnType<SandboxSession["run"]> {
  return sandbox.run({
    command,
    abortSignal: AbortSignal.timeout(timeoutMs),
  });
}

function baselineAllowMap(policy: SandboxNetworkPolicy): NetworkAllowMap {
  if (typeof policy === "string") return {};
  if (Array.isArray(policy.allow)) {
    return Object.fromEntries(policy.allow.map((host) => [host, []]));
  }
  return policy.allow ?? {};
}

async function closeSandboxEgress(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
  baseline: SandboxNetworkPolicy,
): Promise<void> {
  try {
    await sandbox.setNetworkPolicy(baseline);
    return;
  } catch {
    try {
      await sandbox.setNetworkPolicy(baseline);
      return;
    } catch {
      throw new EgressNotClosedError();
    }
  }
}

function assertPreflightSucceeded(result: SandboxCommandResult): void {
  if (result.exitCode === 0) return;
  const reason = result.stdout.trim();
  const messages: Readonly<Record<string, string>> = {
    DIRTY: "The session checkout has uncommitted or untracked files.",
    STALE: "The session checkout is stale after a prior refresh failure.",
    WRONG_BRANCH: "The session checkout is not on the configured main branch.",
    WRONG_HEAD: "The session checkout no longer matches the approved base commit.",
  };
  throw new Error(
    messages[reason] ??
      "A requested path traverses a symbolic link. Start a fresh Slack thread.",
  );
}

function assertSucceeded(label: string, result: SandboxCommandResult): void {
  if (result.exitCode === 0) return;
  throw new Error(`${label} failed. Start a fresh Slack thread after checking the deployment configuration.`);
}
