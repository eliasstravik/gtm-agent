import { createHash } from "node:crypto";

import type { SandboxNetworkPolicy, SandboxSession } from "eve/sandbox";

import type { ConnectedWorkspaceConfiguration } from "./config.ts";
import {
  EgressNotClosedError,
  closeSandboxEgress,
  type StoppableSandbox,
} from "./workspace-checkout.ts";
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
 * brokered only around `db:migrate` and ledger verification, then withdrawn
 * before returning. Resolves `true` only when every accepted SQL hash is in
 * the ledger, or `false` when the mutation carries no migration.
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
    "removePath" | "run" | "writeTextFile"
  > &
    StoppableSandbox;
  readonly workspace: ConnectedWorkspaceConfiguration;
  readonly writePolicy: SandboxNetworkPolicy;
}): Promise<boolean> {
  const migrationEntries = mutation.additions.filter((entry) =>
    MIGRATION_PATTERN.test(entry.path),
  );
  const migrations = migrationEntries.map((entry) => entry.path);
  if (migrations.length === 0) return false;
  const migrationHashes = migrationEntries.map((entry) =>
    createHash("sha256").update(entry.content).digest("hex"),
  );

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
    await sandbox.writeTextFile({
      path: `${stageWorkflow}/.gtm-verify-migrations.mjs`,
      content: ledgerVerificationScript(migrationHashes),
    });

    await sandbox.setNetworkPolicy(writePolicy);
    let migrationCommandCompleted = false;
    try {
      await run(
        sandbox,
        `set -euo pipefail
cd "${stageWorkflow}"
npm run db:migrate`,
        "Accepted workflow migration",
      );
      migrationCommandCompleted = true;
      try {
        await run(
          sandbox,
          `set -euo pipefail
cd "${stageWorkflow}"
node .gtm-verify-migrations.mjs`,
          "Workflow migration ledger verification",
        );
      } catch (error) {
        if (error instanceof WorkflowMigrationError) {
          throw new WorkflowMigrationError(
            "Workflow migration ledger verification failed after db:migrate completed; the database may have changed. No Git commit was attempted and the checkout is unchanged.",
          );
        }
        throw error;
      }
    } finally {
      try {
        await closeSandboxEgress(sandbox, baselinePolicy);
      } catch (error) {
        if (error instanceof EgressNotClosedError) {
          throw new WorkflowMigrationError(
            `Sandbox egress could not be restored after the migration step${
              migrationCommandCompleted
                ? `; the migration command completed for ${describe(migrations)}, so the database state must be inspected`
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

function ledgerVerificationScript(hashes: readonly string[]): string {
  return `import { createClient } from "@libsql/client";

const expected = new Set(${JSON.stringify(hashes)});
const client = createClient({ url: process.env.TURSO_DATABASE_URL });
try {
  const result = await client.execute("SELECT hash FROM __drizzle_migrations");
  for (const row of result.rows) expected.delete(String(row.hash));
  if (expected.size > 0) {
    process.stderr.write("Declared migration hashes are missing from the ledger.\\n");
    process.exitCode = 1;
  }
} finally {
  client.close();
}
`;
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
