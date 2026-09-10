import { z } from "zod";

const text = z.string().max(300);
const id = z.string().regex(/^[A-Za-z0-9_-]+$/).max(100);
const paidCall = z.object({ provider: text, model: text.optional(), unitCostUsd: z.number().nonnegative().optional() });
export const draftGraphSchema = z.object({
  workflow: z.object({ path: text, label: text, runs: text, kind: text, table: text.nullable(), summary: text.optional() }),
  nodes: z.array(z.object({
    id, kind: z.enum(["start", "step", "decision", "wait", "save", "end"]), label: text,
    step: text.optional(), provider: text.optional(), model: text.optional(), order: z.number().int().positive().optional(),
    paidCalls: z.array(paidCall).max(20).optional(), unitCostUsd: z.number().nonnegative().optional(),
    group: id.optional(), status: z.enum(["pending", "active", "done", "failed"]).optional(),
    childWorkflow: text.optional(),
  })).min(1).max(100),
  edges: z.array(z.object({ from: id, to: id, label: text.optional(), back: z.boolean().optional() })).max(200),
  groups: z.array(z.object({ id, kind: z.enum(["loop", "parallel"]), label: text, parent: id.optional() })).max(30),
}).superRefine((graph, ctx) => {
  const ids = new Set(graph.nodes.map(node => node.id));
  const groups = new Set(graph.groups.map(group => group.id));
  if (ids.size !== graph.nodes.length || groups.size !== graph.groups.length ||
      graph.nodes.some(node => node.group && !groups.has(node.group)) ||
      graph.edges.some(edge => !ids.has(edge.from) || !ids.has(edge.to))) {
    ctx.addIssue({ code: "custom", message: "The draft graph has duplicate or missing references." });
  }
  for (const group of graph.groups) {
    const seen = new Set([group.id]);
    let parent = group.parent;
    while (parent) {
      if (seen.has(parent) || !groups.has(parent)) { ctx.addIssue({ code: "custom", message: "The draft has an invalid group hierarchy." }); break; }
      seen.add(parent);
      parent = graph.groups.find(item => item.id === parent)?.parent;
    }
  }
});
