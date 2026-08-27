import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  captureSourceProposal,
  parseSourceStatus,
} from "../agent/lib/source-proposal.ts";

test("status capture accepts only unstaged writes, untracked files, and deletions", () => {
  assert.deepEqual(parseSourceStatus(" M agent/instructions.md\n?? agent/schedules/joke.ts\n"), [
    { operation: "write", path: "agent/instructions.md" },
    { operation: "write", path: "agent/schedules/joke.ts" },
  ]);
  assert.throws(() => parseSourceStatus("R  agent/a.ts -> agent/b.ts\n"), /unsupported/i);
});

test("proposal capture freezes a complete allowed diff and leaves the index clean", async () => {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "eve-source-proposal-"));
  const repository = join(temporaryRoot, "eve");
  try {
    await mkdir(join(repository, "agent", "schedules"), { recursive: true });
    await writeFile(join(repository, "agent", "agent.ts"), "export default {};\n");
    await writeFile(join(repository, "agent", "instructions.md"), "# Instructions\n\nOriginal.\n");
    git(repository, ["init", "--initial-branch=main"]);
    git(repository, ["config", "user.name", "Fixture"]);
    git(repository, ["config", "user.email", "fixture@example.test"]);
    git(repository, ["add", "."]);
    git(repository, ["commit", "-m", "fixture"]);
    const head = git(repository, ["rev-parse", "HEAD"]);
    await writeFile(join(repository, "agent", "instructions.md"), "# Instructions\n\nUpdated.\n");
    await writeFile(join(repository, "agent", "schedules", "joke.ts"), "export default {};\n");

    const sandbox = {
      async readTextFile({ path }) {
        try {
          return await readFile(path, "utf8");
        } catch (error) {
          if (error.code === "ENOENT") return null;
          throw error;
        }
      },
      async run({ command }) {
        const result = spawnSync("bash", ["-c", command], {
          encoding: "utf8",
          env: { HOME: temporaryRoot, PATH: process.env.PATH },
        });
        return {
          exitCode: result.status ?? 1,
          stderr: result.stderr,
          stdout: result.stdout,
        };
      },
    };
    const proposal = await captureSourceProposal(sandbox, {
      allowedSlackUserIds: ["U012345678"],
      branch: "main",
      checkoutDirectory: repository,
      connector: "github/eve-source",
      deployedSha: head,
      owner: "acme",
      repo: "eve",
      repository: "acme/eve",
    });

    assert.deepEqual(proposal.paths, [
      "agent/instructions.md",
      "agent/schedules/joke.ts",
    ]);
    assert.match(proposal.diff, /Updated\./);
    assert.match(proposal.diff, /joke\.ts/);
    assert.match(proposal.hash, /^[0-9a-f]{64}$/);
    assert.equal(git(repository, ["diff", "--cached", "--name-only"]), "");
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

function git(cwd, args) {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    stdio: "pipe",
  }).trim();
}
