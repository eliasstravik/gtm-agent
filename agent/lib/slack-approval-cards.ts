import type { SlackChannelEvents } from "eve/channels/slack";
import { describePlainApprovalTextProblem } from "./approval-summary.ts";

type InputRequestedHandler = NonNullable<SlackChannelEvents["input.requested"]>;
type InputRequestedData = Parameters<InputRequestedHandler>[0];
type InputRequest = InputRequestedData["requests"][number];

/** Authored tools whose `summary` is the whole approval surface. */
export const GTM_APPROVAL_TOOLS: ReadonlySet<string> = new Set([
  "apply_gtm_workspace_changes",
  "operate_gtm_workflow",
  "publish_source_change",
  "approve_gtm_plan",
]);

const APPROVAL_TEXT: Readonly<Record<string, string>> = {
  task_cancel: "Stop the selected background task. Work already completed will remain.",
  monid__monid_run: "Run the selected provider request. This may spend credits and change external data.",
  monid__monid_stop_run: "Stop the selected provider run. Completed work and charges will remain.",
  monid__monid_get_resource_external: "Request external access to the selected provider resource.",
  monid__monid_release_resource: "Release the selected provider resource. It may no longer be available.",
};

export function approvalText(request: InputRequest): string | null {
  const summary = request.action.input.summary;
  const candidate = typeof summary === "string" ? summary : APPROVAL_TEXT[request.action.toolName] ?? request.prompt;
  const text = candidate.trim();
  return describePlainApprovalTextProblem(text) === null ? text : null;
}

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

  if (approvalText(request) === null) return null;
  let text = summary.trim();
  if (request.action.toolName === "approve_gtm_plan") {
    const calls = request.action.input.calls as { summary?: string; input: { summary?: string } }[];
    text = [text, ...calls.map((call, i) => `${i + 1}. ${call.summary ?? call.input.summary}`), `Total estimated cost: $${request.action.input.totalCostUsd}.`, "Approve the whole plan, or Cancel and tell me what to change."].join("\n\n");
  }
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
 * prompts): human text and
 * the request's own options as buttons or a select, mirroring Eve's default.
 */
export function buildGenericInputRequestPost(request: InputRequest): SlackPost {
  const text = request.kind === "tool-approval" ? approvalText(request) : request.prompt;
  if (text === null) throw new Error("Approval needs plain text describing the action and effects; correct the request and ask again.");
  const blocks: unknown[] = [
    {
      type: "section",
      text: { type: "mrkdwn", text: escapeMrkdwn(truncate(text, SLACK_SECTION_TEXT_MAX_LENGTH)) },
    },
  ];

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
  return { blocks, text };
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
