import { timingSafeEqual } from "node:crypto";
import { connectSlackCredentials } from "@vercel/connect/eve";
import { defineChannel, GET, POST } from "eve/channels";
import { extractBearerToken, verifyVercelOidc } from "eve/channels/auth";
import { callSlackApi, resolveSlackBotToken } from "eve/channels/slack";
import { asBlocksMessage, markdownBlock, MAX_BLOCKS } from "../lib/blocks";

/**
 * The workflows' doorbell. A run on the workflow project posts here to reach a person, and the text goes straight to
 * Slack with this agent's bot token: no model runs, so a run can post as often as it likes. tell and show are plain
 * posts. ask and handoff post a message whose thread the Slack channel watches (see channels/slack.ts): a person's
 * reply there starts a turn, and the instructions say how to decide the approval or steer the run. Every post lands
 * top-level in the run's channel, else in GTM_NOTIFY_CHANNEL; there is no thread option, whatever a caller sends.
 * A caller may add Block Kit `blocks` (buttons, fields); the text stays the plain fallback, and a refused block set
 * posts the text alone. Needs GTM_NOTIFY_SECRET (the same value the workflow project holds) and GTM_NOTIFY_CHANNEL.
 */
type Notification = {
  runId: string;
  workflow: string;
  kind: "tell" | "ask" | "show" | "handoff";
  text: string;
  blocks?: unknown[];
  approval?: { token: string };
  target?: { channelId: string };
};

const { botToken } = connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent");

function authorized(request: Request): boolean {
  const secret = process.env.GTM_NOTIFY_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length > 0 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** The lines around the text; only ask and handoff carry them, since only they expect a reply. */
function frame(n: Notification): { header?: string; footer?: string } {
  if (n.kind === "tell" || n.kind === "show") return {};
  const slug = n.workflow.split("//").pop() ?? n.workflow;
  const footer = n.kind === "ask" ? `Reply yes or no in this thread. Approval token: ${n.approval?.token ?? "none"}` : "Reply in this thread to steer this run.";
  return { header: `[workflow ${n.kind}] ${slug}, run ${n.runId}`, footer };
}

/** The marker the instructions key on is the first line, in the text and in the blocks alike. */
function renderText(n: Notification): string {
  const { header, footer } = frame(n);
  return [header, n.text, footer].filter((line): line is string => Boolean(line)).join("\n");
}

/** The caller's blocks between the ask or handoff frame, so the marker stays visible on a rich post; null without blocks. */
function renderBlocks(n: Notification): unknown[] | null {
  if (n.blocks === undefined) return null;
  const given = asBlocksMessage({ text: n.text, blocks: n.blocks });
  if (!given) return null;
  const { header, footer } = frame(n);
  const blocks = [...(header ? [markdownBlock(header)] : []), ...given.blocks, ...(footer ? [markdownBlock(footer)] : [])];
  return blocks.length <= MAX_BLOCKS ? blocks : null;
}

export default defineChannel({
  routes: [
    // Operator-only live grant check. Returns no token, workspace messages, or private download URLs.
    GET("/gtm/slack-health", async (request) => {
      const oidc = await verifyVercelOidc(extractBearerToken(request.headers.get("authorization")));
      if (!authorized(request) && !oidc.ok) return new Response("Unauthorized", { status: 401 });
      try {
        const currentToken = connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent", {}, { forceRefresh: true }).botToken;
        const response = await fetch("https://slack.com/api/auth.test", {
          method: "POST", headers: { authorization: `Bearer ${await resolveSlackBotToken(currentToken)}` },
          signal: AbortSignal.timeout(15000),
        });
        const body = await response.json();
        return Response.json({ ok: response.ok && body.ok === true, scopes: (response.headers.get("x-oauth-scopes") ?? "").split(",").filter(Boolean), ...(body.ok ? {} : { error: body.error }) }, { status: response.ok && body.ok ? 200 : 502 });
      } catch { return Response.json({ ok: false, error: "slack_auth_check_failed" }, { status: 502 }); }
    }),
    POST("/gtm/notify", async (request) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const n = (await request.json().catch(() => null)) as Notification | null;
      if (!n?.runId || !n.kind || !n.text) return new Response("Body needs runId, kind, and text", { status: 400 });
      const channel = n.target?.channelId ?? process.env.GTM_NOTIFY_CHANNEL;
      if (!channel) return new Response("Set GTM_NOTIFY_CHANNEL on the agent project", { status: 503 });
      const text = renderText(n);
      const blocks = renderBlocks(n);
      const post = (body: Record<string, unknown>) => callSlackApi({ botToken, operation: "chat.postMessage", body: { channel, text, ...body } });
      let res = blocks ? await post({ blocks }) : await post({});
      let blocksError: string | null = null;
      if (!res.ok && blocks) {
        blocksError = String(res.error);
        res = await post({});
      }
      // A refused post is the caller's to retry: the workflow's notify step retries twice, which covers a rate limit.
      if (!res.ok) return Response.json({ accepted: false, error: String(res.error) }, { status: 502 });
      return Response.json({ accepted: true, ts: (res as { ts?: string }).ts ?? null, ...(blocksError && { blocksError }) });
    }),
  ],
});
