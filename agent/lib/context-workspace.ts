import type {
  SandboxCommandResult,
  SandboxNetworkPolicy,
  SandboxSession,
  SandboxSessionUseFn,
} from "eve/sandbox";

import {
  CONTEXT_BRANCH,
  type ConnectedContextConfiguration,
} from "./config.ts";

type VercelSessionUse = SandboxSessionUseFn<{
  readonly networkPolicy?: SandboxNetworkPolicy;
}>;

const SANDBOX_COMMAND_TIMEOUT_MS = 30_000;

export type ContextWorkspaceMetadata = {
  readonly branch: typeof CONTEXT_BRANCH;
  readonly checkoutDirectory: string;
  readonly head: string;
  readonly repository: string;
};

export class EgressNotClosedError extends Error {
  constructor() {
    super(
      "Sandbox egress could not be restored to deny-all. End this session immediately.",
    );
    this.name = "EgressNotClosedError";
  }
}

export function createGitBasicAuthorization(token: string): string {
  return `Basic ${Buffer.from(`x-access-token:${token}`).toString("base64")}`;
}

export function createGitNetworkPolicy(
  context: ConnectedContextConfiguration,
  authorization: string,
): SandboxNetworkPolicy {
  return {
    allow: {
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: `/${context.owner}/${context.repo}.git/info/refs` },
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
              exact: `/${context.owner}/${context.repo}.git/git-upload-pack`,
            },
          },
          transform: [{ headers: { authorization } }],
        },
      ],
    },
  };
}

export async function hydrateContextWorkspace({
  authorization,
  context,
  use,
}: {
  readonly authorization: string;
  readonly context: ConnectedContextConfiguration;
  readonly use: VercelSessionUse;
}): Promise<ContextWorkspaceMetadata> {
  const sandbox = await use({
    networkPolicy: createGitNetworkPolicy(context, authorization),
  });

  try {
    await runCredentialFree(
      sandbox,
      createCloneCommand(context),
      "GTM context checkout",
    );
  } finally {
    await closeSandboxEgress(sandbox);
  }

  const head = await verifyContextWorkspace(sandbox, context);
  return {
    branch: context.branch,
    checkoutDirectory: context.checkoutDirectory,
    head,
    repository: context.repository,
  };
}

export async function verifyContextWorkspace(
  sandbox: Pick<SandboxSession, "run">,
  context: ConnectedContextConfiguration,
  expectedHead?: string,
): Promise<string> {
  const result = await runSandboxCommand(
    sandbox,
    createVerificationCommand(context, expectedHead),
  );
  assertSucceeded("GTM context verification", result);

  const head = result.stdout.trim();
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head)) {
    throw new Error("GTM context verification returned an invalid HEAD.");
  }
  return head;
}

export async function assertContextWorkspaceReady({
  context,
  expectedHead,
  paths,
  sandbox,
}: {
  readonly context: ConnectedContextConfiguration;
  readonly expectedHead: string;
  readonly paths: readonly string[];
  readonly sandbox: Pick<SandboxSession, "run">;
}): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    createMutationPreflightCommand(context, expectedHead, paths),
  );
  assertPreflightSucceeded(result);
}

export async function refreshContextWorkspace({
  authorization,
  commitSha,
  context,
  sandbox,
}: {
  readonly authorization: string;
  readonly commitSha: string;
  readonly context: ConnectedContextConfiguration;
  readonly sandbox: Pick<SandboxSession, "run" | "setNetworkPolicy">;
}): Promise<void> {
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(commitSha)) {
    throw new Error("Refusing to refresh to an invalid Git object ID.");
  }
  await sandbox.setNetworkPolicy(createGitNetworkPolicy(context, authorization));
  try {
    await runCredentialFree(
      sandbox,
      createRefreshCommand(context, commitSha),
      "GTM context refresh",
    );
  } finally {
    await closeSandboxEgress(sandbox);
  }

  const head = await verifyContextWorkspace(sandbox, context, commitSha);
  if (head !== commitSha) {
    throw new Error("GTM context refresh did not reach the durable commit.");
  }
}

export async function markContextWorkspaceStale(
  sandbox: Pick<SandboxSession, "run">,
  context: ConnectedContextConfiguration,
): Promise<void> {
  const result = await runSandboxCommand(
    sandbox,
    `set -euo pipefail\numask 077\nmkdir -p "$HOME/.gtm"\n: > "${context.staleMarker}"`,
  );
  assertSucceeded("GTM context stale marker", result);
}

function createCloneCommand(context: ConnectedContextConfiguration): string {
  return `set -euo pipefail
repo_dir="${context.checkoutDirectory}"
mkdir -p "$HOME/.gtm"
mkdir "$repo_dir"
git clone --depth=1 --single-branch --branch "${context.branch}" --no-tags \\
  "https://github.com/${context.repository}.git" "$repo_dir"
git -C "$repo_dir" remote remove origin`;
}

function createRefreshCommand(
  context: ConnectedContextConfiguration,
  commitSha: string,
): string {
  return `set -euo pipefail
repo_dir="${context.checkoutDirectory}"
git -C "$repo_dir" fetch --depth=1 --no-tags \\
  "https://github.com/${context.repository}.git" "${commitSha}"
test "$(git -C "$repo_dir" rev-parse FETCH_HEAD)" = "${commitSha}"
git -C "$repo_dir" reset --hard "${commitSha}"`;
}

function createVerificationCommand(
  context: ConnectedContextConfiguration,
  expectedHead?: string,
): string {
  return `set -euo pipefail
repo_dir="${context.checkoutDirectory}"
test -f "$repo_dir/org.md"
test ! -L "$repo_dir/org.md"
test "$(git -C "$repo_dir" branch --show-current)" = "${context.branch}"
test -z "$(git -C "$repo_dir" status --porcelain)"
test -z "$(git -C "$repo_dir" remote)"
test ! -e "${context.staleMarker}"
if git -C "$repo_dir" ls-files --stage | awk '$1 == "120000" || $1 == "160000" { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "Unsupported symlink or gitlink in GTM context checkout" >&2
  exit 1
fi
for variable in GITHUB_TOKEN GH_TOKEN VERCEL_OIDC_TOKEN VERCEL_AUTH_TOKEN CONNECT_TOKEN; do
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
  context: ConnectedContextConfiguration,
  expectedHead: string,
  paths: readonly string[],
): string {
  const symlinkChecks = paths
    .flatMap((path) => pathPrefixes(path))
    .filter((path, index, all) => all.indexOf(path) === index)
    .map((path) => `test ! -L "$repo_dir/${path}"`)
    .join("\n");

  return `set -euo pipefail
repo_dir="${context.checkoutDirectory}"
fail() { printf '%s\n' "$1"; exit 1; }
test ! -e "${context.staleMarker}" || fail STALE
test -z "$(git -C "$repo_dir" status --porcelain)" || fail DIRTY
test "$(git -C "$repo_dir" branch --show-current)" = "${context.branch}" || fail WRONG_BRANCH
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
): Promise<void> {
  const result = await runSandboxCommand(sandbox, command);
  assertSucceeded(label, result);
}

function runSandboxCommand(
  sandbox: Pick<SandboxSession, "run">,
  command: string,
): ReturnType<SandboxSession["run"]> {
  return sandbox.run({
    command,
    abortSignal: AbortSignal.timeout(SANDBOX_COMMAND_TIMEOUT_MS),
  });
}

async function closeSandboxEgress(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
): Promise<void> {
  try {
    await sandbox.setNetworkPolicy("deny-all");
    return;
  } catch {
    try {
      await sandbox.setNetworkPolicy("deny-all");
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
