import { defineTool } from "eve/tools";
import { bash } from "eve/tools/bash";
import { z } from "zod";
import { confirmations } from "../lib/confirmation-state";
import { consumeConfirmation, isReadOnlyCommand } from "../lib/confirmation";

export default defineTool({
  outputSchema: bash.outputSchema,
  description: "Run a shell command. Simple read-only commands can run directly. Other commands, including scripts, require confirm_action first because they can change or destroy resources. Supply its confirmationId only after Yes. Keep the command identical; each confirmation can execute once.",
  inputSchema: z.object({ command: z.string(), confirmationId: z.string().nullable() }),
  execute({ command, confirmationId }, ctx) {
    if (confirmationId || !isReadOnlyCommand(command)) {
      confirmations.update(state => consumeConfirmation(state, confirmationId, { tool: "bash", command }));
    }
    return bash.execute({ command }, ctx);
  },
});
