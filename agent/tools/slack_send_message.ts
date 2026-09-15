import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackTools, slackWriteApproval, slackWriteInput } from "../lib/slack-tools";
export default defineTool({
  description: "Send a requested Slack message to a channel/thread or DM a mentioned user. Normal answers are delivered automatically; use this for an explicit additional message. Other destinations require approval. For interactive workflow notifications invite the bot first so it receives replies.",
  inputSchema: slackWriteInput.safeExtend({ text: z.string().min(1).max(12000) }),
  approval: slackWriteApproval,
  execute(input, ctx) { return slackTools(ctx).send(input, ctx.session.turn.id); },
});
