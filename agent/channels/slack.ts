import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, loadThreadContextMessages, slackChannel, type SlackInboundMessageContext, type SlackMessage } from "eve/channels/slack";

// SLACK_CONNECTOR is provisioned by the "Deploy with Vercel" button; the fallback is the CLI-created connector's UID.
// One message is one turn: app_mention in channels, message.im in DMs, unmentioned replies in a thread this agent owns,
// and unmentioned replies under a message this agent posted itself, which is how a workflow's ask or handoff
// (posted by channels/gtm.ts without a session) gets its answer.
export default slackChannel({
  credentials: connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent"),
  // Inject the thread since this agent's last reply below the root, so a fresh session under a workflow's post sees
  // that post (a bot-authored root), and an owned thread does not re-inject what its history already holds.
  threadContext: { since: (m) => m.isMe && m.ts !== m.threadTs },
  onAppMention: (ctx, m) => (m.author && !m.author.isBot && !m.channelId.startsWith("D") ? { auth: defaultSlackAuth(m, ctx) } : null),
  onDirectMessage: (ctx, m) => (m.author && !m.author.isBot ? { auth: defaultSlackAuth(m, ctx) } : null),
  async onMessage(ctx, m) {
    if (!m.author || m.author.isBot || ctx.isBotMentioned()) return null;
    return (await ctx.isSubscribed()) || (await startedByThisAgent(ctx, m)) ? { auth: defaultSlackAuth(m, ctx) } : null;
  },
});

/** Whether the message is a reply under a thread root this app posted; a failed thread fetch means no. */
async function startedByThisAgent(ctx: SlackInboundMessageContext, m: SlackMessage): Promise<boolean> {
  if (m.threadTs === m.ts) return false;
  const messages = await loadThreadContextMessages(ctx.thread, m, { since: "thread-root" });
  return messages.some((t) => t.ts === m.threadTs && t.isMe);
}
