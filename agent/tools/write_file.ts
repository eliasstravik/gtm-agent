import { defineTool } from "eve/tools";
import { writeFile } from "eve/tools/write_file";
import { z } from "zod";
import { confirmations } from "../lib/confirmation-state";
import { consumeConfirmation } from "../lib/confirmation";

export default defineTool({
  outputSchema: writeFile.outputSchema,
  description: `${writeFile.description}\nCreating a new file needs no destructive confirmation. Before replacing an existing file, obtain Yes through confirm_action. Supply its confirmationId with the exact path and content. Each confirmation executes once.`,
  inputSchema: z.object({ filePath: z.string(), content: z.string(), confirmationId: z.string().nullable() }),
  async *execute({ filePath, content, confirmationId }, ctx) {
    const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
    const path = filePath.startsWith("$HOME/") ? `"$HOME"/${quote(filePath.slice(6))}` : quote(filePath);
    const exists = await (await ctx.getSandbox()).run({ command: `test -e ${path} || test -L ${path}` });
    if (exists.exitCode !== 0 && exists.exitCode !== 1) throw new Error("Could not check the existing file. No write performed.");
    if (confirmationId || exists.exitCode === 0) {
      confirmations.update(state => consumeConfirmation(state, confirmationId, { tool: "write_file", filePath, content }));
    }
    const result = await writeFile.execute({ filePath, content }, ctx);
    if (Symbol.asyncIterator in result) { for await (const value of result) yield value; }
    else yield result;
  },
});
