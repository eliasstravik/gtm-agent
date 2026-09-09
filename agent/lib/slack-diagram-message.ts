import type { SlackChannelEvents, SlackChannelState } from "eve/channels/slack";
import type { WhereToLook } from "./diagram-link.ts";

type DiagramDeliveryState = {
  diagramLinkDelivery?: { turnId: string; urls: string[] };
};

function linkIdentity(url: string): string {
  try {
    const parsed = new URL(url.replace(/&amp;/g, "&"));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "";
  }
}

/** Persist only link destinations, without signed queries, in Eve's channel state. */
export function rememberDiagramLinks(state: object | undefined, turnId: string | undefined, links: WhereToLook): void {
  if (!state || !turnId) return;
  const delivery = state as DiagramDeliveryState;
  const previous = delivery.diagramLinkDelivery;
  delivery.diagramLinkDelivery = {
    turnId,
    urls: [...new Set([
      ...(previous?.turnId === turnId ? previous.urls : []),
      ...Object.values(links).map(linkIdentity).filter(Boolean),
    ])],
  };
}

export function withoutDeliveredDiagramLinks(message: string, urls: string[]): string {
  const delivered = new Set(urls);
  return message.split("\n").map((line) => {
    let removed = false;
    const remove = (match: string, url: string) => {
      if (!delivered.has(linkIdentity(url))) return match;
      removed = true;
      return "";
    };
    const cleaned = line
      .replace(/\[[^\]]*\]\(<?(https?:\/\/[^)\s>]+)>?\)/g, remove)
      .replace(/<(https?:\/\/[^>|]+)(?:\|[^>]*)?>/g, remove)
      .replace(/https?:\/\/[^\s<>]+/g, (url) => remove(url, url));
    if (removed && /^[\s*#>\-]*(?:(?:Diagram|Runs|Data)\s*[:：]?)?[\s*]*$/i.test(cleaned)) return "";
    return cleaned.trimEnd();
  }).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Preserve Eve's message/typing behavior, removing only links already delivered this turn. */
export function createDiagramMessageHandler(): NonNullable<SlackChannelEvents["message.completed"]> {
  return async (data, channel) => {
    if (data.finishReason === "tool-calls") {
      channel.state.pendingToolCallMessage = data.message?.split(/\r?\n/).find(line => line.trim())?.trim() ?? null;
      return;
    }
    channel.state.pendingToolCallMessage = null;
    const delivery = (channel.state as SlackChannelState & DiagramDeliveryState).diagramLinkDelivery;
    const message = data.message && delivery?.turnId === data.turnId
      ? withoutDeliveredDiagramLinks(data.message, delivery.urls)
      : data.message;
    if (message) await channel.thread.post(message);
    else await channel.thread.startTyping();
  };
}
