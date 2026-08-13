import { getToken } from "@vercel/connect";
import { defineTool } from "eve/tools";
import { always } from "eve/tools/approval";
import { Octokit } from "octokit";
import { z } from "zod";

import { getConfiguration } from "../lib/config.ts";
import {
  MAX_FILE_BYTES,
  MAX_PATHS,
  MAX_TOTAL_BYTES,
  validateWorkspaceMutation,
} from "../lib/workspace-paths.ts";
import {
  assertWorkspaceCheckoutReady,
  createGitBasicAuthorization,
  EgressNotClosedError,
  markWorkspaceCheckoutStale,
  refreshWorkspaceCheckout,
} from "../lib/workspace-checkout.ts";
import {
  WorkspaceConflictError,
  createCommitOnMain,
  runApprovedWorkspaceMutation,
} from "../lib/github-commit.ts";

const pathSchema = z
  .string()
  .min(1)
  .max(240)
  .describe("Repository-relative GTM workspace path from the allowed contract.");

const inputSchema = z
  .object({
    summary: z
      .string()
      .min(1)
      .max(240)
      .describe("Concise human-readable summary shown in the approval request."),
    manifest: z
      .array(
        z
          .object({
            path: pathSchema,
            operation: z
              .enum(["write", "delete"])
              .describe("Exact operation proposed for this path."),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_PATHS),
    expectedHead: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
      .describe("Full Git commit ID read from the session checkout before drafting."),
    message: z
      .string()
      .min(1)
      .max(120)
      .describe("Commit headline for the atomic GitHub commit."),
    additions: z
      .array(
        z
          .object({
            path: pathSchema,
            content: z
              .string()
              .min(1)
              .max(MAX_FILE_BYTES)
              .describe("Complete UTF-8 file contents to write."),
          })
          .strict(),
      )
      .max(MAX_PATHS),
    deletions: z
      .array(z.object({ path: pathSchema }).strict())
      .max(MAX_PATHS),
  })
  .strict()
  .refine(
    (input) =>
      input.additions.reduce(
        (total, addition) => total + Buffer.byteLength(addition.content, "utf8"),
        0,
      ) <= MAX_TOTAL_BYTES,
    { message: "Combined addition content is too large." },
  );

export default defineTool({
  description:
    "Apply one approval-gated, atomic set of GTM workspace file writes and deletions to the configured repository on main.",
  inputSchema,
  approval: always(),
  async execute(input, ctx) {
    const configuration = getConfiguration();
    if (configuration.workspace === null) {
      return {
        status: "setup_required" as const,
        message:
          "No GTM workspace repository is configured. Connect an existing repository before trying to save workspace changes.",
      };
    }

    const workspace = configuration.workspace;
    const mutation = validateWorkspaceMutation(input);
    const sandbox = await ctx.getSandbox();
    const token = await getToken(workspace.connector, {
      subject: { type: "app" },
      scopes: ["contents:read", "contents:write", "metadata:read"],
      authorizationDetails: [
        {
          type: "github_app_installation",
          repositories: [workspace.repository],
        },
      ],
    });
    const refreshToken = await getToken(workspace.connector, {
      subject: { type: "app" },
      scopes: ["contents:read", "metadata:read"],
      authorizationDetails: [
        {
          type: "github_app_installation",
          repositories: [workspace.repository],
        },
      ],
    });
    const authorization = createGitBasicAuthorization(refreshToken);
    const octokit = new Octokit({
      auth: token,
      retry: { enabled: false },
      request: { timeout: 15_000 },
    });

    try {
      return await runApprovedWorkspaceMutation(mutation, {
        assertWorkspaceReady: (expectedHead, paths) =>
          assertWorkspaceCheckoutReady({
            workspace,
            expectedHead,
            paths,
            sandbox,
          }),
        async getRemoteHead() {
          const response = await octokit.rest.git.getRef({
            owner: workspace.owner,
            repo: workspace.repo,
            ref: `heads/${workspace.branch}`,
          });
          return response.data.object.sha;
        },
        createCommit: (mutation) =>
          createCommitOnMain(octokit, {
            owner: workspace.owner,
            repo: workspace.repo,
            expectedHead: mutation.expectedHead,
            message: mutation.message,
            additions: mutation.additions,
            deletions: mutation.deletions,
          }),
        refresh: (commitSha) =>
          refreshWorkspaceCheckout({
            authorization,
            commitSha,
            workspace,
            sandbox,
          }),
        markStale: () => markWorkspaceCheckoutStale(sandbox, workspace),
      });
    } catch (error) {
      if (error instanceof WorkspaceConflictError) throw error;
      if (error instanceof EgressNotClosedError) {
        throw new Error(
          "GitHub saved the complete change, but sandbox egress could not be closed. End this session immediately and inspect the configured repository before any retry.",
        );
      }
      throw new Error(
        "The approved GTM workspace change could not be confirmed. Inspect the configured repository before retrying, then start a fresh Slack thread; do not assume a retry is safe.",
      );
    }
  },
});
