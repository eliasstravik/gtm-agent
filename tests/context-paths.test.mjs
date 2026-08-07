import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  validateContextMutation,
  validateContextPath,
} from "../agent/lib/context-paths.ts";

const BASE = {
  summary: "Update ICP and remove an obsolete persona",
  manifest: [
    { path: "icps/enterprise.md", operation: "write" },
    { path: "personas/legacy.md", operation: "delete" },
  ],
  expectedHead: "a".repeat(40),
  message: "Update enterprise GTM context",
  additions: [{ path: "icps/enterprise.md", content: "# Enterprise\n" }],
  deletions: [{ path: "personas/legacy.md" }],
};

test("context paths are limited to the published GTM contract", () => {
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "org.md",
    "people/jane-doe/person.md",
    "icps/enterprise.md",
    "personas/champion.md",
    "suborgs/europe/org.md",
    "suborgs/europe/icps/mid-market.md",
    "suborgs/europe/suborgs/nordics/personas/cfo.md",
  ]) {
    assert.doesNotThrow(() => validateContextPath(path));
  }
});

test("unsafe, normalized-looking, and out-of-contract paths are rejected", () => {
  for (const path of [
    "",
    "/org.md",
    "../org.md",
    "suborgs/../org.md",
    "suborgs//org.md",
    "suborgs/Europe/org.md",
    ".git/config",
    "README.md",
    "people/jane/persona.md",
    "suborgs/europe/people/jane/person.md",
    "icps/.hidden.md",
    "icps/a b.md",
    "org.md/extra",
  ]) {
    assert.throws(() => validateContextPath(path), /path/i, path);
  }
});

test("mutation manifest must exactly equal the write/delete payload", () => {
  assert.deepEqual(validateContextMutation(BASE), BASE);

  assert.throws(
    () =>
      validateContextMutation({
        ...BASE,
        manifest: [BASE.manifest[0]],
      }),
    /manifest/i,
  );
});

test("duplicate, conflicting, and root-contract deletions are rejected", () => {
  assert.throws(
    () =>
      validateContextMutation({
        ...BASE,
        additions: [BASE.additions[0], BASE.additions[0]],
        manifest: [BASE.manifest[0], BASE.manifest[0]],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      validateContextMutation({
        ...BASE,
        additions: [{ path: "personas/legacy.md", content: "# Legacy\n" }],
        manifest: [
          { path: "personas/legacy.md", operation: "write" },
          { path: "personas/legacy.md", operation: "delete" },
        ],
      }),
    /conflict/i,
  );
  for (const path of ["org.md", "AGENTS.md", "CLAUDE.md", ".gitignore"]) {
    assert.throws(
      () =>
        validateContextMutation({
          ...BASE,
          additions: [],
          deletions: [{ path }],
          manifest: [{ path, operation: "delete" }],
        }),
      /cannot be deleted/i,
    );
  }
});

test("mutation bounds and full object ids are enforced", () => {
  assert.throws(
    () => validateContextMutation({ ...BASE, expectedHead: "abc123" }),
    /full Git object ID/i,
  );
  assert.throws(
    () =>
      validateContextMutation({
        ...BASE,
        additions: [
          { path: "icps/enterprise.md", content: "x".repeat(MAX_FILE_BYTES + 1) },
        ],
      }),
    /too large/i,
  );
});

test("combined addition bounds count UTF-8 bytes across files", () => {
  const firstContent = "é".repeat(MAX_FILE_BYTES / 2);
  const secondContent = "é".repeat(MAX_FILE_BYTES / 2);
  const thirdContent = "é".repeat(MAX_FILE_BYTES / 2);
  const fourthContent = "é".repeat(MAX_FILE_BYTES / 2);
  const fifthContent = "é";
  assert.throws(
    () =>
      validateContextMutation({
        summary: "Oversized aggregate",
        expectedHead: "a".repeat(40),
        message: "Test aggregate limit",
        manifest: [
          { path: "icps/one.md", operation: "write" },
          { path: "icps/two.md", operation: "write" },
          { path: "icps/three.md", operation: "write" },
          { path: "icps/four.md", operation: "write" },
          { path: "icps/five.md", operation: "write" },
        ],
        additions: [
          { path: "icps/one.md", content: firstContent },
          { path: "icps/two.md", content: secondContent },
          { path: "icps/three.md", content: thirdContent },
          { path: "icps/four.md", content: fourthContent },
          { path: "icps/five.md", content: fifthContent },
        ],
        deletions: [],
      }),
    /combined addition content is too large/i,
  );
  assert.equal(
    Buffer.byteLength(firstContent) +
      Buffer.byteLength(secondContent) +
      Buffer.byteLength(thirdContent) +
      Buffer.byteLength(fourthContent) +
      Buffer.byteLength(fifthContent),
    MAX_TOTAL_BYTES + 2,
  );
});
