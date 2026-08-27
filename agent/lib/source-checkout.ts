import type {
  SandboxCommandResult,
  SandboxNetworkPolicy,
  SandboxSession,
  SandboxSessionUseFn,
} from "eve/sandbox";

import type { SourceProposalConfiguration } from "./config.ts";

type VercelSessionUse = SandboxSessionUseFn<{
  readonly networkPolicy?: SandboxNetworkPolicy;
}>;

const COMMAND_TIMEOUT_MS = 30_000;
const FORBIDDEN_SOURCE_VARIABLES = [
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "VERCEL_OIDC_TOKEN",
  "VERCEL_AUTH_TOKEN",
  "CONNECT_TOKEN",
  "TURSO_AUTH_TOKEN",
  "TURSO_READ_ONLY_AUTH_TOKEN",
  "GTM_WORKFLOW_RUN_SECRET",
] as const;

type ClosedNetworkPolicy = Exclude<SandboxNetworkPolicy, string>;

export type SourceCheckoutMetadata = {
  readonly branch: "main";
  readonly checkoutDirectory: string;
  readonly head: string;
  readonly repository: string;
};

export function createSourceGitNetworkPolicy(
  source: SourceProposalConfiguration,
  authorization: string,
): ClosedNetworkPolicy {
  return {
    allow: {
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: `/${source.owner}/${source.repo}.git/info/refs` },
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
              exact: `/${source.owner}/${source.repo}.git/git-upload-pack`,
            },
          },
          transform: [{ headers: { authorization } }],
        },
      ],
    },
  };
}

export async function hydrateSourceCheckout({
  authorization,
  source,
  use,
}: {
  readonly authorization: string;
  readonly source: SourceProposalConfiguration;
  readonly use: VercelSessionUse;
}): Promise<SourceCheckoutMetadata> {
  const sandbox = await use({
    networkPolicy: createSourceGitNetworkPolicy(source, authorization),
  });

  try {
    await runCredentialFree(sandbox, createCloneCommand(source), "Eve source checkout");
  } finally {
    await closeEgress(sandbox);
  }

  const head = await verifySourceCheckout(sandbox, source);
  return {
    branch: source.branch,
    checkoutDirectory: source.checkoutDirectory,
    head,
    repository: source.repository,
  };
}

export async function verifySourceCheckout(
  sandbox: Pick<SandboxSession, "run">,
  source: SourceProposalConfiguration,
): Promise<string> {
  const result = await sandbox.run({
    command: createVerificationCommand(source),
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  assertSucceeded("Eve source verification", result);
  const head = result.stdout.trim();
  if (head !== source.deployedSha) {
    throw new Error("Eve source verification returned the wrong deployed revision.");
  }
  return head;
}

function createCloneCommand(source: SourceProposalConfiguration): string {
  return `set -euo pipefail
repo_dir="${source.checkoutDirectory}"
mkdir -p "$(dirname "$repo_dir")"
mkdir "$repo_dir"
git clone --depth=1 --single-branch --branch "${source.branch}" --no-tags \\
  "https://github.com/${source.repository}.git" "$repo_dir"
git -C "$repo_dir" remote remove origin
mkdir -p "$repo_dir/agent/schedules"`;
}

function createVerificationCommand(source: SourceProposalConfiguration): string {
  return `set -euo pipefail
repo_dir="${source.checkoutDirectory}"
test -f "$repo_dir/agent/agent.ts"
test ! -L "$repo_dir/agent"
test ! -L "$repo_dir/agent/agent.ts"
test "$(git -C "$repo_dir" branch --show-current)" = "${source.branch}"
test "$(git -C "$repo_dir" rev-parse HEAD)" = "${source.deployedSha}"
test -z "$(git -C "$repo_dir" status --porcelain)"
test -z "$(git -C "$repo_dir" remote)"
if git -C "$repo_dir" ls-files --stage | awk '$1 == "120000" || $1 == "160000" { found = 1 } END { exit found ? 0 : 1 }'; then
  echo "Unsupported symlink or gitlink in Eve source checkout" >&2
  exit 1
fi
for variable in ${FORBIDDEN_SOURCE_VARIABLES.join(" ")}; do
  if printenv "$variable" >/dev/null 2>&1; then
    echo "Unexpected credential variable: $variable" >&2
    exit 1
  fi
done
if git -C "$repo_dir" config --local --get-regexp '(^credential\\.|^http\\..*\\.extraheader$)' >/dev/null 2>&1; then
  echo "Unexpected Git credential configuration" >&2
  exit 1
fi
git -C "$repo_dir" rev-parse HEAD`;
}

async function runCredentialFree(
  sandbox: Pick<SandboxSession, "run">,
  command: string,
  label: string,
): Promise<void> {
  const result = await sandbox.run({
    command,
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  assertSucceeded(label, result);
}

async function closeEgress(
  sandbox: Pick<SandboxSession, "setNetworkPolicy">,
): Promise<void> {
  try {
    await sandbox.setNetworkPolicy("deny-all");
  } catch {
    try {
      await sandbox.setNetworkPolicy("deny-all");
    } catch {
      throw new Error(
        "Eve source sandbox egress could not be closed. End this source-editing session immediately.",
      );
    }
  }
}

function assertSucceeded(label: string, result: SandboxCommandResult): void {
  if (result.exitCode === 0) return;
  throw new Error(`${label} failed inside the isolated sandbox.`);
}
