import { getToken } from "@vercel/connect";
import { defineTool } from "eve/tools";
import { Octokit } from "octokit";
import { z } from "zod";

import { isAllowedSourceCaller } from "../../../lib/source-authorization.ts";
import { captureSourceProposal } from "../../../lib/source-proposal.ts";
import { sourceProposalState } from "../../../lib/source-proposal-state.ts";
import { publishSourceProposal } from "../../../lib/source-publisher.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

const inputSchema = z
  .object({
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(4_000),
  })
  .strict();

export default defineTool({
  description:
    "After the user accepted the exact frozen preview in a prior turn, publish that unchanged proposal as one namespaced draft pull request. Input contains only the PR title and summary; repository, base, branch, paths, contents, and integrity come from trusted configuration and captured state.",
  inputSchema,
  approval: {
    request: ({ session }) => {
      const source = requireSourceConfiguration();
      return isAllowedSourceCaller(source, session.auth.current)
        ? "user-approval"
        : { type: "denied", reason: "This Slack principal cannot publish Eve source proposals." };
    },
    response: ({ responder, session }) => {
      const source = requireSourceConfiguration();
      if (!isAllowedSourceCaller(source, responder)) {
        return {
          status: "rejected" as const,
          reason: "This Slack principal cannot approve Eve source proposals.",
        };
      }
      if (
        session.initiator !== null &&
        session.initiator.principalId !== responder.principalId
      ) {
        return {
          status: "rejected" as const,
          reason: "The requester must approve this Eve source proposal.",
        };
      }
      return { status: "allowed" as const };
    },
  },
  async execute(input, ctx) {
    const source = requireSourceConfiguration();
    if (!isAllowedSourceCaller(source, ctx.session.auth.current)) {
      throw new Error("This Slack principal cannot publish Eve source proposals.");
    }
    const accepted = sourceProposalState.get();
    if (accepted === null) {
      throw new Error(
        "No exact Eve source preview is awaiting publication in this editing session.",
      );
    }
    const current = await captureSourceProposal(await ctx.getSandbox(), source);
    if (current.hash !== accepted.hash || current.diff !== accepted.diff) {
      sourceProposalState.update(() => null);
      throw new Error(
        "The Eve source files changed after preview. Run a new preview and obtain fresh user acceptance.",
      );
    }

    const token = await getToken(source.connector, {
      subject: { type: "app" },
      scopes: [
        "contents:read",
        "contents:write",
        "metadata:read",
        "pull_requests:read",
        "pull_requests:write",
      ],
      authorizationDetails: [
        {
          type: "github_app_installation",
          repositories: [source.repository],
        },
      ],
    });
    const result = await publishSourceProposal(
      new Octokit({
        auth: token,
        retry: { enabled: false },
        request: { timeout: 15_000 },
      }),
      {
        operationId: ctx.callId,
        proposal: accepted,
        source,
        summary: input.summary,
        title: input.title,
      },
    );
    sourceProposalState.update(() => null);
    return {
      ...result,
      message:
        "GitHub saved the proposal as a draft pull request. It is not merged or deployed.",
    };
  },
});
