import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel } from "eve/channels/slack";

// SLACK_CONNECTOR is provisioned by the "Deploy with Vercel" button; the fallback is the CLI-created connector's UID.
// One message is one turn: app_mention in channels, message.im in DMs, and unmentioned replies in a thread this agent owns.
export default slackChannel({
  credentials: connectSlackCredentials(process.env.SLACK_CONNECTOR || "slack/gtm-agent"),
  onAppMention: (ctx, m) => (m.author && !m.author.isBot && !m.channelId.startsWith("D") ? { auth: defaultSlackAuth(m, ctx) } : null),
  onDirectMessage: (ctx, m) => (m.author && !m.author.isBot ? { auth: defaultSlackAuth(m, ctx) } : null),
  async onMessage(ctx, m) {
    if (!m.author || m.author.isBot || ctx.isBotMentioned()) return null;
    return (await ctx.isSubscribed()) ? { auth: defaultSlackAuth(m, ctx) } : null;
  },
});
