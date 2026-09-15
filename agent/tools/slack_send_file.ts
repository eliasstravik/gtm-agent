import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackTools, slackWriteApproval, targetSchema } from "../lib/slack-tools";
export default defineTool({
  description: "Upload a generated file from this session's sandbox to Slack, up to 25 MB. Generate CSV/PDF/image bytes first; then pass its path. Defaults to this thread. Other destinations require approval. On an ambiguous timeout check the conversation before retrying to avoid duplicate files.",
  inputSchema: z.object({ ...targetSchema, path: z.string().min(1), filename: z.string().min(1).optional(), comment: z.string().max(3000).optional() }),
  approval: slackWriteApproval,
  async execute(input, ctx) { return slackTools(ctx).upload(input, await ctx.getSandbox()); },
});
