import { defineWorkflowTool } from "eve/tools";
import { sleep } from "workflow";
import { z } from "zod";
import { getConfiguration } from "../lib/config.ts";

const value = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const schema = z.object({
  path: z.string(),
  predicate: z.object({ field: z.string().min(1), equals: value }).strict(),
  timeoutSeconds: z.number().int().min(10).max(3_600).default(600),
}).strict();

function allowed(path: string): boolean {
  return path === "/api/deployment" || /^\/api\/runs\/[A-Za-z0-9_-]+$/.test(path);
}

async function getJson(path: string): Promise<Record<string, unknown>> {
  "use step";
  if (!allowed(path)) throw new Error("watch_url only accepts /api/deployment or one /api/runs/<id> path.");
  const config = getConfiguration();
  const response = await fetch(new URL(path, config.workflow.url), {
    method: "GET",
    headers: { authorization: `Bearer ${config.workflow.runSecret}` },
  });
  if (!response.ok) throw new Error(`Workflow host returned ${response.status}.`);
  return await response.json() as Record<string, unknown>;
}

function fieldAt(input: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) =>
    value && typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined, input);
}

export default defineWorkflowTool({
  description: "Watch one hosted GTM run or deployment in the background until a JSON field equals the expected value. The completed task wakes the original thread.",
  execution: "background",
  inputSchema: schema,
  async execute(input) {
    "use workflow";
    if (!allowed(input.path)) throw new Error("Unsupported watch path.");
    const attempts = Math.ceil(input.timeoutSeconds / 10);
    let latest: Record<string, unknown> = {};
    for (let attempt = 0; attempt < attempts; attempt++) {
      latest = await getJson(input.path);
      if (fieldAt(latest, input.predicate.field) === input.predicate.equals) return { matched: true, response: latest };
      await sleep("10s");
    }
    return { matched: false, timedOut: true, response: latest };
  },
});
