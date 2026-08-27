import { defineState } from "eve/context";

import type { CapturedSourceProposal } from "./source-proposal.ts";

export const sourceProposalState = defineState<CapturedSourceProposal | null>(
  "gtm-agent.source-proposal",
  () => null,
);
