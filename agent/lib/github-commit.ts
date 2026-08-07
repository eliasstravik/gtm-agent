import type { ContextMutation } from "./context-paths.ts";
import { validateContextMutation } from "./context-paths.ts";
import { CONTEXT_BRANCH } from "./config.ts";
import { EgressNotClosedError } from "./context-workspace.ts";

const CREATE_COMMIT_ON_BRANCH = `
  mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid url }
    }
  }
`;

export class ContextConflictError extends Error {
  constructor(message = "The GTM context changed since this Slack thread started. Start a fresh thread and try again.") {
    super(message);
    this.name = "ContextConflictError";
  }
}

export type CommitResult = {
  readonly commitSha: string;
  readonly commitUrl: string;
};

export type MutationResult = CommitResult & {
  readonly status: "committed" | "committed_session_stale";
  readonly message: string;
  readonly paths: readonly string[];
};

export type ContextMutationDependencies = {
  readonly assertWorkspaceReady: (
    expectedHead: string,
    paths: readonly string[],
  ) => Promise<void>;
  readonly getRemoteHead: () => Promise<string>;
  readonly createCommit: (input: ContextMutation) => Promise<CommitResult>;
  readonly refresh: (commitSha: string) => Promise<void>;
  readonly markStale: () => Promise<void>;
};

export async function runApprovedContextMutation(
  rawInput: ContextMutation,
  dependencies: ContextMutationDependencies,
): Promise<MutationResult> {
  const input = validateContextMutation(rawInput);
  const paths = input.manifest.map((entry) => entry.path);

  await dependencies.assertWorkspaceReady(input.expectedHead, paths);
  const remoteHead = await dependencies.getRemoteHead();
  if (remoteHead !== input.expectedHead) {
    throw new ContextConflictError();
  }

  let commit: CommitResult;
  try {
    commit = await dependencies.createCommit(input);
  } catch (error) {
    if (isStaleGitHubError(error)) throw new ContextConflictError();
    throw error;
  }

  try {
    await dependencies.refresh(commit.commitSha);
  } catch (error) {
    if (error instanceof EgressNotClosedError) throw error;
    await dependencies.markStale().catch(() => undefined);
    return {
      ...commit,
      status: "committed_session_stale",
      message:
        "GitHub saved the complete change, but this session could not refresh safely. Start a fresh Slack thread before making another change.",
      paths,
    };
  }

  return {
    ...commit,
    status: "committed",
    message: "GitHub saved the complete change and the session checkout is current.",
    paths,
  };
}

export async function createCommitOnMain(
  octokit: {
    readonly graphql: (
      query: string,
      variables: Record<string, unknown>,
    ) => Promise<{
      readonly createCommitOnBranch: {
        readonly commit: { readonly oid: string; readonly url: string };
      };
    }>;
  },
  input: {
    readonly owner: string;
    readonly repo: string;
    readonly expectedHead: string;
    readonly message: string;
    readonly additions: readonly { readonly path: string; readonly content: string }[];
    readonly deletions: readonly { readonly path: string }[];
  },
): Promise<CommitResult> {
  try {
    const result = await octokit.graphql(CREATE_COMMIT_ON_BRANCH, {
      input: {
        branch: {
          repositoryNameWithOwner: `${input.owner}/${input.repo}`,
          branchName: CONTEXT_BRANCH,
        },
        expectedHeadOid: input.expectedHead,
        message: { headline: input.message },
        fileChanges: {
          additions: input.additions.map((entry) => ({
            path: entry.path,
            contents: Buffer.from(entry.content, "utf8").toString("base64"),
          })),
          deletions: input.deletions,
        },
      },
    });

    return {
      commitSha: result.createCommitOnBranch.commit.oid,
      commitUrl: result.createCommitOnBranch.commit.url,
    };
  } catch (error) {
    if (isStaleGitHubError(error)) throw new ContextConflictError();
    throw error;
  }
}

function isStaleGitHubError(error: unknown): boolean {
  if (error instanceof ContextConflictError) return true;
  if (typeof error !== "object" || error === null) return false;
  const errors = "errors" in error ? error.errors : undefined;
  if (!Array.isArray(errors)) return false;
  return errors.some(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      "type" in entry &&
      entry.type === "STALE_DATA",
  );
}
