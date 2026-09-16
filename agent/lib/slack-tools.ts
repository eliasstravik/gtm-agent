import { connectSlackCredentials } from "@vercel/connect/eve";
import { callSlackApi, resolveSlackBotToken } from "eve/channels/slack";
import type { SessionContext } from "eve/tools";
export { conversationId, threadTs, targetSchema, slackWriteInput } from "./slack-input";
import { slackIdentity, SlackOperations } from "./slack-operations";

const credentials = () => connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent");
export function slackTools(ctx: SessionContext) {
  const identity = slackIdentity(ctx.session.auth.current);
  return new SlackOperations(identity, async (operation, body) => callSlackApi({ botToken: credentials().botToken, operation, body }));
}
export const slackToken = () => resolveSlackBotToken(credentials().botToken);
