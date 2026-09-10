import { defineTool } from "eve/tools";
import { z } from "zod";
import { getConfiguration } from "../lib/config.ts";
import { draftGraphSchema } from "../lib/draft-diagram.ts";
import { renderDraft } from "../lib/draft-renderer.mjs";
import { tursoDashboardUrl, vercelObservabilityUrl } from "../lib/diagram-link.ts";

export default defineTool({
  description: "Before each save approval, upload the scratch draft's picture and Data/Runs links in this same Slack thread. First create draft-diagram.json using gtm diagram <slug> --format json in the fixed scratch workflows directory. Supply a one-line caption describing the workflow or what changed. This performs no paid call or durable workspace write.",
  inputSchema: z.object({ caption: z.string().trim().min(1).max(500) }).strict(),
  toModelOutput: () => ({ type: "json", value: { status: "rendered", message: "The Slack channel posts the draft picture, caption, and Data/Runs links before the approval. Do not repeat them. New tables and credentials remain pending until deployed preflight succeeds." } }),
  async execute(input, ctx) {
    const configuration = getConfiguration();
    const workspace = configuration.workspace;
    if (!workspace) throw new Error("A connected workspace is required to render a draft.");
    const sandbox = await ctx.getSandbox();
    const location = await sandbox.run({ command: `set -euo pipefail\nroot="$HOME/.gtm-scratch/${workspace.repo}/workflows"\nnode --input-type=module -e 'import {realpathSync,statSync} from "node:fs"; const root=realpathSync(process.argv[1]); const files=["draft-diagram.json","package.json"].map(name=>{ const path=realpathSync(root+"/"+name); if(!path.startsWith(root+"/") || statSync(path).size>1000000) throw Error("Invalid draft file"); return path; }); console.log(JSON.stringify(files));' "$root"`, abortSignal: AbortSignal.timeout(20_000) });
    if (location.exitCode !== 0) throw new Error("Create the bounded draft graph in the scratch workflows directory first.");
    const [graphPath, packagePath] = z.tuple([z.string(), z.string()]).parse(JSON.parse(location.stdout.trim()));
    const graph = draftGraphSchema.parse(JSON.parse(z.string().parse(await sandbox.readTextFile({ path: graphPath }))));
    const metadata = JSON.parse(z.string().parse(await sandbox.readTextFile({ path: packagePath })));
    const vercel = z.object({ team: z.string(), project: z.string() }).safeParse(metadata?.gtm?.vercel);
    const links = {
      data: tursoDashboardUrl(configuration.workflow?.databaseUrl ?? null),
      runs: vercel.success ? vercelObservabilityUrl(vercel.data.team, vercel.data.project) : "https://vercel.com",
    };
    const font = await ctx.getSkill("gtm-workflow").file("templates/assets/fonts/Inter-Regular.ttf").bytes();
    const png = renderDraft(graph, font);
    if (png.byteLength > 4 * 1024 * 1024) throw new Error("The draft picture is too large to post.");
    return { action: "draft-diagram" as const, caption: input.caption, png: png.toString("base64"), links };
  },
});
