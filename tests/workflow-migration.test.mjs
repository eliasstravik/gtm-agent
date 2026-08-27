import assert from "node:assert/strict";
import test from "node:test";

import { applyAcceptedWorkflowMigrations } from "../agent/lib/workflow-migration.ts";

const HEAD = "a".repeat(40);
const workspace = {
  branch: "main",
  checkoutDirectory: "$HOME/.gtm/acme",
  connector: "github/acme",
  owner: "acme",
  repo: "workspace",
  repository: "acme/workspace",
  staleMarker: "$HOME/.gtm/.acme.stale",
};

function mutation(additions) {
  return {
    expectedHead: HEAD,
    message: "Update workflow",
    summary: "Update workflow",
    manifest: additions.map(({ path }) => ({ path, operation: "write" })),
    additions,
    deletions: [],
  };
}

test("accepted SQL is staged and migrated before commit", async () => {
  const commands = [];
  const writes = [];
  const removals = [];
  const sandbox = {
    async run({ command }) {
      commands.push(command);
      return { exitCode: 0, stdout: "", stderr: "" };
    },
    async writeTextFile(file) {
      writes.push(file);
    },
    async removePath(path) {
      removals.push(path);
    },
  };

  await applyAcceptedWorkflowMigrations({
    mutation: mutation([
      { path: "workflows/drizzle/0002_accounts.sql", content: "alter table accounts add score integer;\n" },
      { path: "workflows/package.json", content: "{}\n" },
    ]),
    sandbox,
    workspace,
  });

  assert.equal(commands.length, 2);
  assert.match(commands[0], /git.*archive/);
  assert.match(commands[1], /npm run db:migrate/);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(({ path }) => path.startsWith("/workspace/.gtm-migration-")));
  assert.equal(removals.length, 2);
  assert.equal(removals.at(-1).recursive, true);
});

test("a workflow change without migration SQL does not touch the sandbox", async () => {
  let touched = false;
  await applyAcceptedWorkflowMigrations({
    mutation: mutation([
      { path: "workflows/workflows/proof.ts", content: "export const proof = true;\n" },
    ]),
    sandbox: {
      async run() {
        touched = true;
      },
      async writeTextFile() {
        touched = true;
      },
      async removePath() {
        touched = true;
      },
    },
    workspace,
  });
  assert.equal(touched, false);
});
