import { defineTool } from "eve/tools";
import { z } from "zod";

import { classifySourcePath } from "../../../lib/source-paths.ts";
import { requireSourceConfiguration } from "../../../lib/source-tool.ts";

export default defineTool({
  description:
    "List the repository-relative Eve instruction and direct native schedule paths this editor may inspect or change.",
  inputSchema: z.object({}).strict(),
  async execute(_input, ctx) {
    const source = requireSourceConfiguration();
    const sandbox = await ctx.getSandbox();
    const result = await sandbox.run({
      command: `set -euo pipefail\ngit -C "${source.checkoutDirectory}" ls-files --cached --others --exclude-standard -- agent/instructions.md agent/schedules`,
      abortSignal: AbortSignal.timeout(10_000),
    });
    if (result.exitCode !== 0) {
      throw new Error("The isolated sandbox could not list the editable Eve source files.");
    }
    const paths = result.stdout
      .split("\n")
      .filter((path) => path.length > 0)
      .filter((path) => {
        try {
          classifySourcePath(path);
          return true;
        } catch {
          return false;
        }
      });
    return { paths: [...new Set(paths)] };
  },
});
