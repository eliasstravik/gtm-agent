import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertContextWorkspaceReady,
  createGitBasicAuthorization,
  createGitNetworkPolicy,
  EgressNotClosedError,
  hydrateContextWorkspace,
  refreshContextWorkspace,
  verifyContextWorkspace,
} from "../agent/lib/context-workspace.ts";

const context = {
  branch: "main",
  checkoutDirectory: "$HOME/.gtm/gtm-context",
  connector: "github/gtm-agent",
  owner: "acme-inc",
  repo: "gtm-context",
  repository: "acme-inc/gtm-context",
  staleMarker: "$HOME/.gtm/.gtm-context.stale",
};

test("Git policy injects auth only for the exact repository smart-HTTP path", () => {
  assert.equal(
    createGitBasicAuthorization("secret"),
    `Basic ${Buffer.from("x-access-token:secret").toString("base64")}`,
  );
  assert.deepEqual(createGitNetworkPolicy(context, "Basic secret"), {
    allow: {
      "github.com": [
        {
          match: {
            method: ["GET"],
            path: { exact: "/acme-inc/gtm-context.git/info/refs" },
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
            path: { exact: "/acme-inc/gtm-context.git/git-upload-pack" },
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

  const result = await hydrateContextWorkspace({
    authorization: "Basic secret",
    context,
    async use(options) {
      events.push("use");
      assert.deepEqual(options.networkPolicy, createGitNetworkPolicy(context, "Basic secret"));
      return sandbox;
    },
  });

  assert.deepEqual(events, ["use", "run", "policy:deny-all", "run"]);
  assert.deepEqual(result, {
    branch: "main",
    checkoutDirectory: "$HOME/.gtm/gtm-context",
    head: "b".repeat(40),
    repository: "acme-inc/gtm-context",
  });
  assert.match(commands[0], /--depth=1/);
  assert.match(commands[0], /--single-branch/);
  assert.match(commands[0], /--branch "main"/);
  assert.match(commands[0], /mkdir "\$repo_dir"/);
  assert.match(commands[0], /remote remove origin/);
  assert.equal(commands.some((command) => command.includes("Basic secret")), false);
  assert.match(commands[1], /org\.md/);
  assert.match(commands[1], /Unexpected credential variable/);
  assert.match(commands[1], /Unexpected Git credential configuration/);
  assert.match(commands[1], /120000/);
  assert.match(commands[1], /160000/);
  assert.equal(abortSignals.every((signal) => signal instanceof AbortSignal), true);
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
    hydrateContextWorkspace({
      authorization: "Basic secret",
      context,
      async use() {
        return sandbox;
      },
    }),
    (error) => {
      assert.doesNotMatch(error.message, /secret/);
      assert.match(error.message, /checkout failed/i);
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

  await refreshContextWorkspace({
    authorization: "Basic secret",
    commitSha: "c".repeat(40),
    context,
    sandbox,
  });

  assert.deepEqual(policies, [createGitNetworkPolicy(context, "Basic secret"), "deny-all"]);
  assert.match(commands[0], new RegExp(`fetch[\\s\\S]+${"c".repeat(40)}`));
  assert.match(commands[0], new RegExp(`reset --hard "${"c".repeat(40)}"`));
  assert.equal(commands.some((command) => command.includes("Basic secret")), false);
});

test("refresh rejects an untrusted commit value before opening egress", async () => {
  const policies = [];
  await assert.rejects(
    refreshContextWorkspace({
      authorization: "Basic secret",
      commitSha: 'main"; printenv',
      context,
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
    refreshContextWorkspace({
      authorization: "Basic secret",
      commitSha: "e".repeat(40),
      context,
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
  assert.deepEqual(policies, [createGitNetworkPolicy(context, "Basic secret"), "deny-all"]);
});

test("a repeated deny-all failure is surfaced as a terminal egress error", async () => {
  let attempts = 0;
  await assert.rejects(
    refreshContextWorkspace({
      authorization: "Basic secret",
      commitSha: "e".repeat(40),
      context,
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
  await assertContextWorkspaceReady({
    context,
    expectedHead: "d".repeat(40),
    paths: ["suborgs/europe/personas/revenue-leader.md"],
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
    "suborgs/europe/personas/revenue-leader.md",
  ]) {
    assert.match(command, new RegExp(`test ! -L "\\$repo_dir/${path}"`));
  }
});

test("real Git preflight and verification reject dirty, stale, wrong branch, wrong head, and tracked symlinks", async () => {
  const temporaryRoot = await mkdtemp(
    join(process.env.PAPERCLIP_RUN_SCRATCH_DIR ?? tmpdir(), "gtm-context-workspace-"),
  );
  const repository = join(temporaryRoot, "repository");
  const fixtureContext = {
    ...context,
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
    await writeFile(join(repository, "org.md"), "# Organization\n", "utf8");
    git(repository, ["add", "org.md"]);
    git(repository, ["commit", "-m", "fixture"]);
    const originalHead = git(repository, ["rev-parse", "HEAD"]);

    assert.equal(
      await verifyContextWorkspace(sandbox, fixtureContext, originalHead),
      originalHead,
    );

    await writeFile(join(repository, "draft.md"), "scratch\n", "utf8");
    await assert.rejects(
      assertContextWorkspaceReady({
        context: fixtureContext,
        expectedHead: originalHead,
        paths: ["org.md"],
        sandbox,
      }),
      /uncommitted or untracked/i,
    );
    await rm(join(repository, "draft.md"));

    await writeFile(fixtureContext.staleMarker, "", "utf8");
    await assert.rejects(
      assertContextWorkspaceReady({
        context: fixtureContext,
        expectedHead: originalHead,
        paths: ["org.md"],
        sandbox,
      }),
      /stale/i,
    );
    await rm(fixtureContext.staleMarker);

    git(repository, ["checkout", "-b", "other"]);
    await assert.rejects(
      assertContextWorkspaceReady({
        context: fixtureContext,
        expectedHead: originalHead,
        paths: ["org.md"],
        sandbox,
      }),
      /configured main branch/i,
    );
    git(repository, ["checkout", "main"]);

    await writeFile(join(repository, "icps.md"), "changed\n", "utf8");
    git(repository, ["add", "icps.md"]);
    git(repository, ["commit", "-m", "advance"]);
    await assert.rejects(
      assertContextWorkspaceReady({
        context: fixtureContext,
        expectedHead: originalHead,
        paths: ["org.md"],
        sandbox,
      }),
      /approved base commit/i,
    );

    await symlink("org.md", join(repository, "org-link.md"));
    git(repository, ["add", "org-link.md"]);
    git(repository, ["commit", "-m", "tracked symlink"]);
    await assert.rejects(
      verifyContextWorkspace(
        sandbox,
        fixtureContext,
        git(repository, ["rev-parse", "HEAD"]),
      ),
      /verification failed/i,
    );
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
