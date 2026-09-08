import type { SlackChannelEvents } from "eve/channels/slack";

type InputRequestedHandler = NonNullable<SlackChannelEvents["input.requested"]>;
type InputRequestedData = Parameters<InputRequestedHandler>[0];
type InputRequest = InputRequestedData["requests"][number];

/** Authored tools whose `summary` is the whole approval surface. */
export const GTM_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "apply_gtm_workspace_changes",
  "operate_gtm_workflow",
]);

/** Eve's Slack HITL wire format: button clicks decode from these prefixes. */
const HITL_ACTION_PREFIX = "eve_input:";
const HITL_FREEFORM_ACTION_PREFIX = "eve_input_freeform:";
/** Slack's limit for one `section` text; the summary is split by line to fit. */
const SLACK_SECTION_TEXT_MAX_LENGTH = 3_000;
const SLACK_BUTTON_TEXT_MAX_LENGTH = 75;

export type SlackPost = {
  readonly blocks: readonly unknown[];
  readonly text: string;
};

/** Renders the contract's `- ` bullet lines with a bullet glyph; everything else is untouched. */
export function renderBulletLines(text: string): string {
  return text
    .split("\n")
    .map((line) => (line.startsWith("- ") ? `\u2022 ${line.slice(2)}` : line))
    .join("\n");
}

/** Escapes the three characters Slack `mrkdwn` reserves. */
export function escapeMrkdwn(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * Splits text into chunks that each fit one Slack section, breaking at line
 * boundaries and hard-splitting only a single line that is itself too long.
 */
export function chunkForSections(
  text: string,
  limit = SLACK_SECTION_TEXT_MAX_LENGTH,
): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const pieces = line.length <= limit ? [line] : splitLongLine(line, limit);
    for (const piece of pieces) {
      const candidate = current.length === 0 ? piece : `${current}\n${piece}`;
      if (candidate.length <= limit) {
        current = candidate;
      } else {
        if (current.length > 0) chunks.push(current);
        current = piece;
      }
    }
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

function splitLongLine(line: string, limit: number): string[] {
  const pieces: string[] = [];
  for (let index = 0; index < line.length; index += limit) {
    pieces.push(line.slice(index, index + limit));
  }
  return pieces;
}

function truncate(text: string, limit: number): string {
  if (text.length <= limit) return text;
  return `${text.slice(0, Math.max(0, limit - 3)).trimEnd()}...`;
}

function approvalActionId(request: InputRequest, index: number): string {
  const kind = request.kind === "tool-approval" ? "tool-approval:" : "";
  return `${HITL_ACTION_PREFIX}${kind}${request.requestId}:button:${index}`;
}

function button(input: {
  readonly actionId: string;
  readonly label: string;
  readonly style?: "primary" | "danger";
  readonly value: string;
}): Record<string, unknown> {
  return {
    type: "button",
    action_id: input.actionId,
    text: {
      type: "plain_text",
      text: truncate(input.label, SLACK_BUTTON_TEXT_MAX_LENGTH),
      emoji: false,
    },
    value: input.value,
    ...(input.style === undefined ? {} : { style: input.style }),
  };
}

/**
 * The approval message for a GTM tool: only the tool's `summary`, then
 * Cancel and Approve. Never the manifest, file contents, or raw tool input,
 * in blocks or in the notification fallback text. Returns `null` when the
 * request is not a summary-bearing GTM approval, so the caller can fall back.
 */
export function buildGtmApprovalPost(request: InputRequest): SlackPost | null {
  if (request.kind !== "tool-approval") return null;
  if (!GTM_APPROVAL_TOOLS.has(request.action.toolName)) return null;
  const summary = request.action.input.summary;
  if (typeof summary !== "string" || summary.trim().length === 0) return null;
  const options = request.options ?? [];
  const approve = options.find((option) => option.id === "approve");
  const cancel = options.find((option) => option.id === "cancel");
  if (approve === undefined || cancel === undefined) return null;

  const text = summary.trim();
  const blocks: unknown[] = chunkForSections(escapeMrkdwn(renderBulletLines(text))).map((chunk) => ({
    type: "section",
    text: { type: "mrkdwn", text: chunk, verbatim: true },
  }));
  blocks.push({
    type: "actions",
    block_id: `gtm_approval:${request.requestId}`,
    elements: [
      button({ actionId: approvalActionId(request, 0), label: "Cancel", value: cancel.id }),
      button({
        actionId: approvalActionId(request, 1),
        label: "Approve",
        style: "primary",
        value: approve.id,
      }),
    ],
  });
  return { blocks, text };
}

/**
 * Rendering for every other input request (agent-source approvals, session
 * prompts): the prompt, a collapsed tool-input container for approvals, and
 * the request's own options as buttons or a select, mirroring Eve's default.
 */
export function buildGenericInputRequestPost(request: InputRequest): SlackPost {
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: truncate(request.prompt, SLACK_SECTION_TEXT_MAX_LENGTH) },
    },
  ];
  if (request.kind === "tool-approval") {
    const json = JSON.stringify(request.action.input, null, 2);
    if (json !== "{}") {
      blocks.push({
        type: "container",
        title: { type: "plain_text", text: "Tool input" },
        is_collapsible: true,
        default_collapsed: true,
        child_blocks: [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `\`\`\`\n${truncate(json, SLACK_SECTION_TEXT_MAX_LENGTH - 8)}\n\`\`\``,
            },
          },
        ],
      });
    }
  }

  const options = request.options ?? [];
  const selectActionId = `${HITL_ACTION_PREFIX}${request.kind === "tool-approval" ? "tool-approval:" : ""}${request.requestId}`;
  if (options.length > 0 && request.display === "select") {
    const choices = options.map((option) => ({
      text: { type: "plain_text", text: truncate(option.label, SLACK_BUTTON_TEXT_MAX_LENGTH) },
      value: option.id,
    }));
    blocks.push({
      type: "actions",
      elements: [
        options.length <= 6
          ? { type: "radio_buttons", action_id: selectActionId, options: choices }
          : {
              type: "static_select",
              action_id: selectActionId,
              options: choices,
              placeholder: { type: "plain_text", text: "Choose an option" },
            },
      ],
    });
  } else if (options.length > 0) {
    blocks.push({
      type: "actions",
      elements: options.map((option, index) =>
        button({
          actionId: approvalActionId(request, index),
          label: option.label,
          value: option.id,
          ...(option.style === "primary" || option.style === "danger"
            ? { style: option.style }
            : {}),
        }),
      ),
    });
  } else {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: `${HITL_FREEFORM_ACTION_PREFIX}${request.requestId}`,
          text: { type: "plain_text", text: "Type your answer" },
          style: "primary",
          value: request.requestId,
        },
      ],
    });
  }
  return { blocks, text: request.prompt };
}

/**
 * Replaces Eve's default `input.requested` handler so a GTM approval shows
 * only its summary. Each request is one Slack message; approval messages are
 * recorded in the channel state so Eve's default `approval.settled` handler
 * can mark them answered in place.
 */
export function createInputRequestedHandler(): InputRequestedHandler {
  return async (data, channel) => {
    for (const request of data.requests) {
      const post = buildGtmApprovalPost(request) ?? buildGenericInputRequestPost(request);
      const posted = await channel.thread.post({ blocks: post.blocks, text: post.text });
      if (request.kind !== "tool-approval" || !posted.id) continue;
      channel.state.pendingApprovalCards = {
        ...channel.state.pendingApprovalCards,
        [request.requestId]: { messageBlocks: post.blocks, messageTs: posted.id },
      };
    }
  };
}
