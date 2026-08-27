import assert from "node:assert/strict";
import test from "node:test";

import deleteSourceFile from "../agent/subagents/source_editor/tools/delete_source_file.ts";
import listSourceFiles from "../agent/subagents/source_editor/tools/list_source_files.ts";
import readSourceFile from "../agent/subagents/source_editor/tools/read_source_file.ts";
import writeSourceFile from "../agent/subagents/source_editor/tools/write_source_file.ts";

const SOURCE_ENVIRONMENT = {
  EVE_SOURCE_ALLOWED_SLACK_USER_IDS: "U012345678",
  EVE_SOURCE_DEPLOYED_SHA: "a".repeat(40),
  EVE_SOURCE_GITHUB_CONNECTOR: "github/eve-source",
  EVE_SOURCE_REPOSITORY: "acme/eve",
  SLACK_CONNECTOR: "slack/eve",
};

test("source tools use concrete absolute paths and make missing deletion idempotent", async () => {
  await withSourceEnvironment(async () => {
    const reads = [];
    const writes = [];
    let removals = 0;
    const sandbox = {
      async readTextFile({ path }) {
        reads.push(path);
        return null;
      },
      async removePath() {
        removals += 1;
      },
      async writeTextFile(entry) {
        writes.push(entry);
      },
    };
    const ctx = { async getSandbox() { return sandbox; } };

    const deletion = await deleteSourceFile.execute(
      { path: "agent/schedules/old-joke.ts" },
      ctx,
    );
    assert.deepEqual(deletion, {
      alreadyAbsent: true,
      deleted: false,
      path: "agent/schedules/old-joke.ts",
      status: "already_absent",
    });
    assert.equal(removals, 0);

    await writeSourceFile.execute(
      {
        path: "agent/schedules/swedish-joke.ts",
        content: "export default {};\n",
      },
      ctx,
    );
    assert.equal(
      reads[0],
      "/workspace/.eve-source/eve/agent/schedules/old-joke.ts",
    );
    assert.equal(
      reads[1],
      "/workspace/.eve-source/eve/agent/schedules/swedish-joke.ts",
    );
    assert.equal(
      writes[0].path,
      "/workspace/.eve-source/eve/agent/schedules/swedish-joke.ts",
    );
  });
});

test("source inspection tools expose only repository-relative allowed files", async () => {
  await withSourceEnvironment(async () => {
    const sandbox = {
      async readTextFile({ path }) {
        assert.equal(
          path,
          "/workspace/.eve-source/eve/agent/instructions.md",
        );
        return "# Instructions\n";
      },
      async run() {
        return {
          exitCode: 0,
          stderr: "",
          stdout: [
            "agent/instructions.md",
            "agent/schedules/daily.ts",
            "agent/schedules/nested/ignored.ts",
          ].join("\n"),
        };
      },
    };
    const ctx = { async getSandbox() { return sandbox; } };

    assert.deepEqual(await listSourceFiles.execute({}, ctx), {
      paths: ["agent/instructions.md", "agent/schedules/daily.ts"],
    });
    assert.deepEqual(
      await readSourceFile.execute({ path: "agent/instructions.md" }, ctx),
      {
        content: "# Instructions\n",
        path: "agent/instructions.md",
        status: "found",
      },
    );
  });
});

async function withSourceEnvironment(callback) {
  const previous = new Map();
  for (const [name, value] of Object.entries(SOURCE_ENVIRONMENT)) {
    previous.set(name, process.env[name]);
    process.env[name] = value;
  }
  try {
    await callback();
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
}
