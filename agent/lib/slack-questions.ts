import type { SlackChannelEvents, SlackEventContext } from "eve/channels/slack";

type InputEvent = Parameters<NonNullable<SlackChannelEvents["input.requested"]>>[0];
type Request = InputEvent["requests"][number];
const gateway = /^(?:type|enter|write|provide|upload|attach|send)\s+(?:(?:an?|the|your)\s+)?(?:answer|reply|response|text|file|csv)(?:\s+file)?[.!…]*$/iu;

// Slack option labels and descriptions each allow 75 characters.
// Count UTF-16 units conservatively without splitting a Unicode character.
function optionText(value: string) {
  const text = value.trim();
  if (text.length <= 75) return text;
  return text.slice(0, 74).replace(/[\uD800-\uDBFF]$/u, "").trimEnd() + "…";
}

function textParts(text: string, limit: number) {
  const parts: string[] = [];
  while (text.length) {
    const end = text.length > limit && /[\uD800-\uDBFF]/u.test(text[limit - 1]) ? limit - 1 : limit;
    const part = text.slice(0, end);
    parts.push(part);
    text = text.slice(part.length);
  }
  return parts;
}

/** Keep Eve's request IDs and interaction protocol; open input needs only a thread message. */
export function questionMessage(request: Request) {
  const options = (request.options ?? []).filter(option => request.kind !== "question" || !gateway.test(option.label.trim()));
  const open = request.kind === "question" && options.length === 0;
  if (open) return { text: request.prompt, blocks: [{ type: "section", text: { type: "mrkdwn", text: request.prompt } }] };
  const prefix = `eve_input:${request.kind === "tool-approval" ? "tool-approval:" : ""}${request.requestId}`;
  // IDs belong to Eve's pending request: never truncate them into a different answer.
  // Oversized legacy requests remain answerable by ordinary thread replies.
  if (request.kind === "question" && (options.length > 100 || prefix.length > 255 || options.some(option => !option.id || option.id.length > 150))) {
    const choices = options.map(option => `${request.options!.indexOf(option) + 1}. ${optionText(option.label)}${option.description?.trim() ? `: ${optionText(option.description)}` : ""}`);
    return { text: [request.prompt, ...choices, "Reply in this thread with the option number."].join("\n") };
  }
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: request.prompt } }];
  if (options.length && (request.kind === "question" || options.length > 5)) {
    blocks.push({ type: "actions", elements: [{ type: "static_select", action_id: prefix,
      placeholder: { type: "plain_text", text: "Choose an option" },
      options: options.map((option, index) => ({
        text: { type: "plain_text", text: optionText(option.label) || `Option ${index + 1}` }, value: option.id,
        ...(option.description?.trim() ? { description: { type: "plain_text", text: optionText(option.description) } } : {}),
      })),
    }] });
  } else if (options.length) {
    blocks.push({ type: "actions", elements: options.map((option, index) => ({
      type: "button", action_id: `${prefix}:button:${index}`, value: option.id,
      text: { type: "plain_text", text: optionText(option.label) || `Option ${index + 1}` },
    })) });
  }
  if (request.allowFreeform) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Reply in this thread for another answer." }] });
  return { text: request.prompt, blocks };
}

export async function postQuestions(data: InputEvent, channel: SlackEventContext) {
  for (const request of data.requests) {
    const message = questionMessage(request);
    if (!message.blocks) {
      for (const text of textParts(message.text, 40000)) await channel.thread.post({ text });
      continue;
    }
    const posted = await channel.thread.post(message);
    if (request.kind === "tool-approval" && posted.id) {
      channel.state.pendingApprovalCards = { ...channel.state.pendingApprovalCards,
        [request.requestId]: { messageBlocks: message.blocks, messageTs: posted.id } };
    }
  }
}
