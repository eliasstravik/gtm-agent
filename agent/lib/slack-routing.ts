/** Group DMs use message.mpim; only an explicit mention starts a new conversation there. */
export function isAddressedGroupDM(raw: Record<string, unknown>, mentioned: boolean): boolean {
  return raw.channel_type === "mpim" && mentioned && !raw.bot_id && (!raw.subtype || raw.subtype === "file_share");
}
