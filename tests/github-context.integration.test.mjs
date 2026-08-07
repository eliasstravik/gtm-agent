import assert from "node:assert/strict";
import test from "node:test";

import { Octokit } from "octokit";

import {
  ContextConflictError,
  createCommitOnMain,
} from "../agent/lib/github-commit.ts";

const enabled = process.env.RUN_GTM_CONTEXT_INTEGRATION === "1";

test(
  "atomic GitHub create, stale-head refusal, and cleanup against a disposable fixture",
  { skip: enabled ? false : "set RUN_GTM_CONTEXT_INTEGRATION=1 for the credentialed fixture test" },
  async () => {
    assert.equal(
      process.env.GTM_INTEGRATION_CONFIRM,
      "disposable-fixture",
      "Explicit disposable-fixture confirmation is required.",
    );

    const repository = process.env.GTM_INTEGRATION_REPOSITORY ?? "";
    assert.match(
      repository,
      /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+-gtm-agent-fixture$/,
      "The repository name must end in -gtm-agent-fixture.",
    );
    const token = process.env.GTM_INTEGRATION_GITHUB_TOKEN;
    assert.ok(token, "A disposable-fixture GitHub token is required.");

    const [owner, repo] = repository.split("/");
    const octokit = new Octokit({
      auth: token,
      retry: { enabled: false },
      request: { timeout: 15_000 },
    });
    const path = "people/eve-smoke/person.md";
    assert.equal(
      await pathExists(octokit, owner, repo, path),
      false,
      `Refusing to overwrite an existing disposable fixture path: ${path}`,
    );
    const original = await getHead(octokit, owner, repo);
    let created;
    let cleaned;

    try {
      created = await createCommitOnMain(octokit, {
        owner,
        repo,
        expectedHead: original,
        message: "test: add disposable Eve fixture",
        additions: [{ path, content: "# Eve smoke fixture\n" }],
        deletions: [],
      });
      assert.match(created.commitSha, /^[0-9a-f]{40}$/i);

      await assert.rejects(
        createCommitOnMain(octokit, {
          owner,
          repo,
          expectedHead: original,
          message: "test: reject stale disposable fixture update",
          additions: [{ path, content: "# Stale write must not land\n" }],
          deletions: [],
        }),
        ContextConflictError,
      );
    } finally {
      if (await pathExists(octokit, owner, repo, path)) {
        const current = await getHead(octokit, owner, repo);
        cleaned = await createCommitOnMain(octokit, {
          owner,
          repo,
          expectedHead: current,
          message: "test: remove disposable Eve fixture",
          additions: [],
          deletions: [{ path }],
        });
      }
    }

    assert.ok(created);
    assert.ok(cleaned);
    assert.notEqual(cleaned.commitSha, created.commitSha);
  },
);

async function getHead(octokit, owner, repo) {
  const response = await octokit.rest.git.getRef({ owner, repo, ref: "heads/main" });
  return response.data.object.sha;
}

async function pathExists(octokit, owner, repo, path) {
  try {
    await octokit.rest.repos.getContent({ owner, repo, path, ref: "main" });
    return true;
  } catch (error) {
    if (error?.status === 404) return false;
    throw error;
  }
}
