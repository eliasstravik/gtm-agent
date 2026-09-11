import { connectSlackCredentials } from "@vercel/connect/eve";
import { defaultSlackAuth, slackChannel, type SlackChannelConfig, type SlackMessage } from "eve/channels/slack";
import { approvalCardText } from "../lib/approval.ts";
import { getConfiguration, type Configuration } from "../lib/config.ts";

type State = { pushApprovals?: Record<string, boolean> };
const humanSubtypes = new Set(["file_share", "thread_broadcast"]);
const clean = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function isHuman(message: SlackMessage): boolean {
  const subtype = (message.raw as { subtype?: unknown }).subtype;
  return subtype === undefined || subtype === "" || typeof subtype === "string" && humanSubtypes.has(subtype);
}

export function createSlackChannelConfig(config: Configuration["slack"]): SlackChannelConfig {
  const channels = new Set(config.allowedChannelIds), users = new Set(config.allowedUserIds);
  const allowed = (message: SlackMessage) => Boolean(message.author && !message.author.isBot && channels.has(message.channelId) && users.has(message.author.userId));
  return {
    credentials: connectSlackCredentials(config.connector),
    threadContext: { since: "last-agent-reply" },
    events: {
      "input.requested": async (data, channel) => {
        for (const request of data.requests) {
          const text = approvalCardText(request);
          const options = request.options ?? [];
          const approve = options.find((option) => option.id === "approve");
          const cancel = options.find((option) => option.id === "cancel");
          const kind = request.kind === "tool-approval" ? "tool-approval:" : "";
          const action = (label: string, value: string, index: number, primary = false) => ({
            type: "button", action_id: `eve_input:${kind}${request.requestId}:button:${index}`,
            text: { type: "plain_text", text: label }, value, ...(primary ? { style: "primary" } : {}),
          });
          const choices = approve && cancel
            ? [action("Cancel", cancel.id, options.indexOf(cancel)), action("Approve", approve.id, options.indexOf(approve), true)]
            : options.map((option, index) => action(option.label, option.id, index, option.style === "primary"));
          await channel.thread.post({ text, blocks: [
            { type: "section", text: { type: "mrkdwn", text: clean(text), verbatim: true } },
            ...(choices.length ? [{ type: "actions", elements: choices }] : []),
          ] });
          if (request.kind === "tool-approval") {
            const command = request.action.input.command;
            const state = channel.state as typeof channel.state & State;
            state.pushApprovals ??= {};
            state.pushApprovals[request.requestId] = typeof command === "string" && /\bgit\s+push\b/.test(command);
          }
        }
      },
      "approval.settled": async (data, channel) => {
        const state = channel.state as typeof channel.state & State;
        if (data.outcome === "approved" && state.pushApprovals?.[data.requestId]) {
          await channel.thread.post("Saving and testing. Back in a few minutes.");
        }
        if (state.pushApprovals) delete state.pushApprovals[data.requestId];
      },
      "action.result": async (data, channel) => {
        if (data.result.kind !== "tool-result" || data.result.toolName !== "bash") return;
        const output = data.result.output as { stdout?: unknown };
        if (typeof output.stdout !== "string") return;
        let body: unknown;
        try { body = JSON.parse(output.stdout); } catch { return; }
        const image = body && typeof body === "object" ? (body as { image?: unknown }).image : undefined;
        if (typeof image !== "string") return;
        const expected = new URL(getConfiguration().workflow.url), candidate = new URL(image);
        if (candidate.protocol !== "https:" || candidate.origin !== expected.origin) return;
        await channel.thread.post({ text: "Workflow picture", blocks: [{ type: "image", image_url: image, alt_text: "Workflow picture" }] });
      },
    },
    onAppMention(ctx, message) { return allowed(message) ? { auth: defaultSlackAuth(message, ctx) } : null; },
    async onMessage(ctx, message) {
      return isHuman(message) && allowed(message) && await ctx.isSubscribed()
        ? { auth: defaultSlackAuth(message, ctx) } : null;
    },
    onDirectMessage() { return null; },
    onInputResponse(ctx, submission) {
      return channels.has(ctx.slack.channelId) && users.has(submission.user.id) ? { auth: ctx.defaultAuth } : null;
    },
  };
}

export default slackChannel(createSlackChannelConfig(getConfiguration().slack));
