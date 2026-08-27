import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  NoSourceChangesError,
  captureSourceProposal,
} from "../../../lib/source-proposal.ts";
import { sourceProposalState } from "../../../lib/source-proposal-state.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "Capture and freeze the complete trusted diff for the current allowed Eve source edits. Return it to the parent for explicit user review; never publish in the same turn as this preview.",
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) {
    let proposal;
    try {
      proposal = await captureSourceProposal(
        await ctx.getSandbox(),
        requireSourceConfiguration(),
      );
    } catch (error) {
      if (!(error instanceof NoSourceChangesError)) throw error;
      sourceProposalState.update(() => null);
      return {
        status: "no_changes" as const,
        paths: [] as const,
        message:
          "The checkout already matches the requested state. Return this no-op result to the parent and stop; no draft pull request is needed.",
      };
    }
    sourceProposalState.update(() => proposal);
    return {
      status: "awaiting_user_acceptance" as const,
      baseSha: proposal.baseSha,
      diff: proposal.diff,
      integrityHash: proposal.hash,
      paths: proposal.paths,
      message:
        "Return this complete diff to the parent and stop. Publishing requires the user to accept this exact proposal in a later turn.",
    };
  },
});
