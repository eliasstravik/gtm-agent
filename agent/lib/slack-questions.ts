import type { SlackChannelEvents, SlackEventContext } from "eve/channels/slack";

type InputEvent = Parameters<NonNullable<SlackChannelEvents["input.requested"]>>[0];
type Request = InputEvent["requests"][number];
const gateway = /^(?:type|enter|write|provide|upload|attach|send)\s+(?:(?:an?|the|your)\s+)?(?:answer|reply|response|text|file|csv)(?:\s+file)?[.!…]*$/iu;

/** Keep Eve's request IDs and interaction protocol; open input needs only a thread message. */
export function questionMessage(request: Request) {
  const options = (request.options ?? []).filter(option => request.kind !== "question" || !gateway.test(option.label.trim()));
  const open = request.kind === "question" && options.length === 0;
  if (open) return { text: request.prompt, blocks: [{ type: "section", text: { type: "mrkdwn", text: request.prompt } }] };
  const prefix = `eve_input:${request.kind === "tool-approval" ? "tool-approval:" : ""}${request.requestId}`;
  const blocks: unknown[] = [{ type: "section", text: { type: "mrkdwn", text: request.prompt } }];
  if (options.length > 5) {
    blocks.push({ type: "actions", elements: [{ type: "static_select", action_id: prefix,
      placeholder: { type: "plain_text", text: "Choose an option" },
      options: options.map(option => ({ text: { type: "plain_text", text: option.label }, value: option.id })),
    }] });
  } else if (options.length) {
    blocks.push({ type: "actions", elements: options.map((option, index) => ({
      type: "button", action_id: `${prefix}:button:${index}`, value: option.id,
      text: { type: "plain_text", text: option.label },
    })) });
  }
  if (request.allowFreeform) blocks.push({ type: "context", elements: [{ type: "mrkdwn", text: "Reply in this thread for another answer." }] });
  return { text: request.prompt, blocks };
}

export async function postQuestions(data: InputEvent, channel: SlackEventContext) {
  for (const request of data.requests) {
    const message = questionMessage(request);
    const posted = await channel.thread.post(message);
    if (request.kind === "tool-approval" && posted.id) {
      channel.state.pendingApprovalCards = { ...channel.state.pendingApprovalCards,
        [request.requestId]: { messageBlocks: message.blocks, messageTs: posted.id } };
    }
  }
}
