import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi, resolveSlackBotToken } from "eve/channels/slack";
import type { SessionContext } from "eve/tools";
import { slackWriteInput } from "./slack-input";
export { conversationId, threadTs, targetSchema, slackWriteInput } from "./slack-input";
import { destination, slackIdentity, SlackOperations } from "./slack-operations";

const credentials = () => connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent");
export function slackTools(ctx: SessionContext) {
  const identity = slackIdentity(ctx.session.auth.current);
  return new SlackOperations(identity, async (operation, body) => callSlackApi({ botToken: credentials().botToken, operation, body }));
}
export const slackToken = () => resolveSlackBotToken(credentials().botToken);

/** Current-thread delivery needs no extra prompt; other recipients get Eve's normal approval card. */
export function slackWriteApproval(ctx: { session: SessionContext["session"]; toolInput?: unknown }): "not-applicable" | "user-approval" {
  const current = slackIdentity(ctx.session.auth.current);
  const parsed = slackWriteInput.safeParse(ctx.toolInput ?? {});
  // Invalid arguments belong to normal tool validation, not a fatal approval-policy error.
  if (!parsed.success) return "not-applicable";
  const input = parsed.data;
  const target = destination(input, current);
  return input.userId || target.channelId !== current.channelId || target.threadTs !== current.threadTs ? "user-approval" : "not-applicable";
}
