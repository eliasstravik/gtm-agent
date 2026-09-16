import { defineTool } from "eve/tools";
import { z } from "zod";
import { slackTools, slackWriteInput } from "../lib/slack-tools";
export default defineTool({
  description: "Upload a generated file from this session's sandbox to Slack, up to 25 MB. Generate CSV/PDF/image bytes first; then pass its path. Defaults to this thread. Use the requested destination directly; ask only when it is ambiguous. On an ambiguous timeout check the conversation before retrying to avoid duplicate files.",
  inputSchema: slackWriteInput.safeExtend({ path: z.string().min(1), filename: z.string().min(1).nullish(), comment: z.string().max(3000).nullish() }),
  async execute(input, ctx) { return slackTools(ctx).upload(input, await ctx.getSandbox()); },
});
