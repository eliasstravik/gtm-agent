import type { SourceProposalConfiguration } from "./config.ts";

type AuthContext = {
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly authenticator?: string;
  readonly principalId?: string;
  readonly principalType?: string;
} | null;

export function slackUserIdFromSourceAuth(auth: AuthContext): string | null {
  if (
    auth?.authenticator !== "slack-webhook" ||
    auth.principalType !== "user"
  ) {
    return null;
  }
  const userId = auth.attributes?.user_id;
  return typeof userId === "string" && /^U[A-Z0-9]{8,}$/.test(userId)
    ? userId
    : null;
}

export function isAllowedSourceCaller(
  source: SourceProposalConfiguration,
  auth: AuthContext,
): boolean {
  const userId = slackUserIdFromSourceAuth(auth);
  return userId !== null && source.allowedSlackUserIds.includes(userId);
}
