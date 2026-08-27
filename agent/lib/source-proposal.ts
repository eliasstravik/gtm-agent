import { createHash } from "node:crypto";

import type { SandboxSession } from "eve/sandbox";

import type { SourceProposalConfiguration } from "./config.ts";
import {
  MAX_SOURCE_DIFF_BYTES,
  MAX_SOURCE_PATHS,
  MAX_SOURCE_TOTAL_BYTES,
  assertSourceDeletion,
  assertSourceWrite,
  classifySourcePath,
  sourceAbsolutePath,
} from "./source-paths.ts";

const COMMAND_TIMEOUT_MS = 30_000;

export type CapturedSourceChange =
  | { readonly operation: "delete"; readonly path: string }
  | { readonly content: string; readonly operation: "write"; readonly path: string };

export type CapturedSourceProposal = {
  readonly baseSha: string;
  readonly changes: readonly CapturedSourceChange[];
  readonly diff: string;
  readonly hash: string;
  readonly paths: readonly string[];
};

type SourceSandbox = Pick<SandboxSession, "readTextFile" | "run">;

export async function captureSourceProposal(
  sandbox: SourceSandbox,
  source: SourceProposalConfiguration,
): Promise<CapturedSourceProposal> {
  const statusResult = await sandbox.run({
    command: createStatusCommand(source),
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  assertCommandSucceeded("Eve source proposal preflight", statusResult);

  const statuses = parseSourceStatus(statusResult.stdout);
  if (statuses.length === 0) {
    throw new Error("No Eve source changes are ready to preview.");
  }
  if (statuses.length > MAX_SOURCE_PATHS) {
    throw new Error(`An Eve source proposal may change at most ${MAX_SOURCE_PATHS} paths.`);
  }

  const changes: CapturedSourceChange[] = [];
  let totalBytes = 0;
  for (const status of statuses) {
    classifySourcePath(status.path);
    if (status.operation === "delete") {
      assertSourceDeletion(status.path);
      changes.push(status);
      continue;
    }

    const content = await sandbox.readTextFile({
      path: sourceAbsolutePath(source.checkoutDirectory, status.path),
    });
    if (content === null) {
      throw new Error(`Changed Eve source file ${JSON.stringify(status.path)} disappeared.`);
    }
    assertSourceWrite(status.path, content);
    totalBytes += Buffer.byteLength(content, "utf8");
    changes.push({ ...status, content });
  }
  if (totalBytes > MAX_SOURCE_TOTAL_BYTES) {
    throw new Error(
      `Combined Eve source content exceeds ${MAX_SOURCE_TOTAL_BYTES} UTF-8 bytes. Split the request into smaller proposals.`,
    );
  }

  const diffResult = await sandbox.run({
    command: createDiffCommand(source),
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  assertCommandSucceeded("Eve source diff capture", diffResult);
  const diff = diffResult.stdout;
  if (diff.length === 0) {
    throw new Error("The Eve source diff was empty after capturing changed paths.");
  }
  if (Buffer.byteLength(diff, "utf8") > MAX_SOURCE_DIFF_BYTES) {
    throw new Error(
      `The exact Eve source diff exceeds ${MAX_SOURCE_DIFF_BYTES} UTF-8 bytes. Split the request so Slack can show the complete proposal.`,
    );
  }

  const canonical = JSON.stringify({ baseSha: source.deployedSha, changes });
  return {
    baseSha: source.deployedSha,
    changes,
    diff,
    hash: createHash("sha256").update(canonical).digest("hex"),
    paths: changes.map((change) => change.path),
  };
}

export function parseSourceStatus(
  output: string,
): readonly (
  | { readonly operation: "delete"; readonly path: string }
  | { readonly operation: "write"; readonly path: string }
)[] {
  if (output.trim().length === 0) return [];
  return output
    .trimEnd()
    .split("\n")
    .map((line) => {
      if (line.length < 4 || line[2] !== " ") {
        throw new Error("Eve source checkout returned an unsupported Git status entry.");
      }
      const status = line.slice(0, 2);
      const path = line.slice(3);
      if (status === " M" || status === "??") {
        return { operation: "write" as const, path };
      }
      if (status === " D") {
        return { operation: "delete" as const, path };
      }
      throw new Error(
        `Eve source path ${JSON.stringify(path)} has unsupported status ${JSON.stringify(status)}. Start a fresh source-editing session.`,
      );
    });
}

function createStatusCommand(source: SourceProposalConfiguration): string {
  return `set -euo pipefail
repo_dir="${source.checkoutDirectory}"
test "$(git -C "$repo_dir" branch --show-current)" = "${source.branch}"
test "$(git -C "$repo_dir" rev-parse HEAD)" = "${source.deployedSha}"
test -z "$(git -C "$repo_dir" remote)"
git -C "$repo_dir" reset --quiet --mixed HEAD
git -C "$repo_dir" status --porcelain=v1 --untracked-files=all`;
}

function createDiffCommand(source: SourceProposalConfiguration): string {
  return `set -euo pipefail
repo_dir="${source.checkoutDirectory}"
cleanup() { git -C "$repo_dir" reset --quiet --mixed HEAD; }
trap cleanup EXIT
git -C "$repo_dir" reset --quiet --mixed HEAD
git -C "$repo_dir" add -A -- agent/instructions.md agent/schedules
git -C "$repo_dir" diff --cached --check
git -C "$repo_dir" diff --cached --no-ext-diff --no-color --full-index --binary HEAD -- agent/instructions.md agent/schedules`;
}

function assertCommandSucceeded(
  label: string,
  result: { readonly exitCode: number; readonly stderr: string; readonly stdout: string },
): void {
  if (result.exitCode === 0) return;
  throw new Error(`${label} failed inside the isolated sandbox.`);
}
