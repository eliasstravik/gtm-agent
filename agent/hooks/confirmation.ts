import { defineHook } from "eve/hooks";
import { z } from "zod";
import { confirmations } from "../lib/confirmation-state";
import { recordConfirmation } from "../lib/confirmation";

const resultSchema = z.object({
  confirmationId: z.string(), confirmed: z.boolean(), action: z.string(), target: z.string(), consequence: z.string(),
  operation: z.discriminatedUnion("tool", [
    z.object({ tool: z.literal("bash"), command: z.string() }),
    z.object({ tool: z.literal("write_file"), filePath: z.string(), content: z.string() }),
  ]),
});

export default defineHook({
  events: {
    "actions.requested"(event) {
      for (const action of event.data.actions) {
        if ("toolName" in action && action.toolName === "confirm_action") {
          confirmations.update(state => ({ ...state, pendingCallId: action.callId, grants: {} }));
        }
      }
    },
    "action.result"(event) {
      const result = event.data.result;
      if (result.kind !== "tool-result" || result.toolName !== "confirm_action" || result.isError) return;
      const parsed = resultSchema.safeParse(result.output);
      if (parsed.success && parsed.data.confirmationId === result.callId) {
        confirmations.update(state => recordConfirmation(state, parsed.data));
      }
    },
  },
});
