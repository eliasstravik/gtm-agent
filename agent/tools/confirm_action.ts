import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { confirmationQuestion } from "../lib/confirmation";

export default defineWorkflowTool({
  description: "Use ONLY for destructive actions: deleting resources or discarding existing data, including destructive overwrites and resets. Never ask for confirmation for reads, searches, routine edits, builds, tests, installs, requested runs, deployments or requested messages. Name the action, target, and consequence in direct language. Always ask even when the original request names the destructive action. No or no response authorizes nothing. After Yes, pass confirmationId with the unchanged operation to bash or write_file.",
  inputSchema: z.object({
    action: z.string().min(1), target: z.string().min(1), consequence: z.string().min(1),
    operation: z.discriminatedUnion("tool", [
      z.object({ tool: z.literal("bash"), command: z.string().min(1) }),
      z.object({ tool: z.literal("write_file"), filePath: z.string().min(1), content: z.string() }),
    ]),
  }),
  async execute(input, ctx) {
    "use workflow";
    const answer = await ctx.ask(confirmationQuestion(input, ctx.callId));
    return { ...input, confirmationId: ctx.callId, confirmed: answer.optionId === `${ctx.callId}:yes` };
  },
});
