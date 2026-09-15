import { defineTool } from "eve/tools";
import { z } from "zod";
import { conversationId, threadTs, slackTools } from "../lib/slack-tools";
export default defineTool({
  description: "Read requested Slack conversation history or a thread. Defaults to this thread; threadTs='' reads channel history. Continue nextCursor for older/remaining results. Requires access by both bot and requesting teammate for private conversations.",
  inputSchema: z.object({ channelId: conversationId.nullish(), threadTs: threadTs.nullish(), cursor: z.string().nullish(), limit: z.number().int().min(1).max(100).nullish() }),
  execute(input, ctx) { return slackTools(ctx).history(input); },
});
