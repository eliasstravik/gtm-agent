import { connectSlackCredentials } from "@vercel/connect/eve";
import {
  defaultSlackAuth,
  slackChannel,
  type SlackChannelConfig,
  type SlackMessage,
} from "eve/channels/slack";

import {
  getConfiguration,
  type SlackConfiguration,
} from "../lib/config.ts";

const configuration = getConfiguration();

/**
 * Slack `message` subtypes that represent a new human post. Eve's channel
 * message path does not filter subtypes, so edits (`message_changed`),
 * deletions (`message_deleted`), joins, topic changes, and bot posts would
 * otherwise reach `onMessage`.
 */
const HUMAN_POST_SUBTYPES = new Set(["file_share", "thread_broadcast"]);

function isHumanPost(message: SlackMessage): boolean {
  const subtype = (message.raw as { subtype?: unknown }).subtype;
  return (
    subtype === undefined ||
    subtype === "" ||
    (typeof subtype === "string" && HUMAN_POST_SUBTYPES.has(subtype))
  );
}

export function createSlackChannelConfig(
  slack: SlackConfiguration,
): SlackChannelConfig {
  const allowedChannels = new Set(slack.allowedChannelIds);
  const allowedUsers = new Set(slack.allowedUserIds);

  function isAllowedHuman(message: SlackMessage): boolean {
    const author = message.author;
    return (
      author !== undefined &&
      !author.isBot &&
      allowedChannels.has(message.channelId) &&
      allowedUsers.has(author.userId)
    );
  }

  return {
    credentials: connectSlackCredentials(slack.connector),
    threadContext: { since: "last-agent-reply" },
    onAppMention(ctx, message) {
      if (!isAllowedHuman(message)) {
        return null;
      }
      return { auth: defaultSlackAuth(message, ctx) };
    },
    // An unmentioned reply continues a thread only when the agent already
    // holds a session for it. Eve routes mentioned messages to onAppMention
    // and never to onMessage, so a mention cannot start two turns. Top-level
    // channel messages have no agent session and are ignored here.
    async onMessage(ctx, message) {
      if (
        !isHumanPost(message) ||
        !isAllowedHuman(message) ||
        !(await ctx.isSubscribed())
      ) {
        return null;
      }
      return { auth: defaultSlackAuth(message, ctx) };
    },
    onDirectMessage() {
      return null;
    },
    onInputResponse(ctx, submission) {
      if (
        !allowedChannels.has(ctx.slack.channelId) ||
        !allowedUsers.has(submission.user.id)
      ) {
        return null;
      }
      return { auth: ctx.defaultAuth };
    },
  };
}

export default slackChannel(createSlackChannelConfig(configuration.slack));
