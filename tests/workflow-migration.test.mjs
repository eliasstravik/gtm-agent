import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkflowMigrationError,
  applyAcceptedWorkflowMigrations,
} from "../agent/lib/workflow-migration.ts";

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
const baselinePolicy = { allow: { "acme.turso.io": [{ transform: [{ headers: { authorization: "Bearer read-only" } }] }] } };
const writePolicy = { allow: { "acme.turso.io": [{ transform: [{ headers: { authorization: "Bearer write" } }] }] } };

function mutation(additions) {
  return {
    expectedHead: HEAD,
    message: "Update workflow",
    summary: "Update workflow",
    manifest: additions.map(({ path }) => ({ path, operation: "write" })),
    additions,
    deletions: [],
    migrations: additions
      .map(({ path }) => path)
      .filter((path) => /^workflows\/drizzle\/[^/]+\.sql$/.test(path)),
    destructive: false,
  };
}

function fakeSandbox(handler = () => ({ exitCode: 0, stdout: "", stderr: "" })) {
  const events = [];
  return {
    events,
    sandbox: {
      async run({ command }) {
        events.push(["run", command]);
        return handler(command);
      },
      async writeTextFile(file) {
        events.push(["write", file.path]);
      },
      async removePath(path) {
        events.push(["remove", path.path]);
      },
      async setNetworkPolicy(policy) {
        events.push(["policy", policy]);
      },
    },
  };
}

test("accepted SQL is staged, installed on the baseline, and migrated only inside the write window", async () => {
  const { events, sandbox } = fakeSandbox();

  const applied = await applyAcceptedWorkflowMigrations({
    baselinePolicy,
    mutation: mutation([
      { path: "workflows/drizzle/0002_accounts.sql", content: "alter table accounts add score integer;\n" },
      { path: "workflows/package.json", content: "{}\n" },
    ]),
    sandbox,
    workspace,
    writePolicy,
  });

  assert.equal(applied, true);
  const runs = events.filter(([kind]) => kind === "run").map(([, command]) => command);
  assert.equal(runs.length, 4);
  assert.match(runs[0], /git.*archive/);
  assert.match(runs[1], /npm ci/);
  assert.doesNotMatch(runs[1], /db:migrate/);
  assert.match(runs[2], /npm run db:migrate/);
  assert.match(runs[3], /verify-migrations/);
  const order = events.map(([kind, value]) =>
    kind === "policy" ? `policy:${value === writePolicy ? "write" : "baseline"}` : kind === "run" && /db:migrate/.test(value) ? "migrate" : kind,
  );
  assert.deepEqual(
    order.filter((item) => item.startsWith("policy") || item === "migrate"),
    ["policy:write", "migrate", "policy:baseline"],
  );
  assert.ok(events.filter(([kind]) => kind === "write").every(([, path]) => path.startsWith("/workspace/.gtm-migration-")));
});

test("the write window closes even when the migration fails, and the failure says no commit was attempted", async () => {
  const { events, sandbox } = fakeSandbox((command) =>
    /db:migrate/.test(command)
      ? { exitCode: 1, stdout: "", stderr: "boom" }
      : { exitCode: 0, stdout: "", stderr: "" },
  );
  await assert.rejects(
    applyAcceptedWorkflowMigrations({
      baselinePolicy,
      mutation: mutation([
        { path: "workflows/drizzle/0002_accounts.sql", content: "alter table accounts add score integer;\n" },
      ]),
      sandbox,
      workspace,
      writePolicy,
    }),
    (error) => {
      assert.ok(error instanceof WorkflowMigrationError);
      assert.match(error.message, /No Git commit was attempted/);
      return true;
    },
  );
  const policies = events.filter(([kind]) => kind === "policy").map(([, value]) => value);
  assert.deepEqual(policies, [writePolicy, baselinePolicy]);
});

test("a successful migration command is rejected when the declared hash is absent from the ledger", async () => {
  const { events, sandbox } = fakeSandbox((command) =>
    /verify-migrations/.test(command)
      ? { exitCode: 1, stdout: "", stderr: "Declared migration hashes are missing from the ledger." }
      : { exitCode: 0, stdout: "", stderr: "" },
  );

  await assert.rejects(
    applyAcceptedWorkflowMigrations({
      baselinePolicy,
      mutation: mutation([
        { path: "workflows/drizzle/0002_accounts.sql", content: "alter table accounts add score integer;\n" },
      ]),
      sandbox,
      workspace,
      writePolicy,
    }),
    (error) => {
      assert.ok(error instanceof WorkflowMigrationError);
      assert.match(error.message, /ledger verification failed/i);
      assert.match(error.message, /No Git commit was attempted/);
      return true;
    },
  );

  const runs = events.filter(([kind]) => kind === "run").map(([, command]) => command);
  assert.ok(runs.some((command) => /verify-migrations/.test(command)));
  const policies = events.filter(([kind]) => kind === "policy").map(([, value]) => value);
  assert.deepEqual(policies, [writePolicy, baselinePolicy]);
});

test("a baseline restore failure after migration is terminal and never looks like success", async () => {
  let restores = 0;
  const { sandbox } = fakeSandbox();
  sandbox.setNetworkPolicy = async (policy) => {
    if (policy === baselinePolicy) {
      restores += 1;
      throw new Error("firewall unavailable");
    }
  };
  await assert.rejects(
    applyAcceptedWorkflowMigrations({
      baselinePolicy,
      mutation: mutation([
        { path: "workflows/drizzle/0002_accounts.sql", content: "alter table accounts add score integer;\n" },
      ]),
      sandbox,
      workspace,
      writePolicy,
    }),
    (error) => {
      assert.ok(error instanceof WorkflowMigrationError);
      assert.match(error.message, /egress could not be restored/i);
      assert.match(error.message, /migration command completed/i);
      return true;
    },
  );
  assert.equal(restores, 2);
});

test("a workflow change without migration SQL does not touch the sandbox", async () => {
  const { events, sandbox } = fakeSandbox();
  const applied = await applyAcceptedWorkflowMigrations({
    baselinePolicy,
    mutation: mutation([
      { path: "workflows/workflows/proof.ts", content: "export const proof = true;\n" },
    ]),
    sandbox,
    workspace,
    writePolicy,
  });
  assert.equal(applied, false);
  assert.deepEqual(events, []);
});
