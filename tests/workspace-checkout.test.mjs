import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertWorkspaceCheckoutReady,
  createGitBasicAuthorization,
  createGitNetworkPolicy,
  EgressNotClosedError,
  hydrateWorkspaceCheckout,
  refreshWorkspaceCheckout,
  verifyWorkspaceCheckout,
} from "../agent/lib/workspace-checkout.ts";

const workspace = {
  branch: "main",
  checkoutDirectory: "$HOME/.gtm/gtm-workspace",
  connector: "github/gtm-agent",
  owner: "acme-inc",
  repo: "gtm-workspace",
  repository: "acme-inc/gtm-workspace",
  staleMarker: "$HOME/.gtm/.gtm-workspace.stale",
};

test("Git policy injects auth only for the exact repository smart-HTTP path", () => {
  assert.equal(
    createGitBasicAuthorization("secret"),
    `Basic ${Buffer.from("x-access-token:secret").toString("base64")}`,
  );
  assert.deepEqual(createGitNetworkPolicy(workspace, "Basic secret"), {
    allow: {
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: "/acme-inc/gtm-workspace.git/info/refs" },
            queryString: [
              {
                key: { exact: "service" },
                value: { exact: "git-upload-pack" },
              },
            ],
          },
          transform: [{ headers: { authorization: "Basic secret" } }],
        },
        {
          match: {
            method: ["POST"],
            path: { exact: "/acme-inc/gtm-workspace.git/git-upload-pack" },
          },
          transform: [{ headers: { authorization: "Basic secret" } }],
        },
      ],
    },
  });
});

test("hydration clones main without credentials and restores deny-all", async () => {
  const events = [];
  const commands = [];
  const abortSignals = [];
  const sandbox = {
    async run({ abortSignal, command }) {
      commands.push(command);
      abortSignals.push(abortSignal);
      events.push("run");
      return commands.length === 1
        ? { exitCode: 0, stderr: "", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: `${"b".repeat(40)}\n` };
    },
    async setNetworkPolicy(policy) {
      events.push(`policy:${policy}`);
    },
  };

  const result = await hydrateWorkspaceCheckout({
    authorization: "Basic secret",
    workspace,
    async use(options) {
      events.push("use");
      assert.deepEqual(options.networkPolicy, createGitNetworkPolicy(workspace, "Basic secret"));
      return sandbox;
    },
  });

  assert.deepEqual(events, ["use", "run", "policy:deny-all", "run"]);
  assert.deepEqual(result, {
    branch: "main",
    checkoutDirectory: "$HOME/.gtm/gtm-workspace",
    head: "b".repeat(40),
    repository: "acme-inc/gtm-workspace",
  });
  assert.match(commands[0], /--depth=1/);
  assert.match(commands[0], /--single-branch/);
  assert.match(commands[0], /--branch "main"/);
  assert.match(commands[0], /mkdir "\$repo_dir"/);
  assert.match(commands[0], /remote remove origin/);
  assert.equal(commands.some((command) => command.includes("Basic secret")), false);
  assert.doesNotMatch(commands[1], /ORG\.md|org\.md/);
  assert.match(commands[1], /Unexpected credential variable/);
  assert.match(commands[1], /Unexpected Git credential configuration/);
  assert.match(commands[1], /120000/);
  assert.match(commands[1], /160000/);
  assert.equal(abortSignals.every((signal) => signal instanceof AbortSignal), true);
});

test("workflow-hosted hydration installs locked runtime dependencies before returning", async () => {
  const commands = [];
  const sandbox = {
    async run({ command }) {
      commands.push(command);
      return commands.length === 2
        ? { exitCode: 0, stderr: "", stdout: `${"b".repeat(40)}\n` }
        : { exitCode: 0, stderr: "", stdout: "" };
    },
    async setNetworkPolicy() {},
  };

  await hydrateWorkspaceCheckout({
    authorization: "Basic secret",
    baselinePolicy: workflowBaseline,
    prepareWorkflowRuntime: true,
    workspace,
    async use() {
      return sandbox;
    },
  });

  assert.equal(commands.length, 3);
  assert.match(commands[2], /package-lock\.json/);
  assert.match(commands[2], /npm ci/);
  assert.match(commands[2], /--include=dev/);
  assert.match(commands[2], /--ignore-scripts/);
  assert.match(commands[2], /--no-audit/);
  assert.match(commands[2], /--no-fund/);
});

test("hydration fails closed and never includes authorization in errors", async () => {
  const policies = [];
  const sandbox = {
    async run() {
      return {
        exitCode: 1,
        stderr: "fatal: authentication failed Basic secret",
        stdout: "",
      };
    },
    async setNetworkPolicy(policy) {
      policies.push(policy);
    },
  };

  await assert.rejects(
    hydrateWorkspaceCheckout({
      authorization: "Basic secret",
      workspace,
      async use() {
        return sandbox;
      },
    }),
    (error) => {
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.message, /checkout failed/i);
      assert.match(error.message, /at least one commit/i);
      return true;
    },
  );
  assert.deepEqual(policies, ["deny-all"]);
});

test("refresh fetches and resets to the exact durable commit", async () => {
  const commands = [];
  const policies = [];
  const sandbox = {
    async run({ command }) {
      commands.push(command);
      return commands.length === 1
        ? { exitCode: 0, stderr: "", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: `${"c".repeat(40)}\n` };
    },
    async setNetworkPolicy(policy) {
      policies.push(policy);
    },
  };

  await refreshWorkspaceCheckout({
    authorization: "Basic secret",
    commitSha: "c".repeat(40),
    workspace,
    sandbox,
  });

  assert.deepEqual(policies, [createGitNetworkPolicy(workspace, "Basic secret"), "deny-all"]);
  assert.match(commands[0], new RegExp(`fetch[\\s\\S]+${"c".repeat(40)}`));
  assert.match(commands[0], new RegExp(`reset --hard "${"c".repeat(40)}"`));
  assert.equal(commands.some((command) => command.includes("Basic secret")), false);
});

test("refresh rejects an untrusted commit value before opening egress", async () => {
  const policies = [];
  await assert.rejects(
    refreshWorkspaceCheckout({
      authorization: "Basic secret",
      commitSha: 'main"; printenv',
      workspace,
      sandbox: {
        async run() {
          throw new Error("must not run");
        },
        async setNetworkPolicy(policy) {
          policies.push(policy);
        },
      },
    }),
    /invalid Git object ID/i,
  );
  assert.deepEqual(policies, []);
});

test("refresh failure still restores deny-all egress", async () => {
  const policies = [];
  await assert.rejects(
    refreshWorkspaceCheckout({
      authorization: "Basic secret",
      commitSha: "e".repeat(40),
      workspace,
      sandbox: {
        async run() {
          return { exitCode: 1, stderr: "Basic secret", stdout: "" };
        },
        async setNetworkPolicy(policy) {
          policies.push(policy);
        },
      },
    }),
    (error) => {
      assert.doesNotMatch(error.message, /secret/);
      return true;
    },
  );
  assert.deepEqual(policies, [createGitNetworkPolicy(workspace, "Basic secret"), "deny-all"]);
});

test("a repeated deny-all failure is surfaced as a terminal egress error", async () => {
  let attempts = 0;
  await assert.rejects(
    refreshWorkspaceCheckout({
      authorization: "Basic secret",
      commitSha: "e".repeat(40),
      workspace,
      sandbox: {
        async run() {
          return { exitCode: 0, stderr: "", stdout: "" };
        },
        async setNetworkPolicy(policy) {
          if (policy === "deny-all") {
            attempts += 1;
            throw new Error("control plane unavailable");
          }
        },
      },
    }),
    EgressNotClosedError,
  );
  assert.equal(attempts, 2);
});

test("mutation preflight rejects dirty, stale, wrong-head, and symlinked paths in one fail-closed check", async () => {
  let command = "";
  await assertWorkspaceCheckoutReady({
    workspace,
    expectedHead: "d".repeat(40),
    paths: ["suborgs/europe/personas/revenue-leader/PERSONA.md"],
    sandbox: {
      async run(input) {
        command = input.command;
        return { exitCode: 0, stderr: "", stdout: "" };
      },
    },
  });

  assert.match(command, /test ! -e .*stale/);
  assert.match(command, /status --porcelain/);
  assert.match(command, /branch --show-current/);
  assert.ok(
    command.includes(`rev-parse HEAD)" = "${"d".repeat(40)}"`),
    "preflight must compare the complete expected object ID",
  );
  for (const path of [
    "suborgs",
    "suborgs/europe",
    "suborgs/europe/personas",
    "suborgs/europe/personas/revenue-leader",
    "suborgs/europe/personas/revenue-leader/PERSONA.md",
  ]) {
    assert.match(command, new RegExp(`test ! -L "\\$repo_dir/${path}"`));
  }
});

test("real Git preflight and verification reject dirty, stale, wrong branch, wrong head, and tracked symlinks", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-workspace-checkout-"),
  );
  const repository = join(temporaryRoot, "repository");
  const fixtureWorkspace = {
    ...workspace,
    checkoutDirectory: repository,
    staleMarker: join(temporaryRoot, ".stale"),
  };
  let assertFirstCommandSuccess = true;
  const sandbox = {
    async run({ command }) {
      const result = spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        env: { HOME: temporaryRoot, PATH: process.env.PATH },
      });
      if (assertFirstCommandSuccess) {
        assertFirstCommandSuccess = false;
        assert.equal(
          result.status,
          0,
          `initial verification command failed: ${result.stderr || result.stdout}`,
        );
      }
      return {
        exitCode: result.status ?? 1,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
  };

  try {
    await mkdir(repository, { recursive: true });
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.email", "fixture@example.test"]);
    git(repository, ["config", "user.name", "Fixture"]);
    await writeFile(join(repository, "ORG.md"), "# Organization\n", "utf8");
    git(repository, ["add", "ORG.md"]);
    git(repository, ["commit", "-m", "fixture"]);
    const originalHead = git(repository, ["rev-parse", "HEAD"]);

    assert.equal(
      await verifyWorkspaceCheckout(sandbox, fixtureWorkspace, originalHead),
      originalHead,
    );

    await writeFile(join(repository, "draft.md"), "scratch\n", "utf8");
    await assert.rejects(
      assertWorkspaceCheckoutReady({
        workspace: fixtureWorkspace,
        expectedHead: originalHead,
        paths: ["ORG.md"],
        sandbox,
      }),
      /uncommitted or untracked/i,
    );
    await rm(join(repository, "draft.md"));

    await writeFile(fixtureWorkspace.staleMarker, "", "utf8");
    await assert.rejects(
      assertWorkspaceCheckoutReady({
        workspace: fixtureWorkspace,
        expectedHead: originalHead,
        paths: ["ORG.md"],
        sandbox,
      }),
      /stale/i,
    );
    await rm(fixtureWorkspace.staleMarker);

    git(repository, ["checkout", "-b", "other"]);
    await assert.rejects(
      assertWorkspaceCheckoutReady({
        workspace: fixtureWorkspace,
        expectedHead: originalHead,
        paths: ["ORG.md"],
        sandbox,
      }),
      /configured main branch/i,
    );
    git(repository, ["checkout", "main"]);

    await writeFile(join(repository, "icps.md"), "changed\n", "utf8");
    git(repository, ["add", "icps.md"]);
    git(repository, ["commit", "-m", "advance"]);
    await assert.rejects(
      assertWorkspaceCheckoutReady({
        workspace: fixtureWorkspace,
        expectedHead: originalHead,
        paths: ["ORG.md"],
        sandbox,
      }),
      /approved base commit/i,
    );

    git(repository, ["mv", "ORG.md", "org.md"]);
    git(repository, ["commit", "-m", "legacy root fixture"]);
    const legacyHead = git(repository, ["rev-parse", "HEAD"]);
    assert.equal(
      await verifyWorkspaceCheckout(sandbox, fixtureWorkspace, legacyHead),
      legacyHead,
    );

    await symlink("org.md", join(repository, "org-link.md"));
    git(repository, ["add", "org-link.md"]);
    git(repository, ["commit", "-m", "tracked symlink"]);
    await assert.rejects(
      verifyWorkspaceCheckout(
        sandbox,
        fixtureWorkspace,
        git(repository, ["rev-parse", "HEAD"]),
      ),
      /verification failed/i,
    );
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

test("real Git verification accepts a README-only checkout as not yet set up", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-workspace-unset-"),
  );
  const repository = join(temporaryRoot, "repository");
  const fixtureWorkspace = {
    ...workspace,
    checkoutDirectory: repository,
    staleMarker: join(temporaryRoot, ".stale"),
  };
  const sandbox = {
    async run({ command }) {
      const result = spawnSync("bash", ["-c", command], {
        encoding: "utf8",
        env: { HOME: temporaryRoot, PATH: process.env.PATH },
      });
      return {
        exitCode: result.status ?? 1,
        stderr: result.stderr,
        stdout: result.stdout,
      };
    },
  };

  try {
    await mkdir(repository, { recursive: true });
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.email", "fixture@example.test"]);
    git(repository, ["config", "user.name", "Fixture"]);
    await writeFile(join(repository, "README.md"), "# Workspace\n", "utf8");
    git(repository, ["add", "README.md"]);
    git(repository, ["commit", "-m", "Initial commit"]);
    const head = git(repository, ["rev-parse", "HEAD"]);

    assert.equal(await verifyWorkspaceCheckout(sandbox, fixtureWorkspace, head), head);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}

const workflowBaseline = {
  allow: {
    "registry.npmjs.org": [],
    "acme.turso.io": [
      { transform: [{ headers: { authorization: "Bearer turso-secret" } }] },
    ],
  },
};

test("Git policy merges the session baseline so workflow egress survives clone and refresh", () => {
  const gitOnly = createGitNetworkPolicy(workspace, "Basic secret");
  assert.deepEqual(
    createGitNetworkPolicy(workspace, "Basic secret", workflowBaseline),
    { allow: { ...workflowBaseline.allow, "github.com": gitOnly.allow["github.com"] } },
  );
  assert.deepEqual(createGitNetworkPolicy(workspace, "Basic secret", "deny-all"), gitOnly);
});

test("hydration restores the session baseline instead of deny-all when workflows are hosted", async () => {
  const policies = [];
  let runs = 0;
  const sandbox = {
    async run() {
      runs += 1;
      return runs === 1
        ? { exitCode: 0, stderr: "", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: `${"b".repeat(40)}\n` };
    },
    async setNetworkPolicy(policy) {
      policies.push(policy);
    },
  };
  let opened;
  await hydrateWorkspaceCheckout({
    authorization: "Basic secret",
    baselinePolicy: workflowBaseline,
    workspace,
    async use(options) {
      opened = options.networkPolicy;
      return sandbox;
    },
  });
  assert.deepEqual(opened, createGitNetworkPolicy(workspace, "Basic secret", workflowBaseline));
  assert.deepEqual(policies, [workflowBaseline]);
});

test("refresh restores the session baseline instead of deny-all when workflows are hosted", async () => {
  const policies = [];
  let runs = 0;
  await refreshWorkspaceCheckout({
    authorization: "Basic secret",
    baselinePolicy: workflowBaseline,
    commitSha: "c".repeat(40),
    workspace,
    sandbox: {
      async run() {
        runs += 1;
        return runs === 1
          ? { exitCode: 0, stderr: "", stdout: "" }
          : { exitCode: 0, stderr: "", stdout: `${"c".repeat(40)}\n` };
      },
      async setNetworkPolicy(policy) {
        policies.push(policy);
      },
    },
  });
  assert.deepEqual(policies, [
    createGitNetworkPolicy(workspace, "Basic secret", workflowBaseline),
    workflowBaseline,
  ]);
});

test("verification refuses brokered workflow secrets in the session environment", async () => {
  let command = "";
  await verifyWorkspaceCheckout(
    {
      async run(input) {
        command = input.command;
        return { exitCode: 0, stderr: "", stdout: `${"f".repeat(40)}\n` };
      },
    },
    workspace,
  );
  const loop = /for variable in ([^;]+); do/.exec(command);
  assert.ok(loop, "verification lists forbidden credential variables");
  const variables = loop[1].trim().split(/\s+/);
  for (const variable of ["TURSO_AUTH_TOKEN", "GTM_WORKFLOW_GATEWAY_API_KEY", "GITHUB_TOKEN"]) {
    assert.ok(variables.includes(variable), variable);
  }
  assert.equal(variables.includes("TURSO_DATABASE_URL"), false);
  assert.equal(variables.includes("AI_GATEWAY_API_KEY"), false);
});
