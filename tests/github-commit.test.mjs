import assert from "node:assert/strict";
import test from "node:test";

import {
  WorkspaceConflictError,
  createCommitOnMain,
  runApprovedWorkspaceMutation,
} from "../agent/lib/github-commit.ts";
import { EgressNotClosedError } from "../agent/lib/workspace-checkout.ts";

const input = {
  summary: "Add an enterprise ICP",
  manifest: [{ path: "icps/enterprise/ICP.md", operation: "write" }],
  expectedHead: "a".repeat(40),
  message: "Add enterprise ICP",
  additions: [{ path: "icps/enterprise/ICP.md", content: "# Enterprise\n" }],
  deletions: [],
};

test("validation and local readiness happen before remote access", async () => {
  const events = [];
  await assert.rejects(
    runApprovedWorkspaceMutation(
      { ...input, expectedHead: "short" },
      {
        async assertWorkspaceReady() {
          events.push("local");
        },
        async getRemoteHead() {
          events.push("remote");
          return input.expectedHead;
        },
        async createCommit() {
          events.push("commit");
          return { commitSha: "b".repeat(40), commitUrl: "https://github.com/acme/repo/commit/b" };
        },
        async refresh() {},
        async markStale() {},
      },
    ),
    /full Git object ID/i,
  );
  assert.deepEqual(events, []);
});

test("a stale remote head stops without retrying or committing", async () => {
  const events = [];
  await assert.rejects(
    runApprovedWorkspaceMutation(input, {
      async assertWorkspaceReady() {
        events.push("local");
      },
      async getRemoteHead() {
        events.push("remote");
        return "f".repeat(40);
      },
      async createCommit() {
        events.push("commit");
        throw new Error("must not run");
      },
      async refresh() {},
      async markStale() {},
    }),
    WorkspaceConflictError,
  );
  assert.deepEqual(events, ["local", "remote"]);
});

test("multiple additions and deletions become one GraphQL mutation", async () => {
  const calls = [];
  const octokit = {
    async graphql(query, variables) {
      calls.push({ query, variables });
      return {
        createCommitOnBranch: {
          commit: {
            oid: "b".repeat(40),
            url: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
          },
        },
      };
    },
  };
  const result = await createCommitOnMain(octokit, {
    owner: "acme",
    repo: "repo",
    expectedHead: input.expectedHead,
    message: "Update workspace",
    additions: [
      { path: "icps/a/ICP.md", content: "# A\n" },
      { path: "personas/b/PERSONA.md", content: "# B\n" },
    ],
    deletions: [{ path: "personas/c/PERSONA.md" }],
  });

  assert.equal(calls.length, 1);
  assert.match(calls[0].query, /createCommitOnBranch/);
  assert.equal(calls[0].variables.input.branch.branchName, "main");
  assert.equal(calls[0].variables.input.expectedHeadOid, input.expectedHead);
  assert.deepEqual(calls[0].variables.input.fileChanges.deletions, [
    { path: "personas/c/PERSONA.md" },
  ]);
  assert.equal(
    Buffer.from(
      calls[0].variables.input.fileChanges.additions[0].contents,
      "base64",
    ).toString("utf8"),
    "# A\n",
  );
  assert.equal(result.commitSha, "b".repeat(40));
});

test("GitHub STALE_DATA is normalized to the same fresh-thread conflict", async () => {
  await assert.rejects(
    createCommitOnMain(
      {
        async graphql() {
          throw { errors: [{ type: "STALE_DATA" }] };
        },
      },
      {
        owner: "acme",
        repo: "repo",
        expectedHead: input.expectedHead,
        message: "Update workspace",
        additions: input.additions,
        deletions: [],
      },
    ),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.match(error.message, /fresh thread/i);
      return true;
    },
  );
});

test("remote success plus refresh failure is reported as durable and marks stale", async () => {
  const events = [];
  const result = await runApprovedWorkspaceMutation(input, {
    async assertWorkspaceReady() {
      events.push("local");
    },
    async getRemoteHead() {
      events.push("remote");
      return input.expectedHead;
    },
    async createCommit() {
      events.push("commit");
      return {
        commitSha: "b".repeat(40),
        commitUrl: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
      };
    },
    async refresh() {
      events.push("refresh");
      throw new Error("sandbox unavailable");
    },
    async markStale() {
      events.push("stale");
    },
  });

  assert.deepEqual(events, ["local", "remote", "commit", "refresh", "stale"]);
  assert.equal(result.status, "committed_session_stale");
  assert.equal(result.commitSha, "b".repeat(40));
  assert.match(result.message, /fresh Slack thread/i);
});

test("an egress-closure failure cannot be downgraded to a stale-session success", async () => {
  let markedStale = false;
  await assert.rejects(
    runApprovedWorkspaceMutation(input, {
      async assertWorkspaceReady() {},
      async getRemoteHead() {
        return input.expectedHead;
      },
      async createCommit() {
        return {
          commitSha: "b".repeat(40),
          commitUrl: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
        };
      },
      async refresh() {
        throw new EgressNotClosedError();
      },
      async markStale() {
        markedStale = true;
      },
    }),
    EgressNotClosedError,
  );
  assert.equal(markedStale, false);
});

test("successful remote write refreshes the session once", async () => {
  const events = [];
  const result = await runApprovedWorkspaceMutation(input, {
    async assertWorkspaceReady() {
      events.push("local");
    },
    async getRemoteHead() {
      events.push("remote");
      return input.expectedHead;
    },
    async createCommit() {
      events.push("commit");
      return {
        commitSha: "b".repeat(40),
        commitUrl: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
      };
    },
    async refresh(sha) {
      events.push(`refresh:${sha}`);
    },
    async markStale() {
      events.push("stale");
    },
  });

  assert.deepEqual(events, ["local", "remote", "commit", `refresh:${"b".repeat(40)}`]);
  assert.equal(result.status, "committed");
});
