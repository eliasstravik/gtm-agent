import { posix } from "node:path";

export const MAX_PATHS = 50;
export const MAX_FILE_BYTES = 256 * 1024;
export const MAX_TOTAL_BYTES = 1024 * 1024;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NODE_PREFIX = `(?:suborgs/${SLUG}/)*`;
const NODE_FILE_PATTERN = new RegExp(
  `^${NODE_PREFIX}(?:org\\.md|icps/${SLUG}\\.md|personas/${SLUG}\\.md)$`,
);
const PERSON_PATTERN = new RegExp(`^people/${SLUG}/person\\.md$`);
const ROOT_CONTRACT_FILES = new Set([
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
  "org.md",
]);
const PROTECTED_DELETIONS = new Set(ROOT_CONTRACT_FILES);

export type ContextManifestEntry = {
  readonly path: string;
  readonly operation: "write" | "delete";
};

export type ContextAddition = {
  readonly path: string;
  readonly content: string;
};

export type ContextDeletion = {
  readonly path: string;
};

export type ContextMutation = {
  readonly summary: string;
  readonly manifest: readonly ContextManifestEntry[];
  readonly expectedHead: string;
  readonly message: string;
  readonly additions: readonly ContextAddition[];
  readonly deletions: readonly ContextDeletion[];
};

export function validateContextPath(path: string): string {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    posix.normalize(path) !== path ||
    path.split("/").includes(".git")
  ) {
    throw new Error(`Invalid GTM context path: ${JSON.stringify(path)}.`);
  }

  if (
    !ROOT_CONTRACT_FILES.has(path) &&
    !PERSON_PATTERN.test(path) &&
    !NODE_FILE_PATTERN.test(path)
  ) {
    throw new Error(`Path is outside the GTM context contract: ${path}.`);
  }

  return path;
}

export function validateContextMutation<T extends ContextMutation>(input: T): T {
  if (input.summary.trim().length === 0 || input.summary.length > 240) {
    throw new Error("Mutation summary must contain 1–240 characters.");
  }
  if (input.message.trim().length === 0 || input.message.length > 120) {
    throw new Error("Commit message must contain 1–120 characters.");
  }
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(input.expectedHead)) {
    throw new Error("expectedHead must be a full Git object ID.");
  }

  const payloadCount = input.additions.length + input.deletions.length;
  if (payloadCount === 0 || payloadCount > MAX_PATHS) {
    throw new Error(`A mutation must contain 1–${MAX_PATHS} paths.`);
  }

  const additionPaths = validateUniquePaths(
    input.additions.map((entry) => entry.path),
    "addition",
  );
  const deletionPaths = validateUniquePaths(
    input.deletions.map((entry) => entry.path),
    "deletion",
  );

  for (const path of additionPaths) {
    if (deletionPaths.has(path)) {
      throw new Error(`Path cannot conflict between writes and deletions: ${path}.`);
    }
  }

  let totalBytes = 0;
  for (const addition of input.additions) {
    const bytes = Buffer.byteLength(addition.content, "utf8");
    if (bytes === 0) {
      throw new Error(`Addition content cannot be empty: ${addition.path}.`);
    }
    if (bytes > MAX_FILE_BYTES) {
      throw new Error(`Addition is too large: ${addition.path}.`);
    }
    totalBytes += bytes;
  }
  if (totalBytes > MAX_TOTAL_BYTES) {
    throw new Error("Combined addition content is too large.");
  }

  for (const path of deletionPaths) {
    if (PROTECTED_DELETIONS.has(path)) {
      throw new Error(`Root contract file cannot be deleted: ${path}.`);
    }
  }

  if (input.manifest.length !== payloadCount) {
    throw new Error("Manifest must contain exactly one entry for every payload path.");
  }

  const manifestOperations = new Map<string, ContextManifestEntry["operation"]>();
  for (const entry of input.manifest) {
    const path = validateContextPath(entry.path);
    const prior = manifestOperations.get(path);
    if (prior !== undefined) {
      if (prior !== entry.operation) {
        throw new Error(`Manifest contains a conflicting operation for ${path}.`);
      }
      throw new Error(`Manifest contains a duplicate path: ${path}.`);
    }
    manifestOperations.set(path, entry.operation);
  }

  for (const path of additionPaths) {
    if (manifestOperations.get(path) !== "write") {
      throw new Error(`Manifest does not match write payload for ${path}.`);
    }
  }
  for (const path of deletionPaths) {
    if (manifestOperations.get(path) !== "delete") {
      throw new Error(`Manifest does not match deletion payload for ${path}.`);
    }
  }

  return input;
}

function validateUniquePaths(paths: readonly string[], label: string): Set<string> {
  const unique = new Set<string>();
  for (const candidate of paths) {
    const path = validateContextPath(candidate);
    if (unique.has(path)) {
      throw new Error(`Payload contains a duplicate ${label} path: ${path}.`);
    }
    unique.add(path);
  }
  return unique;
}
