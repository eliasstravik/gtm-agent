import { defineTool } from "eve/tools";
import type { Approval } from "eve/tools/approval";
import { z } from "zod";

import { getConfiguration } from "../lib/config.ts";
import { WorkflowControl } from "../lib/workflow-control.ts";

const inputSchema = z
  .object({
    action: z
      .enum(["preview", "deploy"])
      .describe("Preview validates without deployment; deploy applies migrations and publishes production."),
    expectedHead: z
      .string()
      .regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i)
      .describe("Exact committed workspace HEAD being previewed or deployed."),
    summary: z
      .string()
      .min(1)
      .max(500)
      .describe("Deployment scope shown in the native approval request."),
  })
  .strict();

type Input = z.infer<typeof inputSchema>;

const deployApproval: Approval<Input> = ({ toolInput }) =>
  toolInput?.action === "deploy" ? "user-approval" : "not-applicable";

export default defineTool({
  description:
    "Preview or deploy the connected workspace's exact committed workflows/ project to its fixed Vercel production project. Preview is read-only. Deploy is approval-gated, applies committed Turso migrations, uploads tracked source only, and waits for READY.",
  inputSchema,
  approval: deployApproval,
  async execute(input, ctx) {
    const configuration = getConfiguration();
    if (configuration.workspace === null || configuration.workflowControl === null) {
      return {
        status: "setup_required" as const,
        message:
          "Trusted Vercel workflow control is not fully configured for this connected workspace.",
      };
    }
    const sandbox = await ctx.getSandbox();
    const control = new WorkflowControl(
      configuration.workflowControl,
      configuration.workspace,
    );
    return input.action === "preview"
      ? control.previewDeployment(input.expectedHead, sandbox)
      : control.deploy(input.expectedHead, sandbox);
  },
});
