import type { SlackChannelEvents, SlackChannelState } from "eve/channels/slack";
import { createDiagramResultHandler, diagramOutput, type DiagramOutput } from "./slack-diagram-post.ts";
import type { WhereToLook } from "./diagram-link.ts";

type DiagramDeliveryState = {
  pendingDiagrams?: { turnId: string; outputs: DiagramOutput[] };
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

/** Queue tool results until the caption is available, then post one message per diagram. */
export function createDiagramEvents(options: { readonly fetch?: typeof fetch } = {}): Pick<SlackChannelEvents, "action.result" | "message.completed" | "turn.completed"> {
  const postDiagram = createDiagramResultHandler(options);
  const flush = async (turnId: string, channel: Parameters<NonNullable<SlackChannelEvents["message.completed"]>>[1], caption: string | null): Promise<boolean> => {
    const state = channel.state as SlackChannelState & DiagramDeliveryState;
    const pending = state.pendingDiagrams;
    if (!pending || pending.turnId !== turnId || pending.outputs.length === 0) return false;
    const urls = pending.outputs.flatMap(output => Object.values(output.links).map(linkIdentity));
    let remainingCaption = caption ? withoutDeliveredDiagramLinks(caption, urls) : "";
    while (pending.outputs.length) {
      const output = pending.outputs[0]!;
      const delivered = await postDiagram({
        turnId, caption: remainingCaption,
        result: { kind: "tool-result", toolName: "operate_gtm_workflow", output },
      }, channel);
      if (!delivered) throw new Error("The workflow diagram message could not be delivered to Slack.");
      rememberDiagramLinks(channel.state, turnId, output.links);
      pending.outputs.shift();
      remainingCaption = "";
    }
    delete state.pendingDiagrams;
    return true;
  };
  return {
    "action.result": async (data, channel) => {
      if (data.result.kind === "tool-result" && data.result.toolName === "render_gtm_draft") {
        const output = data.result.output as { action?: string; png: string; caption: string; links: { data: string; runs: string } };
        if (output?.action !== "draft-diagram") return;
        const text = `${output.caption}\n\nData: <${output.links.data}|Open the data>\nRuns: <${output.links.runs}|Open the runs>`;
        // Deliver now: an approval can arrive before message.completed.
        await channel.thread.post({ text, files: [{ filename: "workflow-draft.png", data: Buffer.from(output.png, "base64") }] });
        return;
      }
      if (data.result.kind !== "tool-result" || data.result.toolName !== "operate_gtm_workflow") return;
      const output = diagramOutput(data.result.output);
      if (!output) return;
      const caption = (data.result.output as { caption?: string }).caption;
      if (caption) {
        const delivered = await postDiagram({ ...data, caption }, channel);
        if (!delivered) throw new Error("The workflow diagram message could not be delivered to Slack.");
        rememberDiagramLinks(channel.state, data.turnId, output.links);
        return;
      }
      const state = channel.state as SlackChannelState & DiagramDeliveryState;
      if (state.pendingDiagrams?.turnId !== data.turnId) state.pendingDiagrams = { turnId: data.turnId, outputs: [] };
      state.pendingDiagrams.outputs.push(output);
    },
    "message.completed": async (data, channel) => {
      if (data.finishReason === "tool-calls") {
        channel.state.pendingToolCallMessage = data.message?.split(/\r?\n/).find(line => line.trim())?.trim() ?? null;
        return;
      }
      channel.state.pendingToolCallMessage = null;
      if (await flush(data.turnId, channel, data.message)) return;
      const delivery = (channel.state as SlackChannelState & DiagramDeliveryState).diagramLinkDelivery;
      const message = data.message && delivery?.turnId === data.turnId
        ? withoutDeliveredDiagramLinks(data.message, delivery.urls)
        : data.message;
      if (message) await channel.thread.post(message);
      else await channel.thread.startTyping();
    },
    "turn.completed": async (data, channel) => { await flush(data.turnId, channel, null); },
  };
}
