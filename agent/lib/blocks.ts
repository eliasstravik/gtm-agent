/**
 * Block Kit for the two places this agent writes to Slack by hand: the model's final reply (channels/slack.ts) and the
 * workflows' notify route (channels/gtm.ts). Eve's own surfaces (questions, approvals, sign-in) render their own blocks
 * and are not touched. A reply is plain text unless the model answers with one JSON object `{ text, blocks }`; the
 * `text` is Slack's plain fallback (notifications, accessibility, thread context), the `blocks` are Block Kit as is.
 */
export type BlocksMessage = { text: string; blocks: unknown[] };

/** Slack rejects a post with more than 50 blocks. */
export const MAX_BLOCKS = 50;

/** The reply as a Block Kit message when it is one JSON object with a non-empty `blocks` array, else null. */
export function parseBlocksReply(message: string): BlocksMessage | null {
  const body = message.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  return asBlocksMessage(parsed);
}

/** A `{ text, blocks }` object with 1 to 50 blocks; the text falls back to what the blocks say. */
export function asBlocksMessage(value: unknown): BlocksMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const { text, blocks } = value as { text?: unknown; blocks?: unknown };
  if (!Array.isArray(blocks) || blocks.length === 0 || blocks.length > MAX_BLOCKS) return null;
  if (!blocks.every((b) => typeof b === "object" && b !== null && typeof (b as { type?: unknown }).type === "string")) return null;
  const fallback = typeof text === "string" && text.trim() ? text : blocksToText(blocks);
  return fallback ? { text: fallback, blocks } : null;
}

/** A plain-text rendering of the blocks: the text of markdown, section, header, and context blocks, one per line. */
export function blocksToText(blocks: unknown[]): string {
  const lines: string[] = [];
  for (const block of blocks as Array<Record<string, unknown>>) {
    const text = block.text;
    if (typeof text === "string") lines.push(text);
    else if (typeof text === "object" && text && typeof (text as { text?: unknown }).text === "string") lines.push((text as { text: string }).text);
    if (Array.isArray(block.elements)) {
      for (const el of block.elements as Array<Record<string, unknown>>) {
        const t = el.text;
        if (typeof t === "object" && t && typeof (t as { text?: unknown }).text === "string" && typeof el.url === "string") lines.push(`${(t as { text: string }).text}: ${el.url}`);
      }
    }
  }
  return lines.join("\n").trim();
}

/** One Block Kit markdown block: Slack renders its text as Markdown, the same way a plain reply renders. */
export function markdownBlock(text: string): { type: "markdown"; text: string } {
  return { type: "markdown", text };
}
