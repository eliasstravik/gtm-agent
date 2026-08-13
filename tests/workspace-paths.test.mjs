import assert from "node:assert/strict";
import test from "node:test";

import {
  MAX_FILE_BYTES,
  MAX_TOTAL_BYTES,
  validateWorkspaceMutation,
  validateWorkspacePath,
} from "../agent/lib/workspace-paths.ts";

const BASE = {
  summary: "Update an ICP and remove an obsolete persona",
  manifest: [
    { path: "icps/enterprise/ICP.md", operation: "write" },
    { path: "personas/legacy.md", operation: "delete" },
  ],
  expectedHead: "a".repeat(40),
  message: "Update enterprise GTM workspace",
  additions: [{ path: "icps/enterprise/ICP.md", content: "# Enterprise\n" }],
  deletions: [{ path: "personas/legacy.md" }],
};

test("workspace writes accept root contract files and canonical node paths", () => {
  for (const path of [
    "AGENTS.md",
    "CLAUDE.md",
    ".gitignore",
    "ORG.md",
    "icps/enterprise/ICP.md",
    "personas/champion/PERSONA.md",
    "members/jane-doe/MEMBER.md",
    "suborgs/europe/ORG.md",
    "suborgs/europe/icps/mid-market/ICP.md",
    "suborgs/europe/suborgs/nordics/personas/cfo/PERSONA.md",
    "suborgs/europe/members/jane-doe/MEMBER.md",
  ]) {
    assert.doesNotThrow(() => validateWorkspacePath(path, "write"), path);
  }
});

test("root contract files cannot be written inside a suborganization", () => {
  for (const path of [
    "suborgs/europe/AGENTS.md",
    "suborgs/europe/CLAUDE.md",
    "suborgs/europe/.gitignore",
  ]) {
    assert.throws(() => validateWorkspacePath(path, "write"), /contract/i, path);
  }
});

test("canonical nested files can be deleted while the root organization remains protected", () => {
  for (const path of [
    "suborgs/europe/ORG.md",
    "suborgs/europe/icps/mid-market/ICP.md",
    "suborgs/europe/personas/champion/PERSONA.md",
    "suborgs/europe/members/jane-doe/MEMBER.md",
  ]) {
    assert.doesNotThrow(() => validateWorkspacePath(path, "delete"), path);
  }
  assert.throws(
    () =>
      validateWorkspaceMutation({
        summary: "Attempt to remove the root organization",
        expectedHead: "d".repeat(40),
        message: "Remove root organization",
        manifest: [{ path: "ORG.md", operation: "delete" }],
        additions: [],
        deletions: [{ path: "ORG.md" }],
      }),
    /cannot be deleted/i,
  );
});

test("legacy flat ICP and persona files remain writable at every node", () => {
  for (const path of [
    "icps/enterprise.md",
    "personas/champion.md",
    "suborgs/europe/icps/mid-market.md",
    "suborgs/europe/suborgs/nordics/personas/cfo.md",
  ]) {
    assert.doesNotThrow(() => validateWorkspacePath(path, "write"), path);
  }
});

test("legacy org and people paths are delete-only at every node", () => {
  for (const path of [
    "org.md",
    "people/jane-doe/person.md",
    "people/jane-doe/PERSON.md",
    "suborgs/europe/org.md",
    "suborgs/europe/people/jane-doe/person.md",
    "suborgs/europe/people/jane-doe/PERSON.md",
  ]) {
    assert.doesNotThrow(() => validateWorkspacePath(path, "delete"), path);
    assert.throws(() => validateWorkspacePath(path, "write"), /contract/i, path);
  }
});

test("unsafe, normalized-looking, and out-of-contract paths are rejected", () => {
  for (const path of [
    "",
    "/ORG.md",
    "../ORG.md",
    "suborgs/../ORG.md",
    "suborgs//ORG.md",
    "suborgs/Europe/ORG.md",
    ".git/config",
    "README.md",
    "members/jane-doe/person.md",
    "icps/.hidden/ICP.md",
    "icps/a b/ICP.md",
    "ORG.md/extra",
  ]) {
    assert.throws(() => validateWorkspacePath(path, "write"), /path|contract/i, path);
  }
});

test("mutation manifest must exactly equal the write/delete payload", () => {
  assert.deepEqual(validateWorkspaceMutation(BASE), BASE);

  assert.throws(
    () => validateWorkspaceMutation({ ...BASE, manifest: [BASE.manifest[0]] }),
    /manifest/i,
  );
});

test("duplicate, conflicting, and protected root deletions are rejected", () => {
  assert.throws(
    () =>
      validateWorkspaceMutation({
        ...BASE,
        additions: [BASE.additions[0], BASE.additions[0]],
        manifest: [BASE.manifest[0], BASE.manifest[0]],
      }),
    /duplicate/i,
  );
  assert.throws(
    () =>
      validateWorkspaceMutation({
        ...BASE,
        additions: [{ path: "personas/legacy.md", content: "# Legacy\n" }],
        manifest: [
          { path: "personas/legacy.md", operation: "write" },
          { path: "personas/legacy.md", operation: "delete" },
        ],
      }),
    /conflict/i,
  );
  for (const path of ["ORG.md", "AGENTS.md", "CLAUDE.md", ".gitignore"]) {
    assert.throws(
      () =>
        validateWorkspaceMutation({
          ...BASE,
          additions: [],
          deletions: [{ path }],
          manifest: [{ path, operation: "delete" }],
        }),
      /cannot be deleted/i,
    );
  }
});

test("root legacy org deletion requires a canonical root ORG write in the same mutation", () => {
  const deletion = {
    summary: "Migrate the root organization file",
    expectedHead: "b".repeat(40),
    message: "Migrate root organization file",
    manifest: [{ path: "org.md", operation: "delete" }],
    additions: [],
    deletions: [{ path: "org.md" }],
  };
  assert.throws(() => validateWorkspaceMutation(deletion), /ORG\.md.*same mutation/i);

  const migration = {
    ...deletion,
    manifest: [
      { path: "ORG.md", operation: "write" },
      { path: "org.md", operation: "delete" },
    ],
    additions: [{ path: "ORG.md", content: "# Organization\n" }],
  };
  assert.deepEqual(validateWorkspaceMutation(migration), migration);
});

test("deleting a nested legacy org without pairing is accepted", () => {
  const mutation = {
    summary: "Remove a migrated nested organization file",
    expectedHead: "c".repeat(40),
    message: "Remove nested legacy organization file",
    manifest: [{ path: "suborgs/europe/org.md", operation: "delete" }],
    additions: [],
    deletions: [{ path: "suborgs/europe/org.md" }],
  };
  assert.deepEqual(validateWorkspaceMutation(mutation), mutation);
});

test("mutation bounds and full object ids are enforced", () => {
  assert.throws(
    () => validateWorkspaceMutation({ ...BASE, expectedHead: "abc123" }),
    /full Git object ID/i,
  );
  assert.throws(
    () =>
      validateWorkspaceMutation({
        ...BASE,
        additions: [
          {
            path: "icps/enterprise/ICP.md",
            content: "x".repeat(MAX_FILE_BYTES + 1),
          },
        ],
      }),
    /too large/i,
  );
});

test("combined addition bounds count UTF-8 bytes across files", () => {
  const contents = Array.from({ length: 4 }, () => "é".repeat(MAX_FILE_BYTES / 2));
  const paths = ["one", "two", "three", "four", "five"].map(
    (slug) => `icps/${slug}/ICP.md`,
  );
  assert.throws(
    () =>
      validateWorkspaceMutation({
        summary: "Oversized aggregate",
        expectedHead: "a".repeat(40),
        message: "Test aggregate limit",
        manifest: paths.map((path) => ({ path, operation: "write" })),
        additions: paths.map((path, index) => ({
          path,
          content: contents[index] ?? "é",
        })),
        deletions: [],
      }),
    /combined addition content is too large/i,
  );
  assert.equal(
    contents.reduce((total, content) => total + Buffer.byteLength(content), 0) + 2,
    MAX_TOTAL_BYTES + 2,
  );
});
