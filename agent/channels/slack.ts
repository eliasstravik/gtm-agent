import { connectSlackCredentials } from "@vercel/connect/eve";
import {
  defaultSlackAuth,
  slackChannel,
  type SlackChannelConfig,
} from "eve/channels/slack";

import {
  getConfiguration,
  type SlackConfiguration,
} from "../lib/config.ts";

const configuration = getConfiguration();

export function createSlackChannelConfig(
  slack: SlackConfiguration,
): SlackChannelConfig {
  const allowedChannels = new Set(slack.allowedChannelIds);
  const allowedUsers = new Set(slack.allowedUserIds);

  return {
    credentials: connectSlackCredentials(slack.connector),
    threadContext: { since: "last-agent-reply" },
    onAppMention(ctx, message) {
      const author = message.author;
      if (
        author === undefined ||
        author.isBot ||
        !allowedChannels.has(message.channelId) ||
        !allowedUsers.has(author.userId)
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
