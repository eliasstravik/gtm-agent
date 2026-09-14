import { timingSafeEqual } from "node:crypto";
import { defineChannel, POST } from "eve/channels";
import slack from "./slack";

/**
 * The workflows' doorbell. A run on the workflow project posts here to reach a person; the message becomes a turn in
 * Slack, in the run's own thread when it names one, else in GTM_NOTIFY_CHANNEL. The agent's instructions say what
 * to do with each kind: tell, ask (an approval to decide through the workflow's approve route), show, hand off.
 * Needs GTM_NOTIFY_SECRET (the same value the workflow project holds) and GTM_NOTIFY_CHANNEL on this project.
 */
type Notification = {
  runId: string;
  workflow: string;
  kind: "tell" | "ask" | "show" | "handoff";
  text: string;
  approval?: { token: string };
  target?: { channelId: string; threadTs?: string };
};

function authorized(request: Request): boolean {
  const secret = process.env.GTM_NOTIFY_SECRET ?? "";
  const given = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  return secret.length > 0 && given.length === secret.length && timingSafeEqual(Buffer.from(given), Buffer.from(secret));
}

export default defineChannel({
  routes: [
    POST("/gtm/notify", async (request, ctx) => {
      if (!authorized(request)) return new Response("Unauthorized", { status: 401 });
      const n = (await request.json().catch(() => null)) as Notification | null;
      if (!n?.runId || !n.kind || !n.text) return new Response("Body needs runId, kind, and text", { status: 400 });
      const channelId = n.target?.channelId ?? process.env.GTM_NOTIFY_CHANNEL;
      if (!channelId) return new Response("Set GTM_NOTIFY_CHANNEL on the agent project", { status: 503 });
      const slug = n.workflow.split("//").pop() ?? n.workflow;
      const lines = [
        `[workflow ${n.kind}] ${slug}, run ${n.runId}`,
        n.text,
        n.approval ? `Approval token: ${n.approval.token}` : "",
      ].filter(Boolean);
      ctx.waitUntil(
        ctx.to(slack, { channelId, ...(n.target?.threadTs && { threadTs: n.target.threadTs }) }).send(lines.join("\n"), {
          auth: { authenticator: "gtm-workflow", principalType: "service", principalId: n.runId, attributes: { workflow: slug, kind: n.kind } },
        }),
      );
      return Response.json({ accepted: true });
    }),
  ],
});
