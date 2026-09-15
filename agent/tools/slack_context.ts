import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackIdentity } from "../lib/slack-operations";
export default defineTool({
  description: "Get this Slack conversation's channel, thread, workspace and requesting user IDs. Use for 'here', 'this thread', or 'me'; never ask the user to look up these IDs.",
  inputSchema: z.object({}),
  execute(_input, ctx) { return slackIdentity(ctx.session.auth.current); },
});
