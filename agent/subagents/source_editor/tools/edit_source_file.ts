import { defineTool } from "eve/tools";
import { z } from "zod";

import { applyExactSourceEdits } from "../../../lib/source-editing.ts";
import {
  assertSourceWrite,
  sourceAbsolutePath,
} from "../../../lib/source-paths.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "Edit one allowed Eve instructions or native schedule file through unique, non-overlapping exact-text replacements.",
  inputSchema: z
    .object({
      path: z.string().min(1).max(180),
      edits: z
        .array(
          z
            .object({
              oldText: z.string().min(1).max(16_384),
              newText: z.string().max(16_384),
            })
            .strict(),
        )
        .min(1)
        .max(20),
    })
    .strict(),
  async execute(input, ctx) {
    const source = requireSourceConfiguration();
    const path = sourceAbsolutePath(source.checkoutDirectory, input.path);
    const sandbox = await ctx.getSandbox();
    const current = await sandbox.readTextFile({ path });
    if (current === null) {
      throw new Error(`Eve source file not found: ${input.path}.`);
    }
    const content = applyExactSourceEdits(current, input.edits);
    assertSourceWrite(input.path, content);
    await sandbox.writeTextFile({ path, content });
    return { path: input.path, replacements: input.edits.length };
  },
});
