export const MAX_SOURCE_PATHS = 10;
export const MAX_SOURCE_FILE_BYTES = 16 * 1024;
export const MAX_SOURCE_TOTAL_BYTES = 32 * 1024;
export const MAX_SOURCE_DIFF_BYTES = 8 * 1024;

const SCHEDULE_PATH =
  /^agent\/schedules\/[a-z0-9](?:[a-z0-9._-]{0,98}[a-z0-9])?\.(?:md|ts)$/;

export type SourcePathKind = "instructions" | "schedule";

export function classifySourcePath(path: string): SourcePathKind {
  if (path === "agent/instructions.md") return "instructions";
  if (SCHEDULE_PATH.test(path)) return "schedule";
  throw new Error(
    `Eve source path ${JSON.stringify(path)} is outside the self-management allowlist. Only agent/instructions.md and direct agent/schedules/*.md or *.ts files are allowed.`,
  );
}

export function assertSourceWrite(path: string, content: string): SourcePathKind {
  const kind = classifySourcePath(path);
  if (content.includes("\0")) {
    throw new Error(`Eve source file ${JSON.stringify(path)} must be UTF-8 text.`);
  }
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes === 0 || bytes > MAX_SOURCE_FILE_BYTES) {
    throw new Error(
      `Eve source file ${JSON.stringify(path)} must contain 1-${MAX_SOURCE_FILE_BYTES} UTF-8 bytes.`,
    );
  }
  return kind;
}

export function assertSourceDeletion(path: string): void {
  if (classifySourcePath(path) !== "schedule") {
    throw new Error("The self-management publisher cannot delete agent/instructions.md.");
  }
}

export function sourceAbsolutePath(
  checkoutDirectory: string,
  path: string,
): string {
  classifySourcePath(path);
  if (!checkoutDirectory.startsWith("/")) {
    throw new Error(
      "The Eve source checkout directory must be an absolute sandbox path.",
    );
  }
  return `${checkoutDirectory}/${path}`;
}
