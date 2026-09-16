import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, loadThreadContextMessages, slackChannel, type SlackInboundMessageContext, type SlackMessage } from "eve/channels/slack";
import { postPlainReply, postRichReply } from "../lib/slack-delivery";
import { isAddressedGroupDM } from "../lib/slack-routing";
import { parseBlocksReply } from "../lib/blocks";
import { workflowEntryReply } from "../lib/workflow-entry";
import { postQuestions } from "../lib/slack-questions";

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
    if (!m.author || m.author.isBot) return null;
    // Group DMs arrive as message.mpim, not through Eve's one-to-one DM handler.
    if (isAddressedGroupDM(m.raw, ctx.isBotMentioned())) return { auth: defaultSlackAuth(m, ctx) };
    if (ctx.isBotMentioned()) return null;
    return (await ctx.isSubscribed()) || (await startedByThisAgent(ctx, m)) ? { auth: defaultSlackAuth(m, ctx) } : null;
  },
  events: {
    "input.requested": postQuestions,
    // Reasoning and tool arguments may contain quoted user data. Keep progress wording fixed.
    async "reasoning.appended"() {},
    async "actions.requested"(_data, channel) {
      channel.state.pendingToolCallMessage = null;
      await channel.thread.startTyping("Working...");
    },
    async "turn.failed"(_data, channel) {
      await channel.thread.post("The request failed. Try again or rephrase the request.");
    },
    async "session.failed"(_data, channel) {
      await channel.thread.post("The conversation could not recover. Start a new thread to continue.");
    },
    async "approval.candidate"(data, channel) {
      const userId = channel.state.pendingApprovalCandidateUsers?.[data.candidateId];
      if (userId && data.outcome === "pending") await channel.thread.postEphemeral(userId, "Checking approval access...");
      if (userId && (data.outcome === "rejected" || data.outcome === "failed")) await channel.thread.postEphemeral(userId, "Approval access could not be verified. Try again.");
    },
    async "message.completed"(data, channel) {
      if (data.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = data.message ? (firstNonEmptyLine(data.message) ?? null) : null;
        return;
      }
      channel.state.pendingToolCallMessage = null;
      if (!data.message) {
        await channel.thread.startTyping();
        return;
      }
      const parsed = parseBlocksReply(data.message);
      const rich = parsed ? workflowEntryReply(parsed, process.env.GTM_WORKFLOW_URL) : null;
      if (rich) {
        await postRichReply(channel, rich);
        return;
      }
      await postPlainReply(channel, data.message);
    },
  },
});

function firstNonEmptyLine(text: string): string | undefined {
  return text.split(/\r?\n/u).map((l) => l.trim()).find((l) => l.length > 0);
}

/** Whether the message is a reply under a thread root this app posted; a failed thread fetch means no. */
async function startedByThisAgent(ctx: SlackInboundMessageContext, m: SlackMessage): Promise<boolean> {
  if (m.threadTs === m.ts) return false;
  const messages = await loadThreadContextMessages(ctx.thread, m, { since: "thread-root" });
  return messages.some((t) => t.ts === m.threadTs && t.isMe);
}
