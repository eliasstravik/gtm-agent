import { defineTool } from "eve/tools";
import { z } from "zod";
import { conversationId, slackTools, slackToken } from "../lib/slack-tools";
export default defineTool({
  description: "Download a specific Slack file into /workspace/attachments for analysis, up to 25 MB. Supply its file ID and conversation where shared; defaults to here. Newly attached files are already staged by Eve, so read those existing paths directly.",
  inputSchema: z.object({ fileId: z.string().regex(/^F[A-Z0-9]+$/), channelId: conversationId.nullish() }),
  async execute(input, ctx) { return slackTools(ctx).download(input, await ctx.getSandbox(), slackToken); },
});
