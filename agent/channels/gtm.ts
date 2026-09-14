import { timingSafeEqual } from "node:crypto";
import { connectSlackCredentials } from "@vercel/connect/eve";
import { defineChannel, POST } from "eve/channels";
import { callSlackApi } from "eve/channels/slack";

/**
 * The workflows' doorbell. A run on the workflow project posts here to reach a person, and the text goes straight to
 * Slack with this agent's bot token: no model runs, so a run can post as often as it likes. tell and show are plain
 * posts. ask and handoff post a message whose thread the Slack channel watches (see channels/slack.ts): a person's
 * reply there starts a turn, and the instructions say how to decide the approval or steer the run. Every post lands
 * top-level in the run's channel, else in GTM_NOTIFY_CHANNEL; there is no thread option, whatever a caller sends.
 * Needs GTM_NOTIFY_SECRET (the same value the workflow project holds) and GTM_NOTIFY_CHANNEL on this project.
 */
type Notification = {
  runId: string;
  workflow: string;
  kind: "tell" | "ask" | "show" | "handoff";
  text: string;
  approval?: { token: string };
  target?: { channelId: string };
};

const { botToken } = connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent");

function authorized(request: Request): boolean {
  const secret = process.env.GTM_NOTIFY_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length > 0 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

/** The marker the instructions key on; only ask and handoff carry it, since only they expect a reply. */
function renderNotification(n: Notification): string {
  const slug = n.workflow.split("//").pop() ?? n.workflow;
  if (n.kind === "tell" || n.kind === "show") return n.text;
  const footer = n.kind === "ask" ? `Reply yes or no in this thread. Approval token: ${n.approval?.token ?? "none"}` : "Reply in this thread to steer this run.";
  return [`[workflow ${n.kind}] ${slug}, run ${n.runId}`, n.text, footer].join("\n");
}

export default defineChannel({
  routes: [
    POST("/gtm/notify", async (request) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const n = (await request.json().catch(() => null)) as Notification | null;
      if (!n?.runId || !n.kind || !n.text) return new Response("Body needs runId, kind, and text", { status: 400 });
      const channel = n.target?.channelId ?? process.env.GTM_NOTIFY_CHANNEL;
      if (!channel) return new Response("Set GTM_NOTIFY_CHANNEL on the agent project", { status: 503 });
      const res = await callSlackApi({
        botToken,
        operation: "chat.postMessage",
        body: { channel, text: renderNotification(n) },
      });
      // A refused post is the caller's to retry: the workflow's notify step retries twice, which covers a rate limit.
      if (!res.ok) return Response.json({ accepted: false, error: String(res.error) }, { status: 502 });
      return Response.json({ accepted: true, ts: (res as { ts?: string }).ts ?? null });
    }),
  ],
});
