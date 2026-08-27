import { defineTool } from "eve/tools";
import { z } from "zod";

import { sourceAbsolutePath } from "../../../lib/source-paths.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "Read one allowed Eve source file using its repository-relative path from list_source_files.",
  inputSchema: z.object({ path: z.string().min(1).max(180) }).strict(),
  async execute(input, ctx) {
    const source = requireSourceConfiguration();
    const path = sourceAbsolutePath(source.checkoutDirectory, input.path);
    const content = await (await ctx.getSandbox()).readTextFile({ path });
    if (content === null) {
      return { status: "not_found" as const, path: input.path };
    }
    return { status: "found" as const, path: input.path, content };
  },
});
