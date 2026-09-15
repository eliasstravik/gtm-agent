import { z } from "zod";

export const conversationId = z.string().regex(/^[CGD][A-Z0-9]+$/);
export const threadTs = z.string().regex(/^(\d+\.\d+)?$/).describe("Reply thread timestamp; empty string posts/reads at channel level.");
export const targetSchema = {
  channelId: conversationId.nullish().describe("Defaults to the current Slack conversation."),
  threadTs: threadTs.nullish().describe("Defaults to the current thread when staying here; otherwise top-level."),
  userId: z.string().regex(/^[UW][A-Z0-9]+$/).nullish().describe("Only for starting a different DM with a mentioned person. Use null for replies or files here. Never combine with channelId."),
};
export const slackWriteInput = z.object(targetSchema).refine(
  input => !(input.channelId && input.userId),
  "Choose channelId or userId, not both. For this conversation use userId=null.",
);
