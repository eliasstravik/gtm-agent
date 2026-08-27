import type { WorkspaceMutation } from "./workspace-paths.ts";
import type { Octokit } from "octokit";
import { validateWorkspaceMutation } from "./workspace-paths.ts";
import { WORKSPACE_BRANCH } from "./config.ts";
import { EgressNotClosedError } from "./workspace-checkout.ts";

const CREATE_COMMIT_ON_BRANCH = `
  mutation CreateCommitOnBranch($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      commit { oid url }
    }
  }
`;

export class WorkspaceConflictError extends Error {
  constructor(message?: string) {
    super(
      message ??
        "The GTM workspace changed since this Slack thread started. Start a fresh thread and try again.",
    );
    this.name = "WorkspaceConflictError";
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
  /** Migration files applied to the workspace database before the commit. */
  readonly migrations: readonly string[];
};

export type WorkspaceMutationDependencies = {
  readonly assertWorkspaceReady: (
    expectedHead: string,
    paths: readonly string[],
  ) => Promise<void>;
  readonly getRemoteHead: () => Promise<string>;
  /** Resolves `true` when it applied the declared migrations. */
  readonly beforeCommit?: (input: WorkspaceMutation) => Promise<boolean | void>;
  readonly createCommit: (input: WorkspaceMutation) => Promise<CommitResult>;
  readonly refresh: (commitSha: string) => Promise<void>;
  readonly markStale: () => Promise<void>;
};

export async function runApprovedWorkspaceMutation(
  rawInput: WorkspaceMutation,
  dependencies: WorkspaceMutationDependencies,
): Promise<MutationResult> {
  const input = validateWorkspaceMutation(rawInput);
  const paths = input.manifest.map((entry) => entry.path);

  await dependencies.assertWorkspaceReady(input.expectedHead, paths);
  const remoteHead = await dependencies.getRemoteHead();
  if (remoteHead !== input.expectedHead) {
    throw new WorkspaceConflictError();
  }

  const migrated = (await dependencies.beforeCommit?.(input)) === true;
  const migrations = migrated ? input.migrations : [];

  let commit: CommitResult;
  try {
    commit = await dependencies.createCommit(input);
  } catch (error) {
    if (isStaleGitHubError(error)) {
      throw new WorkspaceConflictError(
        migrated
          ? `The GTM workspace changed since this Slack thread started. The accepted ${describeMigrations(migrations)} already applied to the workspace database; the migration is idempotent, so start a fresh thread and re-propose the same batch.`
          : undefined,
      );
    }
    if (migrated) {
      throw new Error(
        `The GitHub commit failed after the accepted ${describeMigrations(migrations)} already applied to the workspace database. No commit was created. Inspect the repository, then re-propose the same batch in a fresh Slack thread; the migration is idempotent.`,
        { cause: error },
      );
    }
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
      migrations,
    };
  }

  return {
    ...commit,
    status: "committed",
    message: "GitHub saved the complete change and the session checkout is current.",
    paths,
    migrations,
  };
}

function describeMigrations(migrations: readonly string[]): string {
  return `${migrations.length === 1 ? "migration" : "migrations"} ${migrations.join(", ")}`;
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
    readonly rest?: {
      readonly git: Pick<
        Octokit["rest"]["git"],
        "createBlob" | "createCommit" | "createTree" | "getCommit" | "updateRef"
      >;
    };
  },
  input: {
    readonly author?: { readonly email: string; readonly name: string } | null;
    readonly owner: string;
    readonly repo: string;
    readonly expectedHead: string;
    readonly message: string;
    readonly additions: readonly { readonly path: string; readonly content: string }[];
    readonly deletions: readonly { readonly path: string }[];
  },
): Promise<CommitResult> {
  if (input.author !== undefined && input.author !== null) {
    if (octokit.rest === undefined) {
      throw new Error("The GitHub client cannot create an attributed commit.");
    }
    const git = octokit.rest.git;
    const base = await git.getCommit({
      owner: input.owner,
      repo: input.repo,
      commit_sha: input.expectedHead,
    });
    const additions = await Promise.all(
      input.additions.map(async (entry) => {
        const blob = await git.createBlob({
          owner: input.owner,
          repo: input.repo,
          content: Buffer.from(entry.content, "utf8").toString("base64"),
          encoding: "base64",
        });
        return {
          mode: "100644" as const,
          path: entry.path,
          sha: blob.data.sha,
          type: "blob" as const,
        };
      }),
    );
    const tree = await git.createTree({
      owner: input.owner,
      repo: input.repo,
      base_tree: base.data.tree.sha,
      tree: [
        ...additions,
        ...input.deletions.map((entry) => ({
          mode: "100644" as const,
          path: entry.path,
          sha: null,
          type: "blob" as const,
        })),
      ],
    });
    const commit = await git.createCommit({
      owner: input.owner,
      repo: input.repo,
      message: input.message,
      tree: tree.data.sha,
      parents: [input.expectedHead],
      author: input.author,
    });
    try {
      await git.updateRef({
        owner: input.owner,
        repo: input.repo,
        ref: `heads/${WORKSPACE_BRANCH}`,
        sha: commit.data.sha,
        force: false,
      });
    } catch (error) {
      if (isRefConflict(error)) throw new WorkspaceConflictError();
      throw error;
    }
    return {
      commitSha: commit.data.sha,
      commitUrl: commit.data.html_url,
    };
  }

  try {
    const result = await octokit.graphql(CREATE_COMMIT_ON_BRANCH, {
      input: {
        branch: {
          repositoryNameWithOwner: `${input.owner}/${input.repo}`,
          branchName: WORKSPACE_BRANCH,
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
    if (isStaleGitHubError(error)) throw new WorkspaceConflictError();
    throw error;
  }
}

function isStaleGitHubError(error: unknown): boolean {
  if (error instanceof WorkspaceConflictError) return true;
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

function isRefConflict(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("status" in error)) return false;
  return error.status === 409 || error.status === 422;
}
