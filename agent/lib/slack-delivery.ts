import type { SlackEventContext } from "eve/channels/slack";
import type { BlocksMessage } from "./blocks";
const INLINE_REPLY_MAX = 12_000;
const LONG_REPLY_NOTICE = "Here's a snippet with the full response.";

/** Keep the normalized accessible text, including action URLs, if Slack rejects rich blocks. */
export async function postRichReply(channel: SlackEventContext, reply: BlocksMessage): Promise<void> {
  try {
    await channel.thread.post({ blocks: reply.blocks, text: reply.text });
  } catch (error) {
    console.error("Block Kit reply refused, posting its text instead", error);
    await postPlainReply(channel, reply.text);
  }
}

/** Eve's default delivery: inline as Markdown up to the limit, else a notice plus a Markdown snippet in the thread. */
export async function postPlainReply(channel: SlackEventContext, message: string): Promise<void> {
  if (message.length <= INLINE_REPLY_MAX) {
    await channel.thread.post(message);
    return;
  }
  const inThread = channel.slack.threadTs.length > 0;
  if (!inThread) await channel.thread.post(LONG_REPLY_NOTICE);
  const file = { data: new Blob([message], { type: "text/markdown" }), filename: "eve-response.md", mimeType: "text/markdown" };
  try {
    await channel.slack.uploadFiles([file], { initialComment: inThread ? LONG_REPLY_NOTICE : undefined, snippetType: "markdown" });
  } catch {
    // Preserve a useful answer even when the file service refuses the upload.
    await channel.thread.post(`I couldn't attach the full response. Here's the beginning; ask me to continue.\n\n${message.slice(0, 11000)}`);
  }
}
