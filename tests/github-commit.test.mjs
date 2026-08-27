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
  migrations: [],
  destructive: false,
};

const migrating = {
  summary: "Add a score column",
  manifest: [{ path: "workflows/drizzle/0002_score.sql", operation: "write" }],
  expectedHead: "a".repeat(40),
  message: "Add score column",
  additions: [
    { path: "workflows/drizzle/0002_score.sql", content: "ALTER TABLE accounts ADD `score` integer;" },
  ],
  deletions: [],
  migrations: ["workflows/drizzle/0002_score.sql"],
  destructive: false,
};

test("a conflict after migrations applied says so instead of hiding the database change", async () => {
  await assert.rejects(
    runApprovedWorkspaceMutation(migrating, {
      async assertWorkspaceReady() {},
      async getRemoteHead() {
        return migrating.expectedHead;
      },
      async beforeCommit() {
        return true;
      },
      async createCommit() {
        throw new WorkspaceConflictError();
      },
      async refresh() {},
      async markStale() {},
    }),
    (error) => {
      assert.ok(error instanceof WorkspaceConflictError);
      assert.match(error.message, /0002_score\.sql/);
      assert.match(error.message, /already applied/i);
      assert.match(error.message, /re-propose the same batch/i);
      return true;
    },
  );
});

test("any commit failure after migrations applied carries the migration list", async () => {
  await assert.rejects(
    runApprovedWorkspaceMutation(migrating, {
      async assertWorkspaceReady() {},
      async getRemoteHead() {
        return migrating.expectedHead;
      },
      async beforeCommit() {
        return true;
      },
      async createCommit() {
        throw new Error("GitHub unavailable");
      },
      async refresh() {},
      async markStale() {},
    }),
    (error) => {
      assert.ok(!(error instanceof WorkspaceConflictError));
      assert.match(error.message, /0002_score\.sql/);
      assert.match(error.message, /already applied/i);
      return true;
    },
  );
});

test("a successful migrating save reports the applied migrations", async () => {
  const result = await runApprovedWorkspaceMutation(migrating, {
    async assertWorkspaceReady() {},
    async getRemoteHead() {
      return migrating.expectedHead;
    },
    async beforeCommit() {
      return true;
    },
    async createCommit() {
      return { commitSha: "b".repeat(40), commitUrl: "https://github.com/acme/repo/commit/b" };
    },
    async refresh() {},
    async markStale() {},
  });
  assert.deepEqual(result.migrations, ["workflows/drizzle/0002_score.sql"]);
  assert.equal(result.status, "committed");
});

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

test("an attributed commit uses an atomic REST ref update", async () => {
  const calls = [];
  const git = {
    async getCommit(value) {
      calls.push(["getCommit", value]);
      return { data: { tree: { sha: "tree-base" } } };
    },
    async createBlob(value) {
      calls.push(["createBlob", value]);
      return { data: { sha: "blob-new" } };
    },
    async createTree(value) {
      calls.push(["createTree", value]);
      return { data: { sha: "tree-new" } };
    },
    async createCommit(value) {
      calls.push(["createCommit", value]);
      return {
        data: {
          sha: "b".repeat(40),
          html_url: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
        },
      };
    },
    async updateRef(value) {
      calls.push(["updateRef", value]);
      return {};
    },
  };
  const author = {
    name: "Acme Deploys",
    email: "123456+acme@users.noreply.github.com",
  };

  const result = await createCommitOnMain(
    { async graphql() {}, rest: { git } },
    {
      owner: "acme",
      repo: "repo",
      expectedHead: input.expectedHead,
      message: "Update workspace",
      author,
      additions: input.additions,
      deletions: [{ path: "personas/old/PERSONA.md" }],
    },
  );

  assert.deepEqual(calls.map(([name]) => name), [
    "getCommit",
    "createBlob",
    "createTree",
    "createCommit",
    "updateRef",
  ]);
  assert.deepEqual(calls[3][1].author, author);
  assert.deepEqual(calls[3][1].parents, [input.expectedHead]);
  assert.equal(calls[4][1].force, false);
  assert.equal(calls[4][1].ref, "heads/main");
  assert.equal(result.commitSha, "b".repeat(40));
});

test("an attributed commit normalizes only rejected ref updates as conflicts", async () => {
  const makeOctokit = (status) => ({
    async graphql() {},
    rest: {
      git: {
        async getCommit() {
          return { data: { tree: { sha: "tree-base" } } };
        },
        async createBlob() {
          return { data: { sha: "blob-new" } };
        },
        async createTree() {
          return { data: { sha: "tree-new" } };
        },
        async createCommit() {
          return {
            data: {
              sha: "b".repeat(40),
              html_url: `https://github.com/acme/repo/commit/${"b".repeat(40)}`,
            },
          };
        },
        async updateRef() {
          throw Object.assign(new Error(`GitHub returned ${status}`), { status });
        },
      },
    },
  });
  const attributedInput = {
    owner: "acme",
    repo: "repo",
    expectedHead: input.expectedHead,
    message: "Update workspace",
    author: {
      name: "Acme Deploys",
      email: "123456+acme@users.noreply.github.com",
    },
    additions: input.additions,
    deletions: [],
  };

  await assert.rejects(
    createCommitOnMain(makeOctokit(409), attributedInput),
    WorkspaceConflictError,
  );
  await assert.rejects(
    createCommitOnMain(makeOctokit(500), attributedInput),
    (error) => {
      assert.equal(error.status, 500);
      assert.ok(!(error instanceof WorkspaceConflictError));
      return true;
    },
  );
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
