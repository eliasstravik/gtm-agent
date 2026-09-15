import { createHash } from "node:crypto";
import { basename, posix } from "node:path";

export const FILE_LIMIT = 25 * 1024 * 1024;
export type SlackIdentity = { channelId: string; threadTs: string; userId: string; teamId: string };
export type SlackCall = (method: string, body: Record<string, unknown>) => Promise<Record<string, any>>;
export type Destination = { channelId?: string | null; threadTs?: string | null; userId?: string | null };
export type FileSandbox = {
  readBinaryFile(input: { path: string }): PromiseLike<Uint8Array | null>;
  writeBinaryFile(input: { path: string; content: Uint8Array }): PromiseLike<void>;
};

export function slackIdentity(auth: { authenticator?: string; attributes?: Record<string, unknown> } | null): SlackIdentity {
  const a = auth?.attributes ?? {};
  if (auth?.authenticator !== "slack-webhook" || !a.channel_id || !a.user_id || !a.team_id)
    throw new Error("Use these Slack tools from a Slack conversation.");
  return { channelId: String(a.channel_id), threadTs: String(a.thread_ts ?? ""), userId: String(a.user_id), teamId: String(a.team_id) };
}

export function destination(input: Destination, current: SlackIdentity) {
  if (input.userId && input.channelId) throw new Error("Choose a channel or a person, not both.");
  const channelId = input.channelId ?? current.channelId;
  return { channelId, threadTs: input.threadTs ?? (input.userId || channelId !== current.channelId ? "" : current.threadTs) };
}

export function slackFileUrl(value: unknown): string {
  const url = new URL(String(value));
  if (url.protocol !== "https:" || !(url.hostname === "files.slack.com" || url.hostname.endsWith(".slack.com")) || url.username || url.password || url.port)
    throw new Error("Slack returned an unsupported file address.");
  return url.href;
}

export async function boundedBytes(response: Response): Promise<Uint8Array> {
  if (!response.ok) throw new Error(`Slack file transfer failed (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length")) > FILE_LIMIT) throw new Error("File exceeds the 25 MB limit.");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Slack returned an empty file response.");
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > FILE_LIMIT) throw new Error("File exceeds the 25 MB limit.");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Only return Slack's error code, never its token-bearing request or private file URLs. */
export async function checked(call: SlackCall, method: string, body: Record<string, unknown>) {
  const response = await call(method, body);
  if (!response.ok) {
    const error = String(response.error ?? "unknown_error");
    const hint = error === "missing_scope" ? "Reapprove the app's configured permissions in Vercel Connect."
      : /not_in_channel|channel_not_found/.test(error) ? "Invite the bot to that conversation and check the channel ID."
      : error === "ratelimited" ? "Wait before trying again." : "Check the destination and try again.";
    throw new Error(`${method}: ${error}. ${hint}`);
  }
  return response;
}

export class SlackOperations {
  readonly identity: SlackIdentity;
  readonly call: SlackCall;
  readonly transfer: typeof fetch;
  constructor(identity: SlackIdentity, call: SlackCall, transfer: typeof fetch = fetch) {
    this.identity = identity; this.call = call; this.transfer = transfer;
  }
  request(method: string, body: Record<string, unknown>) { return checked(this.call, method, body); }

  async conversation(channel: string) {
    const { channel: info } = await this.request("conversations.info", { channel });
    if (!info) throw new Error("Slack did not return the conversation.");
    // A bot's membership alone does not authorize a teammate to read another private conversation.
    if (info.is_private || info.is_im || info.is_mpim) {
      let cursor = ""; let member = false;
      do {
        const page = await this.request("conversations.members", { channel, limit: 200, cursor });
        member = (page.members ?? []).includes(this.identity.userId);
        cursor = page.response_metadata?.next_cursor ?? "";
      } while (cursor && !member);
      if (!member) throw new Error("You are not a member of that private conversation.");
    }
    return info;
  }

  async find(input: { query?: string | null; cursor?: string | null; limit?: number | null; types?: string | null }) {
    const page = await this.request("conversations.list", { types: input.types ?? "public_channel,private_channel,im,mpim", exclude_archived: true, limit: input.limit ?? 25, cursor: input.cursor ?? "" });
    const conversations = [];
    for (const c of page.channels ?? []) {
      if (input.query && !`${c.name ?? ""} ${c.id} ${c.user ?? ""}`.toLowerCase().includes(input.query.replace(/^#/, "").toLowerCase())) continue;
      if (c.is_private || c.is_im || c.is_mpim) {
        try { await this.conversation(c.id); } catch (error) {
          if (error instanceof Error && error.message === "You are not a member of that private conversation.") continue;
          throw error;
        }
      }
      conversations.push({ id: c.id, name: c.name, userId: c.user, private: !!c.is_private, directMessage: !!c.is_im, groupDM: !!c.is_mpim, botIsMember: c.is_member });
    }
    return { conversations, nextCursor: page.response_metadata?.next_cursor || null };
  }

  async history(input: { channelId?: string | null; threadTs?: string | null; cursor?: string | null; limit?: number | null }) {
    const target = destination(input, this.identity);
    await this.conversation(target.channelId);
    const page = await this.request(target.threadTs ? "conversations.replies" : "conversations.history", { channel: target.channelId, ...(target.threadTs && { ts: target.threadTs }), limit: input.limit ?? 50, cursor: input.cursor ?? "" });
    return { ...target, messages: (page.messages ?? []).map((m: any) => ({ ts: m.ts, threadTs: m.thread_ts, userId: m.user, text: m.text, files: (m.files ?? []).map((f: any) => ({ id: f.id, name: f.name, mimeType: f.mimetype, size: f.size })) })), nextCursor: page.response_metadata?.next_cursor || null };
  }

  async target(input: Destination) {
    if (input.userId) {
      const page = await this.request("conversations.open", { users: input.userId });
      if (!page.channel?.id) throw new Error("Slack did not return the DM channel.");
      return { channelId: page.channel.id as string, threadTs: input.threadTs ?? "" };
    }
    const target = destination(input, this.identity);
    await this.conversation(target.channelId);
    return target;
  }

  async send(input: Destination & { text: string }, operationId: string) {
    const target = await this.target(input);
    const hash = createHash("sha256").update(JSON.stringify([operationId, target, input.text])).digest("hex");
    const id = `${hash.slice(0,8)}-${hash.slice(8,12)}-4${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
    const result = await this.request("chat.postMessage", { channel: target.channelId, text: input.text, ...(target.threadTs && { thread_ts: target.threadTs }), client_msg_id: id });
    return { sent: true, ...target, messageTs: result.ts };
  }

  async upload(input: Destination & { path: string; filename?: string | null; comment?: string | null }, sandbox: FileSandbox) {
    const target = await this.target(input);
    const bytes = await sandbox.readBinaryFile({ path: input.path });
    if (!bytes?.byteLength) throw new Error("The file is missing or empty. Generate it in this session first.");
    if (bytes.byteLength > FILE_LIMIT) throw new Error("File exceeds the 25 MB limit.");
    const filename = basename(input.filename ?? input.path);
    const staged = await this.request("files.getUploadURLExternal", { filename, length: bytes.byteLength });
    const response = await this.transfer(slackFileUrl(staged.upload_url), { method: "POST", body: new Blob([Uint8Array.from(bytes)]), redirect: "error", signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Slack file upload failed (HTTP ${response.status}).`);
    await this.request("files.completeUploadExternal", { files: [{ id: staged.file_id, title: filename }], channel_id: target.channelId, ...(target.threadTs && { thread_ts: target.threadTs }), ...(input.comment && { initial_comment: input.comment }) });
    return { sent: true, ...target, fileId: staged.file_id, filename };
  }

  async download(input: { fileId: string; channelId?: string | null }, sandbox: FileSandbox, token: () => Promise<string>) {
    const channelId = input.channelId ?? this.identity.channelId;
    await this.conversation(channelId);
    const { file } = await this.request("files.info", { file: input.fileId });
    const shared = [...(file?.channels ?? []), ...(file?.groups ?? []), ...(file?.ims ?? []), ...Object.keys(file?.shares?.public ?? {}), ...Object.keys(file?.shares?.private ?? {})];
    if (!shared.includes(channelId)) throw new Error("That file is not shared in the selected conversation. Attach it here or specify a conversation you belong to.");
    if (file.size > FILE_LIMIT) throw new Error("File exceeds the 25 MB limit.");
    const response = await this.transfer(slackFileUrl(file.url_private_download ?? file.url_private), { headers: { authorization: `Bearer ${await token()}` }, redirect: "error", signal: AbortSignal.timeout(60_000) });
    const bytes = await boundedBytes(response);
    const filename = basename(String(file.name ?? input.fileId)).replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = posix.join("/workspace/attachments", `${input.fileId}-${filename}`);
    await sandbox.writeBinaryFile({ path, content: bytes });
    return { path, filename, size: bytes.byteLength, mimeType: file.mimetype };
  }
}
