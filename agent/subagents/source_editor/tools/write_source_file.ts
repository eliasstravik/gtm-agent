import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  assertSourceWrite,
  sourceAbsolutePath,
} from "../../../lib/source-paths.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "Create one new direct agent/schedules/*.md or *.ts file. Existing files and agent instructions must use edit_source_file.",
  inputSchema: z
    .object({
      path: z.string().min(1).max(180),
      content: z.string().min(1).max(16_384),
    })
    .strict(),
  async execute(input, ctx) {
    const source = requireSourceConfiguration();
    const kind = assertSourceWrite(input.path, input.content);
    if (kind !== "schedule") {
      throw new Error("write_source_file may create only a new native schedule.");
    }
    const path = sourceAbsolutePath(source.checkoutDirectory, input.path);
    const sandbox = await ctx.getSandbox();
    if ((await sandbox.readTextFile({ path })) !== null) {
      throw new Error(`Eve source file already exists: ${input.path}.`);
    }
    await sandbox.writeTextFile({ path, content: input.content });
    return { path: input.path, created: true };
  },
});
