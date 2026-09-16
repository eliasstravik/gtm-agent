import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { z } from "zod";
import { confirmations } from "../lib/confirmation-state";
import { consumeConfirmation } from "../lib/confirmation";

export default defineTool({
  outputSchema: writeFile.outputSchema,
  description: `${writeFile.description}\nNew files and routine edits to existing code, configuration and documents run directly. Set destructive only for discarding existing data or replacing a resource wholesale with loss of its contents; obtain Yes through confirm_action for those operations. Supply its confirmationId with the exact path and content. Each confirmation executes once.`,
  inputSchema: z.object({ filePath: z.string(), content: z.string(), destructive: z.boolean().describe("True only when discarding existing data; an ordinary edit is false even when the file already exists."), confirmationId: z.string().nullable() }),
  async *execute({ filePath, content, destructive, confirmationId }, ctx) {
    if (confirmationId || destructive) {
      confirmations.update(state => consumeConfirmation(state, confirmationId, { tool: "write_file", filePath, content }));
    }
    const result = await writeFile.execute({ filePath, content }, ctx);
    if (Symbol.asyncIterator in result) { for await (const value of result) yield value; }
    else yield result;
  },
});
