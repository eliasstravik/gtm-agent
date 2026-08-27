import type { SandboxSession } from "eve/sandbox";

import type { ConnectedWorkspaceConfiguration } from "./config.ts";
import type { WorkspaceMutation } from "./workspace-paths.ts";

const MIGRATION_PATTERN = /^workflows\/drizzle\/[^/]+\.sql$/;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;

export async function applyAcceptedWorkflowMigrations({
  mutation,
  sandbox,
  workspace,
}: {
  readonly mutation: WorkspaceMutation;
  readonly sandbox: Pick<SandboxSession, "removePath" | "run" | "writeTextFile">;
  readonly workspace: ConnectedWorkspaceConfiguration;
}): Promise<void> {
  if (!mutation.additions.some((entry) => MIGRATION_PATTERN.test(entry.path))) {
    return;
  }

  const stageRoot = `/workspace/.gtm-migration-${mutation.expectedHead}`;
  const stageWorkflow = `${stageRoot}/workflows`;
  await sandbox.removePath({ path: stageRoot, force: true, recursive: true });

  try {
    await run(
      sandbox,
      `set -euo pipefail
repo_dir="${workspace.checkoutDirectory}"
stage_root="${stageRoot}"
mkdir -p "$stage_root"
test -z "$(git -C "$repo_dir" ls-files -s -- workflows/ | awk '$1 == 120000 { print $4; exit }')"
git -C "$repo_dir" archive "${mutation.expectedHead}" workflows | tar -x -C "$stage_root"`,
      "Workflow migration staging",
    );

    for (const addition of mutation.additions) {
      if (!addition.path.startsWith("workflows/")) continue;
      await sandbox.writeTextFile({
        path: `${stageRoot}/${addition.path}`,
        content: addition.content,
      });
    }
    for (const deletion of mutation.deletions) {
      if (!deletion.path.startsWith("workflows/")) continue;
      await sandbox.removePath({
        path: `${stageRoot}/${deletion.path}`,
        force: true,
      });
    }

    await run(
      sandbox,
      `set -euo pipefail
cd "${stageWorkflow}"
npm ci --include=dev --ignore-scripts --no-audit --no-fund
npm run db:migrate`,
      "Accepted workflow migration",
    );
  } finally {
    await sandbox.removePath({ path: stageRoot, force: true, recursive: true });
  }
}

async function run(
  sandbox: Pick<SandboxSession, "run">,
  command: string,
  label: string,
): Promise<void> {
  const result = await sandbox.run({
    command,
    abortSignal: AbortSignal.timeout(COMMAND_TIMEOUT_MS),
  });
  if (result.exitCode !== 0) {
    throw new Error(`${label} failed. No Git commit was attempted.`);
  }
}
