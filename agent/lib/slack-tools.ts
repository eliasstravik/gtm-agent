import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi, resolveSlackBotToken } from "eve/channels/slack";
import type { SessionContext } from "eve/tools";
import { z } from "zod";
import { destination, slackIdentity, SlackOperations } from "./slack-operations";

const credentials = () => connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent");
export const conversationId = z.string().regex(/^[CGD][A-Z0-9]+$/);
export const threadTs = z.string().regex(/^(\d+\.\d+)?$/).describe("Reply thread timestamp; empty string posts/reads at channel level.");
export const targetSchema = {
  channelId: conversationId.optional().describe("Defaults to the current Slack conversation."),
  threadTs: threadTs.optional().describe("Defaults to the current thread when staying here; otherwise top-level."),
  userId: z.string().regex(/^[UW][A-Z0-9]+$/).optional().describe("Start a DM with this Slack user ID, taken from an @mention. Omit channelId."),
};
export function slackTools(ctx: SessionContext) {
  const identity = slackIdentity(ctx.session.auth.current);
  return new SlackOperations(identity, async (operation, body) => callSlackApi({ botToken: credentials().botToken, operation, body }));
}
export const slackToken = () => resolveSlackBotToken(credentials().botToken);

/** Current-thread delivery needs no extra prompt; other recipients get Eve's normal approval card. */
export function slackWriteApproval(ctx: { session: SessionContext["session"]; toolInput?: unknown }): "not-applicable" | "user-approval" {
  const current = slackIdentity(ctx.session.auth.current);
  const input = z.object(targetSchema).parse(ctx.toolInput ?? {});
  const target = destination(input, current);
  return input.userId || target.channelId !== current.channelId || target.threadTs !== current.threadTs ? "user-approval" : "not-applicable";
}
