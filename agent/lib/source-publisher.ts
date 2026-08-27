import { createHash } from "node:crypto";

import type { Octokit } from "octokit";

import type { SourceProposalConfiguration } from "./config.ts";
import type { CapturedSourceProposal } from "./source-proposal.ts";

type GitHubClient = {
  readonly rest: {
    readonly git: Pick<
      Octokit["rest"]["git"],
      | "createBlob"
      | "createCommit"
      | "createRef"
      | "createTree"
      | "getCommit"
      | "getRef"
    >;
    readonly pulls: Pick<Octokit["rest"]["pulls"], "create" | "list">;
  };
};

export type SourcePublicationResult = {
  readonly baseSha: string;
  readonly branch: string;
  readonly commitSha: string;
  readonly paths: readonly string[];
  readonly pullRequestNumber: number;
  readonly pullRequestUrl: string;
  readonly status: "draft_pr_created" | "draft_pr_exists";
};

export async function publishSourceProposal(
  octokit: GitHubClient,
  input: {
    readonly operationId: string;
    readonly proposal: CapturedSourceProposal;
    readonly source: SourceProposalConfiguration;
    readonly summary: string;
    readonly title: string;
  },
): Promise<SourcePublicationResult> {
  const { proposal, source } = input;
  const base = await octokit.rest.git.getRef({
    owner: source.owner,
    repo: source.repo,
    ref: `heads/${source.branch}`,
  });
  if (base.data.object.sha !== proposal.baseSha || proposal.baseSha !== source.deployedSha) {
    throw new Error(
      "The Eve source repository changed after this editing session started. Start a fresh Slack thread and re-propose the change.",
    );
  }

  const baseCommit = await octokit.rest.git.getCommit({
    owner: source.owner,
    repo: source.repo,
    commit_sha: proposal.baseSha,
  });
  const additions = await Promise.all(
    proposal.changes
      .filter((change) => change.operation === "write")
      .map(async (change) => {
        const blob = await octokit.rest.git.createBlob({
          owner: source.owner,
          repo: source.repo,
          content: Buffer.from(change.content, "utf8").toString("base64"),
          encoding: "base64",
        });
        return {
          mode: "100644" as const,
          path: change.path,
          sha: blob.data.sha,
          type: "blob" as const,
        };
      }),
  );
  const tree = await octokit.rest.git.createTree({
    owner: source.owner,
    repo: source.repo,
    base_tree: baseCommit.data.tree.sha,
    tree: [
      ...additions,
      ...proposal.changes
        .filter((change) => change.operation === "delete")
        .map((change) => ({
          mode: "100644" as const,
          path: change.path,
          sha: null,
          type: "blob" as const,
        })),
    ],
  });

  const branch = sourceProposalBranch(input.operationId, proposal.hash);
  let commitSha = await existingProposalCommit(octokit, source, branch, tree.data.sha);
  if (commitSha === null) {
    const commit = await octokit.rest.git.createCommit({
      owner: source.owner,
      repo: source.repo,
      message: input.title,
      tree: tree.data.sha,
      parents: [proposal.baseSha],
    });
    commitSha = commit.data.sha;
    try {
      await octokit.rest.git.createRef({
        owner: source.owner,
        repo: source.repo,
        ref: `refs/heads/${branch}`,
        sha: commitSha,
      });
    } catch (error) {
      if (!hasStatus(error, 422)) throw error;
      const replayed = await existingProposalCommit(
        octokit,
        source,
        branch,
        tree.data.sha,
      );
      if (replayed === null) throw error;
      commitSha = replayed;
    }
  }

  const existing = await octokit.rest.pulls.list({
    owner: source.owner,
    repo: source.repo,
    base: source.branch,
    head: `${source.owner}:${branch}`,
    state: "all",
    per_page: 10,
  });
  const pull = existing.data[0];
  if (pull !== undefined) {
    if (pull.state !== "open") {
      throw new Error(
        "This exact Eve source proposal already has a closed pull request. Start a fresh source-editing session before proposing it again.",
      );
    }
    return publicationResult(
      "draft_pr_exists",
      proposal,
      branch,
      commitSha,
      pull.number,
      pull.html_url,
    );
  }

  const created = await octokit.rest.pulls.create({
    owner: source.owner,
    repo: source.repo,
    base: source.branch,
    head: branch,
    title: input.title,
    body: buildPullRequestBody(input.summary, proposal),
    draft: true,
    maintainer_can_modify: false,
  });
  return publicationResult(
    "draft_pr_created",
    proposal,
    branch,
    commitSha,
    created.data.number,
    created.data.html_url,
  );
}

export function sourceProposalBranch(operationId: string, proposalHash: string): string {
  const suffix = createHash("sha256")
    .update(`${operationId}\0${proposalHash}`)
    .digest("hex")
    .slice(0, 16);
  return `eve-self-modification/${suffix}`;
}

async function existingProposalCommit(
  octokit: GitHubClient,
  source: SourceProposalConfiguration,
  branch: string,
  expectedTree: string,
): Promise<string | null> {
  let reference;
  try {
    reference = await octokit.rest.git.getRef({
      owner: source.owner,
      repo: source.repo,
      ref: `heads/${branch}`,
    });
  } catch (error) {
    if (hasStatus(error, 404)) return null;
    throw error;
  }
  const commit = await octokit.rest.git.getCommit({
    owner: source.owner,
    repo: source.repo,
    commit_sha: reference.data.object.sha,
  });
  if (commit.data.tree.sha !== expectedTree) {
    throw new Error(
      "The namespaced Eve proposal branch exists with different content. Refusing to update or overwrite it.",
    );
  }
  return commit.data.sha;
}

function buildPullRequestBody(
  summary: string,
  proposal: CapturedSourceProposal,
): string {
  const paths = proposal.paths.map((path) => `- \`${path}\``).join("\n");
  return `${summary.trim()}\n\n## Changed paths\n\n${paths}\n\n## Safety boundary\n\nThis draft was proposed by the deployed Eve agent from exact revision \`${proposal.baseSha}\`. The publisher can create this namespaced branch and draft pull request, but cannot update \`main\`, merge, approve, retarget, close, or deploy it.\n\nProposal integrity: \`${proposal.hash}\``;
}

function publicationResult(
  status: SourcePublicationResult["status"],
  proposal: CapturedSourceProposal,
  branch: string,
  commitSha: string,
  pullRequestNumber: number,
  pullRequestUrl: string,
): SourcePublicationResult {
  return {
    baseSha: proposal.baseSha,
    branch,
    commitSha,
    paths: proposal.paths,
    pullRequestNumber,
    pullRequestUrl,
    status,
  };
}

function hasStatus(error: unknown, expected: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === expected
  );
}
