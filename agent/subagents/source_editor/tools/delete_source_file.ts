import { defineTool } from "eve/tools";
import { z } from "zod";

import {
  assertSourceDeletion,
  sourceAbsolutePath,
} from "../../../lib/source-paths.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "Delete one existing native schedule file when the user explicitly requested its removal. Agent instructions cannot be deleted.",
  inputSchema: z.object({ path: z.string().min(1).max(180) }).strict(),
  async execute(input, ctx) {
    assertSourceDeletion(input.path);
    const source = requireSourceConfiguration();
    const path = sourceAbsolutePath(source.checkoutDirectory, input.path);
    const sandbox = await ctx.getSandbox();
    if ((await sandbox.readTextFile({ path })) === null) {
      return {
        status: "already_absent" as const,
        path: input.path,
        deleted: false,
        alreadyAbsent: true,
      };
    }
    try {
      await sandbox.removePath({ path });
    } catch {
      throw new Error("The isolated sandbox could not delete the selected schedule.");
    }
    return {
      status: "deleted" as const,
      path: input.path,
      deleted: true,
      alreadyAbsent: false,
    };
  },
});
