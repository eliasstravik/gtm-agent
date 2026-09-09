import { whereToLookText, type WhereToLook } from "./diagram-link.ts";
import { rememberDiagramLinks } from "./slack-diagram-message.ts";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * The `action.result` payload, kept as wide as Eve's own union: only a
 * `tool-result` carries `toolName`, so a load-skill or subagent result must
 * still satisfy this shape.
 */
type ActionResultData = {
  readonly turnId?: string;
  readonly result: {
    readonly kind: string;
    readonly toolName?: string;
    readonly output?: unknown;
  };
};
type ThreadPoster = { readonly state?: object; readonly thread: { post(input: unknown): Promise<unknown> } };

type DiagramOutput =
  | {
      readonly action: "diagram";
      readonly status: "ready";
      readonly workflowPath: string;
      readonly imageUrl: string;
      readonly links: WhereToLook;
    }
  | {
      readonly action: "diagram";
      readonly status: "protected";
      readonly message: string;
      readonly links: WhereToLook;
    };

function diagramOutput(value: unknown): DiagramOutput | null {
  if (typeof value !== "object" || value === null) return null;
  const output = value as Record<string, unknown>;
  if (output.action !== "diagram") return null;
  const links = output.links as Record<string, unknown> | undefined;
  if (
    !links ||
    typeof links.diagram !== "string" ||
    typeof links.runs !== "string" ||
    typeof links.data !== "string"
  ) {
    return null;
  }
  if (
    output.status === "ready" &&
    typeof output.imageUrl === "string" &&
    typeof output.workflowPath === "string"
  ) {
    return output as unknown as DiagramOutput;
  }
  if (output.status === "protected" && typeof output.message === "string") {
    return output as unknown as DiagramOutput;
  }
  return null;
}

/**
 * Downloads the picture under a hard byte ceiling. The body is read chunk by
 * chunk so an absent or lying `content-length` cannot make us materialise more
 * than `MAX_IMAGE_BYTES`, and only a PNG is ever handed to Slack.
 */
async function downloadImage(
  fetchImage: typeof fetch,
  imageUrl: string,
): Promise<Uint8Array | null> {
  const response = await fetchImage(imageUrl, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
  });
  const declared = Number(response.headers.get("content-length") ?? "0");
  const type = response.headers.get("content-type") ?? "";
  if (response.status !== 200 || !type.startsWith("image/png") || declared > MAX_IMAGE_BYTES) {
    await response.body?.cancel();
    return null;
  }
  const reader = response.body?.getReader();
  if (reader === undefined) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_IMAGE_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  if (total === 0) return null;
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

// Log only recognized API metadata. Error messages and response bodies may
// contain the signed diagram URL or connector credentials.
const SLACK_ERRORS = new Set([
  "missing_scope", "invalid_auth", "not_authed", "token_revoked", "token_expired",
  "channel_not_found", "not_in_channel", "is_archived", "invalid_blocks",
  "invalid_arguments", "ratelimited", "file_uploads_disabled", "internal_error",
]);
const SLACK_METHODS = new Set([
  "files.getUploadURLExternal", "files.upload", "files.completeUploadExternal", "chat.postMessage",
]);

/** Return whether Slack accepted the post so a rejected upload can fall back. */
async function postSafely(channel: ThreadPoster, input: unknown): Promise<boolean> {
  try {
    await channel.thread.post(input);
    return true;
  } catch (error) {
    const failure = error as { method?: unknown; response?: { error?: unknown }; status?: unknown } | null;
    const code = failure?.response?.error;
    const method = failure?.method;
    const status = failure?.status;
    console.warn("The workflow diagram could not be posted to the Slack thread.", {
      code: typeof code === "string" && SLACK_ERRORS.has(code) ? code : "unknown_error",
      method: typeof method === "string" && SLACK_METHODS.has(method) ? method : "unknown",
      status: typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599 ? status : null,
    });
    return false;
  }
}

/**
 * Posts the workflow picture and the "Where to look" block into the Slack
 * thread. The image is fetched with no credentials, exactly as a viewer's
 * browser would, and the model never sees the bytes.
 */
export function createDiagramResultHandler(options: { readonly fetch?: typeof fetch } = {}) {
  const fetchImage = options.fetch ?? globalThis.fetch;
  return async (data: ActionResultData, channel: ThreadPoster): Promise<void> => {
    if (data.result.kind !== "tool-result" || data.result.toolName !== "operate_gtm_workflow") {
      return;
    }
    const output = diagramOutput(data.result.output);
    if (output === null) return;
    if (output.status === "protected") {
      await postSafely(channel, { text: output.message });
      return;
    }
    const text = whereToLookText(output.links);
    const deliver = async (input: unknown): Promise<boolean> => {
      if (!(await postSafely(channel, input))) return false;
      rememberDiagramLinks(channel.state, data.turnId, output.links);
      return true;
    };
    let bytes: Uint8Array | null = null;
    try {
      bytes = await downloadImage(fetchImage, output.imageUrl);
    } catch {
      bytes = null;
    }
    if (bytes === null) {
      await deliver({
        text: `${text}\nThe picture could not be downloaded; open the diagram link instead.`,
      });
      return;
    }
    const filename = `${output.workflowPath.split("/").at(-1)}.png`;
    if (await deliver({ text, files: [{ filename, data: bytes }] })) return;

    // An inline image uses chat.postMessage, so it still works when the
    // installation can post messages but cannot upload files.
    if (await deliver({
      text,
      blocks: [
        { type: "section", text: { type: "mrkdwn", text } },
        { type: "image", image_url: output.imageUrl, alt_text: `Workflow diagram: ${output.workflowPath}` },
      ],
    })) return;

    await deliver({
      text: `${text}\nThe picture could not be displayed; open the diagram link instead.`,
    });
  };
}
