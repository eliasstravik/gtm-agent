import { posix } from "node:path";

export const MAX_PATHS = 50;
/** A workflow scaffold ships a lockfile above 300 KiB; keep headroom for it. */
export const MAX_FILE_BYTES = 1024 * 1024;
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024;

const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const NODE_PREFIX = `(?:suborgs/${SLUG}/)*`;
const WRITABLE_NODE_FILE_PATTERN = new RegExp(
  `^${NODE_PREFIX}(?:ORG\\.md|icps/${SLUG}(?:\\.md|/ICP\\.md)|personas/${SLUG}(?:\\.md|/PERSONA\\.md)|members/${SLUG}/MEMBER\\.md)$`,
);
const LEGACY_DELETE_PATTERN = new RegExp(
  `^${NODE_PREFIX}(?:org\\.md|people/${SLUG}/(?:person|PERSON)\\.md)$`,
);
const WORKFLOW_SEGMENT = "[A-Za-z0-9_.\\[\\]-]+";
const WORKFLOW_PROJECT_FILE_PATTERN = new RegExp(
  `^workflows/(?:${WORKFLOW_SEGMENT}/)*${WORKFLOW_SEGMENT}$`,
);
/** Ignored working state the runtime writes without approval; never tracked. */
const WORKFLOW_IGNORED_ROOT_ENTRIES = new Set([
  ".nitro",
  ".output",
  ".swc",
  ".vercel",
  ".well-known",
  ".workflow-data",
  "data",
]);
const ROOT_ONLY_CONTRACT_FILES = new Set([
  ".gitignore",
  "AGENTS.md",
  "CLAUDE.md",
]);
const PROTECTED_ROOT_DELETIONS = new Set([
  ...ROOT_ONLY_CONTRACT_FILES,
  "ORG.md",
]);

export type WorkspaceManifestEntry = {
  readonly path: string;
  readonly operation: "write" | "delete";
};

export type WorkspaceAddition = {
  readonly path: string;
  readonly content: string;
};

export type WorkspaceDeletion = {
  readonly path: string;
};

export type WorkspaceMutation = {
  readonly summary: string;
  readonly manifest: readonly WorkspaceManifestEntry[];
  readonly expectedHead: string;
  readonly message: string;
  readonly additions: readonly WorkspaceAddition[];
  readonly deletions: readonly WorkspaceDeletion[];
};

export function validateWorkspacePath(
  path: string,
  operation: WorkspaceManifestEntry["operation"] = "write",
): string {
  if (
    path.length === 0 ||
    path.length > 240 ||
    path.startsWith("/") ||
    path.includes("\\") ||
    path.includes("//") ||
    posix.normalize(path) !== path ||
    path.split("/").includes(".git")
  ) {
    throw new Error(`Invalid GTM workspace path: ${JSON.stringify(path)}.`);
  }

  if (
    !ROOT_ONLY_CONTRACT_FILES.has(path) &&
    !WRITABLE_NODE_FILE_PATTERN.test(path) &&
    !isWorkflowProjectPath(path) &&
    !(operation === "delete" && LEGACY_DELETE_PATTERN.test(path))
  ) {
    throw new Error(`Path is outside the GTM workspace contract: ${path}.`);
  }

  return path;
}

export function validateWorkspaceMutation<T extends WorkspaceMutation>(input: T): T {
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
    "write",
  );
  const deletionPaths = validateUniquePaths(
    input.deletions.map((entry) => entry.path),
    "deletion",
    "delete",
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
    if (PROTECTED_ROOT_DELETIONS.has(path)) {
      throw new Error(`Root contract file cannot be deleted: ${path}.`);
    }
  }

  if (deletionPaths.has("org.md") && !additionPaths.has("ORG.md")) {
    throw new Error(
      "Deleting root org.md requires writing root ORG.md in the same mutation.",
    );
  }

  if (input.manifest.length !== payloadCount) {
    throw new Error("Manifest must contain exactly one entry for every payload path.");
  }

  const manifestOperations = new Map<
    string,
    WorkspaceManifestEntry["operation"]
  >();
  for (const entry of input.manifest) {
    const path = validateWorkspacePath(entry.path, entry.operation);
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

/**
 * Tracked files of the root `workflows/` project owned by `gtm-workflow`.
 * Secrets (`.env*` except `.env.example`), dependencies, and ignored runtime
 * state are outside the contract even though the sandbox may write them.
 */
function isWorkflowProjectPath(path: string): boolean {
  if (!WORKFLOW_PROJECT_FILE_PATTERN.test(path)) return false;
  const segments = path.split("/").slice(1);
  return (
    !WORKFLOW_IGNORED_ROOT_ENTRIES.has(segments[0]) &&
    !segments.includes("node_modules") &&
    !segments.some(
      (segment) => segment.startsWith(".env") && segment !== ".env.example",
    )
  );
}

function validateUniquePaths(
  paths: readonly string[],
  label: string,
  operation: WorkspaceManifestEntry["operation"],
): Set<string> {
  const unique = new Set<string>();
  for (const candidate of paths) {
    const path = validateWorkspacePath(candidate, operation);
    if (unique.has(path)) {
      throw new Error(`Payload contains a duplicate ${label} path: ${path}.`);
    }
    unique.add(path);
  }
  return unique;
}
