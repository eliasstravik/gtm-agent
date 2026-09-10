import { defineWorkflowTool } from "eve/tools";
import { sleep } from "workflow";
import { z } from "zod";
import { checkDeployment, watchClock } from "../lib/workflow-watch.ts";
import { pollUntil } from "../lib/poll.ts";
import { admitWatch } from "../lib/watch-admission.ts";

export default defineWorkflowTool({
  description: "After a confirmed save, watch that exact version and its tables for ten minutes. Returns immediately with a durable task receipt; completion wakes this same Slack session. On live, propose the separate one-row smoke approval. On timeout, investigate the saved version with gtm check and npm run build in the sandbox. Never starts a run.",
  execution: "background",
  approval: admitWatch,
  inputSchema: z.object({
    expectedHead: z.string().regex(/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/),
    workflowPath: z.string().regex(/^(?:[a-z0-9]+(?:-[a-z0-9]+)*\/)*[a-z0-9]+(?:-[a-z0-9]+)*$/).max(240),
  }).strict(),
  async execute(input) {
    "use workflow";
    const result = await pollUntil({
      read: () => checkDeployment(input.expectedHead, input.workflowPath),
      ready: result => result.status === "live" && result.preflight?.ok === true,
      now: watchClock, pause: () => sleep("10s"), timeoutMs: 10 * 60_000,
    });
    if (result) {
        return { ...input, status: "live", message: "Live.", next: "Call the diagram action with caption Live. so it posts now with the Diagram link. Then preview one row and propose a separate smoke run approval with every paid call and total cost." };
    }
    return { ...input, status: "timed_out", message: "Not live after 10 minutes. Nothing ran. I'll look into it.", next: "Run gtm check and npm run build on this exact saved version in the sandbox, then report the first failure in plain words. Do not start a run." };
  },
});
