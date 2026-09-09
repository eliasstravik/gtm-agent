import { whereToLookText, type WhereToLook } from "./diagram-link.ts";

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 15_000;

/**
 * The `action.result` payload, kept as wide as Eve's own union: only a
 * `tool-result` carries `toolName`, so a load-skill or subagent result must
 * still satisfy this shape.
 */
type ActionResultData = {
  readonly result: {
    readonly kind: string;
    readonly toolName?: string;
    readonly output?: unknown;
  };
};
type ThreadPoster = { readonly thread: { post(input: unknown): Promise<unknown> } };

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

/** A Slack post failure is ordinary; it must not escape the event handler. */
async function postSafely(channel: ThreadPoster, input: unknown): Promise<void> {
  try {
    await channel.thread.post(input);
  } catch {
    console.warn("The workflow diagram could not be posted to the Slack thread.");
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
    let bytes: Uint8Array | null = null;
    try {
      bytes = await downloadImage(fetchImage, output.imageUrl);
    } catch {
      bytes = null;
    }
    if (bytes === null) {
      await postSafely(channel, {
        text: `${text}\nThe picture could not be downloaded; open the diagram link instead.`,
      });
      return;
    }
    const filename = `${output.workflowPath.split("/").at(-1)}.png`;
    await postSafely(channel, { text, files: [{ filename, data: bytes }] });
  };
}
