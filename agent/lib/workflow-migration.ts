import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

import type { ConnectedWorkspaceConfiguration } from "./config.ts";
import { EgressNotClosedError, closeSandboxEgress } from "./workspace-checkout.ts";
import type { WorkspaceMutation } from "./workspace-paths.ts";

const MIGRATION_PATTERN = /^workflows\/drizzle\/[^/]+\.sql$/;
const COMMAND_TIMEOUT_MS = 2 * 60 * 1_000;

/**
 * A migration-step failure. The message is safe to surface verbatim because
 * it states exactly whether the database changed and that no commit ran.
 */
export class WorkflowMigrationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowMigrationError";
  }
}

/**
 * Applies the accepted `workflows/drizzle/*.sql` additions to the workspace
 * database. Dependencies install on the session baseline; the write token is
 * brokered only around `db:migrate` and withdrawn before returning. Resolves
 * `true` when migrations ran, `false` when the mutation carries none.
 */
export async function applyAcceptedWorkflowMigrations({
  baselinePolicy,
  mutation,
  sandbox,
  workspace,
  writePolicy,
}: {
  readonly baselinePolicy: SandboxNetworkPolicy;
  readonly mutation: WorkspaceMutation;
  readonly sandbox: Pick<
    SandboxSession,
    "removePath" | "run" | "setNetworkPolicy" | "writeTextFile"
  >;
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly writePolicy: SandboxNetworkPolicy;
}): Promise<boolean> {
  const migrations = mutation.additions
    .map((entry) => entry.path)
    .filter((path) => MIGRATION_PATTERN.test(path));
  if (migrations.length === 0) return false;

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
npm ci --include=dev --ignore-scripts --no-audit --no-fund`,
      "Workflow migration dependency installation",
    );

    await sandbox.setNetworkPolicy(writePolicy);
    let migrated = false;
    try {
      await run(
        sandbox,
        `set -euo pipefail
cd "${stageWorkflow}"
npm run db:migrate`,
        "Accepted workflow migration",
      );
      migrated = true;
    } finally {
      try {
        await closeSandboxEgress(sandbox, baselinePolicy);
      } catch (error) {
        if (error instanceof EgressNotClosedError) {
          throw new WorkflowMigrationError(
            `Sandbox egress could not be restored after the migration step${
              migrated
                ? `; ${describe(migrations)} already applied to the workspace database`
                : ""
            }. No Git commit was attempted. End this session immediately and inspect the workspace database before any retry.`,
          );
        }
        throw error;
      }
    }
  } finally {
    await sandbox.removePath({ path: stageRoot, force: true, recursive: true });
  }
  return true;
}

function describe(migrations: readonly string[]): string {
  return `${migrations.length === 1 ? "migration" : "migrations"} ${migrations.join(", ")}`;
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
    throw new WorkflowMigrationError(
      `${label} failed. No Git commit was attempted and the checkout is unchanged.`,
    );
  }
}
