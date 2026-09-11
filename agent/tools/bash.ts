import { getToken } from "@vercel/connect";
import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { z } from "zod";
// @ts-expect-error Generated JavaScript is fetched before typecheck and build.
import { classify } from "../skills/gtm-workflow/scripts/command-permission.mjs";
import { decideApproval, recordApproved, type ReplayState } from "../lib/approval.ts";
import { getConfiguration } from "../lib/config.ts";
import { gitAuthorization, sessionNetworkPolicy } from "../lib/workflow-session.ts";

type BashState = ReplayState & { automaticCall?: string };
const replay = defineState<BashState>("gtm.bash-replay", () => ({ retries: {} }));
const schema = z.object({
  command: z.string().min(1),
  summary: z.string().trim().min(1).optional(),
  timeoutSeconds: z.number().int().min(1).max(600).default(120),
}).strict();
type Input = z.infer<typeof schema>;

const allow = (command: string) => classify(command, "/workspace") === "allow";

export default defineTool({
  description: "Run a noninteractive command in /workspace. Give a plain summary for any command that changes external state or is not explicitly allowlisted. Long hosted work must start in the background and be handed to watch_url.",
  inputSchema: schema,
  approval(ctx) {
    const input = ctx.toolInput!;
    const decision = decideApproval(input, replay.get(), allow);
    if (decision.kind === "denied") return { type: "denied", reason: decision.reason! };
    if (decision.kind === "approved") replay.update((current) => ({ ...current, retries: decision.state.retries, automaticCall: ctx.callId }));
    return decision.kind;
  },
  async execute(input, ctx) {
    if (!allow(input.command)) {
      replay.update((current) => current.automaticCall === ctx.callId
        ? { ...current, automaticCall: undefined }
        : { ...recordApproved(input, current), automaticCall: undefined });
    }
    const sandbox = await ctx.getSandbox();
    const config = getConfiguration();
    const pushing = /(?:^|[;&|\n]\s*)git\s+push(?:\s|$)/.test(input.command);
    if (pushing) {
      const token = await getToken(config.workspace.connector, {
        subject: { type: "app" }, scopes: ["contents:write", "metadata:read"],
        authorizationDetails: [{ type: "github_app_installation", repositories: [config.workspace.repository] }],
      });
      await sandbox.setNetworkPolicy(sessionNetworkPolicy(config, gitAuthorization(token)));
    }
    const timer = Symbol("timer");
    let timeout: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;
    try {
      const result = await Promise.race([
        sandbox.run({ command: input.command, abortSignal: ctx.abortSignal }),
        new Promise<typeof timer>((resolve) => { timeout = setTimeout(() => resolve(timer), input.timeoutSeconds * 1_000); }),
      ]);
      if (result === timer) {
        stopped = true;
        await sandbox.stop();
        return { exitCode: 124, stdout: "", stderr: "Command timed out; sandbox compute was stopped. Start long hosted work in the background and use watch_url.", truncated: false };
      }
      const limit = 64_000;
      return { exitCode: result.exitCode, stdout: result.stdout.slice(-limit), stderr: result.stderr.slice(-limit), truncated: result.stdout.length > limit || result.stderr.length > limit };
    } finally {
      if (timeout) clearTimeout(timeout);
      if (pushing && !stopped) await sandbox.setNetworkPolicy(sessionNetworkPolicy(config));
    }
  },
});
