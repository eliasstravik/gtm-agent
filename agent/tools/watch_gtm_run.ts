import { defineWorkflowTool } from "eve/tools";
import { sleep } from "workflow";
import { z } from "zod";
import { checkRun } from "../lib/workflow-watch.ts";
import { admitWatch } from "../lib/watch-admission.ts";

export default defineWorkflowTool({
  description: "Watch an existing hosted run in this Slack session until a checkpoint, completion, failure, stop, timeout, or cancellation. A durable task wakes the same thread without polling requests from the user. At a checkpoint propose the continuation approval; after an accepted continuation or trigger start another watch.",
  execution: "background",
  approval: admitWatch,
  inputSchema: z.object({
    runKey: z.string().regex(/^[0-9a-f]{32}$/),
    afterCheckpoint: z.string().max(500).nullable().optional().describe("Copy checkpointIdentity from the previous watch when rearming after a continuation; prevents reporting the same pause again."),
  }).strict(),
  async execute(input) {
    "use workflow";
    for (;;) {
      const run = await checkRun(input.runKey);
      const checkpointIdentity = `${run.completed}:${run.approval?.stage ?? ""}`;
      if (["completed", "failed", "cancelled", "stopped", "timed_out"].includes(run.status)) return run;
      if (run.status === "waiting" && run.approval !== null && run.approval.approved === undefined && checkpointIdentity !== input.afterCheckpoint) {
        return { ...run, checkpointIdentity, next: "Post a short checkpoint report and the workflow picture, then request the continuation approval with remaining calls, effects, and total cost. Leave it paused until approved. After continuation, rearm with this checkpointIdentity as afterCheckpoint." };
      }
      await sleep("10s");
    }
  },
});
