import { defineTool } from "eve/tools";
import { BASH_INPUT_SCHEMA, BASH_OUTPUT_SCHEMA } from "eve/tools/bash";
import { runBoundedBash } from "../lib/bounded-bash.ts";

export default defineTool({
  description: "Run a noninteractive shell command in the shared workspace. Commands have a fixed two-minute deadline; on timeout the sandbox compute is stopped and control returns here. Report a timeout to the user and resolve its cause before retrying. Use db:generate for migrations and resolve its structured input-required result before continuing.",
  inputSchema: BASH_INPUT_SCHEMA,
  outputSchema: BASH_OUTPUT_SCHEMA,
  async execute(input, ctx) {
    return runBoundedBash(await ctx.getSandbox(), input.command);
  },
});
