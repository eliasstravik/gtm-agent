import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackTools } from "../lib/slack-tools";
export default defineTool({
  description: "List accessible Slack conversations and resolve a channel name. Query filters one page; continue nextCursor until found or exhausted. Private conversations require your membership. Use @mentions for people; this is not a user directory or workspace-wide message search.",
  inputSchema: z.object({ query: z.string().optional(), cursor: z.string().optional(), limit: z.number().int().min(1).max(100).optional(), types: z.enum(["public_channel", "private_channel", "im", "mpim"]).optional() }),
  execute(input, ctx) { return slackTools(ctx).find(input); },
});
