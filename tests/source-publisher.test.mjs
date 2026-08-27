import assert from "node:assert/strict";
import test from "node:test";

import {
  publishSourceProposal,
  sourceProposalBranch,
} from "../agent/lib/source-publisher.ts";

const baseSha = "a".repeat(40);
const source = {
  allowedSlackUserIds: ["U012345678"],
  branch: "main",
  checkoutDirectory: "$HOME/.eve-source/eve",
  connector: "github/eve-source",
  deployedSha: baseSha,
  owner: "acme",
  repo: "eve",
  repository: "acme/eve",
};
const proposal = {
  baseSha,
  changes: [
    {
      operation: "write",
      path: "agent/instructions.md",
      content: "# Updated\n",
    },
  ],
  diff: "diff --git a/agent/instructions.md b/agent/instructions.md\n",
  hash: "b".repeat(64),
  paths: ["agent/instructions.md"],
};

test("source branch names are deterministic and always namespaced", () => {
  const first = sourceProposalBranch("call-1", proposal.hash);
  assert.equal(first, sourceProposalBranch("call-1", proposal.hash));
  assert.notEqual(first, sourceProposalBranch("call-2", proposal.hash));
  assert.match(first, /^eve-self-modification\/[0-9a-f]{16}$/);
});

test("publisher creates one new namespaced branch and draft PR without updating main", async () => {
  const calls = [];
  const octokit = fakeOctokit({ calls });
  const result = await publishSourceProposal(octokit, {
    operationId: "call-1",
    proposal,
    source,
    summary: "Update durable instructions.",
    title: "Update Eve instructions",
  });

  assert.equal(result.status, "draft_pr_created");
  assert.match(result.branch, /^eve-self-modification\//);
  assert.equal(result.pullRequestUrl, "https://github.example/pull/7");
  const ref = calls.find((call) => call.name === "createRef").input;
  assert.equal(ref.ref, `refs/heads/${result.branch}`);
  const pull = calls.find((call) => call.name === "createPull").input;
  assert.equal(pull.base, "main");
  assert.equal(pull.head, result.branch);
  assert.equal(pull.draft, true);
  assert.equal(pull.maintainer_can_modify, false);
  assert.equal(calls.some((call) => call.name === "updateRef"), false);
});

test("publisher fails before writing when main no longer matches the deployed base", async () => {
  const calls = [];
  const octokit = fakeOctokit({ calls, mainSha: "c".repeat(40) });
  await assert.rejects(
    publishSourceProposal(octokit, {
      operationId: "call-1",
      proposal,
      source,
      summary: "Update durable instructions.",
      title: "Update Eve instructions",
    }),
    /changed after this editing session started/i,
  );
  assert.deepEqual(calls.map((call) => call.name), ["getRef:main"]);
});

test("publisher reuses the same proposal branch and open draft PR on replay", async () => {
  const calls = [];
  const octokit = fakeOctokit({
    calls,
    existingProposal: {
      commitSha: "existing-proposal-commit",
      pull: {
        html_url: "https://github.example/pull/7",
        number: 7,
        state: "open",
      },
      treeSha: "proposal-tree",
    },
  });
  const result = await publishSourceProposal(octokit, {
    operationId: "call-1",
    proposal,
    source,
    summary: "Update durable instructions.",
    title: "Update Eve instructions",
  });

  assert.equal(result.status, "draft_pr_exists");
  assert.equal(result.commitSha, "existing-proposal-commit");
  assert.equal(calls.some((call) => call.name === "createCommit"), false);
  assert.equal(calls.some((call) => call.name === "createRef"), false);
  assert.equal(calls.some((call) => call.name === "createPull"), false);
});

function fakeOctokit({ calls, existingProposal = null, mainSha = baseSha }) {
  return {
    rest: {
      git: {
        async getRef(input) {
          if (input.ref === "heads/main") {
            calls.push({ name: "getRef:main", input });
            return { data: { object: { sha: mainSha } } };
          }
          calls.push({ name: "getRef:proposal", input });
          if (existingProposal !== null) {
            return {
              data: { object: { sha: existingProposal.commitSha } },
            };
          }
          throw Object.assign(new Error("not found"), { status: 404 });
        },
        async getCommit(input) {
          calls.push({ name: "getCommit", input });
          return {
            data: {
              sha: input.commit_sha,
              tree: {
                sha:
                  existingProposal !== null &&
                  input.commit_sha === existingProposal.commitSha
                    ? existingProposal.treeSha
                    : "base-tree",
              },
            },
          };
        },
        async createBlob(input) {
          calls.push({ name: "createBlob", input });
          return { data: { sha: "blob-sha" } };
        },
        async createTree(input) {
          calls.push({ name: "createTree", input });
          return { data: { sha: "proposal-tree" } };
        },
        async createCommit(input) {
          calls.push({ name: "createCommit", input });
          return { data: { sha: "proposal-commit" } };
        },
        async createRef(input) {
          calls.push({ name: "createRef", input });
          return { data: { object: { sha: input.sha } } };
        },
      },
      pulls: {
        async list(input) {
          calls.push({ name: "listPulls", input });
          return { data: existingProposal?.pull ? [existingProposal.pull] : [] };
        },
        async create(input) {
          calls.push({ name: "createPull", input });
          return {
            data: {
              html_url: "https://github.example/pull/7",
              number: 7,
            },
          };
        },
      },
    },
  };
}
