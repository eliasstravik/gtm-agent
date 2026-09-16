import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { z } from "zod";
import { confirmations } from "../lib/confirmation-state";
import { consumeConfirmation } from "../lib/confirmation";

export default defineTool({
  outputSchema: bash.outputSchema,
  description: "Run a shell command. Reads, searches, scripts, builds, tests, installs, requested runs and routine updates run directly. Set destructive only when this operation deletes resources or discards existing data, such as rm, dropping a table, a hard reset or force push. Inspect an unfamiliar script before classifying its effects; shell syntax and environment variables are not destructive. Only destructive actions require confirm_action first. Supply its confirmationId only after Yes. Keep the command identical; each confirmation can execute once.",
  inputSchema: z.object({ command: z.string(), destructive: z.boolean().describe("True only for actual deletion or loss of existing resources or data; false for reads and routine work."), confirmationId: z.string().nullable() }),
  execute({ command, destructive, confirmationId }, ctx) {
    if (confirmationId || destructive) {
      confirmations.update(state => consumeConfirmation(state, confirmationId, { tool: "bash", command }));
    }
    return bash.execute({ command }, ctx);
  },
});
