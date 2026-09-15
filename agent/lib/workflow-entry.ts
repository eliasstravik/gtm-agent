import type { BlocksMessage } from "./blocks";
/** Normalize only the workflow entry in final replies; preserve unrelated actions. */
export function workflowEntryReply(message: BlocksMessage): BlocksMessage {
  let entry: string | undefined;
  const blocks = message.blocks.flatMap((raw) => {
    const block = raw as { type: string; elements?: Array<Record<string, any>> };
    if (block.type !== "actions" || !Array.isArray(block.elements)) return [raw];
    const elements = block.elements.flatMap(button => {
      if (button.type !== "button" || button.text?.text !== "Open GTM Workflows" || typeof button.url !== "string") return [button];
      if (entry) return [];
      entry = button.url;
      return [{ ...button, style: "primary", action_id: "open_gtm_workflows" }];
    });
    return elements.length ? [{ ...block, elements }] : [];
  });
  return { blocks, text: entry && !message.text.includes(entry) ? `${message.text}\nOpen GTM Workflows: ${entry}` : message.text };
}
