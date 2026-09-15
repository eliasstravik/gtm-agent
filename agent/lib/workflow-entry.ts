import type { BlocksMessage } from "./blocks";

const ENTRY_LABEL = "Open GTM Workflows";
const shortLabel = (label: string) => {
  const characters = Array.from(label);
  return characters.length > 75 ? `${characters.slice(0, 74).join("")}…` : label;
};

function isViewer(url: string, origin?: string): boolean {
  if (!origin) return false;
  try {
    const target = new URL(url);
    return target.origin === new URL(origin).origin && target.pathname === "/viewer";
  } catch {
    return false;
  }
}

/** Enforce Slack's button text contract before delivery, and retain links in its plain fallback. */
export function workflowEntryReply(message: BlocksMessage, workflowOrigin?: string): BlocksMessage {
  let entry = false;
  let text = message.text;
  const normalize = (button: Record<string, any>) => {
    if (button.type !== "button" || typeof button.url !== "string") return button;
    const rawLabel = typeof button.text?.text === "string" ? button.text.text : "Open link";
    const label = rawLabel.match(/^<https?:\/\/[^|>]+\|([^>]+)>$/)?.[1]
      ?? rawLabel.match(/^\[([^\]]+)\]\(https?:\/\/.+\)$/)?.[1]
      ?? rawLabel;
    const workflow = label === ENTRY_LABEL || label === "Open Workflows"
      || button.action_id === "open_gtm_workflows" || isViewer(button.url, workflowOrigin);
    if (workflow && entry) return null;
    if (workflow) entry = true;
    const caption = workflow ? ENTRY_LABEL : shortLabel(label.trim() || "Open link");
    if (!text.includes(button.url)) text += `\n${caption}: ${button.url}`;
    return {
      ...button,
      text: { type: "plain_text", text: caption },
      ...(typeof button.accessibility_label === "string" ? { accessibility_label: shortLabel(button.accessibility_label) } : {}),
      ...(workflow ? { style: "primary", action_id: "open_gtm_workflows" } : {}),
    };
  };
  const blocks = message.blocks.flatMap((raw) => {
    const block = raw as { type: string; elements?: Array<Record<string, any>>; accessory?: Record<string, any> };
    if (block.type === "actions" && Array.isArray(block.elements)) {
      const elements = block.elements.map(normalize).filter(Boolean);
      return elements.length ? [{ ...block, elements }] : [];
    }
    if (block.type === "section" && block.accessory?.type === "button") {
      const { accessory, ...rest } = block;
      const normalized = normalize(accessory);
      return [normalized ? { ...rest, accessory: normalized } : rest];
    }
    return [raw];
  });
  return { blocks, text };
}
