import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { compileAgent } = await import(new URL("./compiler/compile-agent.js", import.meta.resolve("eve")));
const { bundleAuthoredModuleMapForGeneration } = await import(new URL("./internal/authored-module-loader.js", import.meta.resolve("eve")));

test("Eve compiles reachable authored steps while leaving workflow skill templates as assets", async () => {
  const root = await mkdtemp(join(tmpdir(), "gtm-workflow-discovery-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "discovery-fixture", type: "module", dependencies: { eve: "0.52.5" } }));
    await symlink(fileURLToPath(new URL("../node_modules", import.meta.url)), join(root, "node_modules"), "dir");
    const skill = join(root, "agent", "skills", "example");
    await mkdir(skill, { recursive: true });
    await writeFile(join(root, "agent", "instructions.md"), "Test workflow discovery.\n");
    await writeFile(join(skill, "SKILL.md"), "---\nname: example\ndescription: Example workflow assets.\n---\n# Example\n");
    await writeFile(join(skill, "template.ts"), 'import { db } from "missing-workflow-database";\nexport async function template() { "use step"; return db(); }\n');
    await writeFile(join(root, "agent", "agent.ts"), 'import { defineAgent } from "eve";\nexport default defineAgent({ model: "openai/gpt-5.4" });\n');
    await mkdir(join(root, "agent", "tools"));
    await writeFile(join(root, "agent", "tools", "example.ts"), 'import { defineTool } from "eve/tools";\nimport { z } from "zod";\nimport { example } from "../step.ts";\nexport default defineTool({ description: "Example", inputSchema: z.object({}), async execute() { return example(); } });\n');
    const authored = join(root, "agent", "step.ts");
    await writeFile(authored, 'export async function example() { "use step"; return 1; }\n');
    const { manifest } = await compileAgent({ startPath: root });
    const result = await bundleAuthoredModuleMapForGeneration({ manifest, moduleMapPath: join(root, ".eve", "test-modules.mjs") });
    assert.deepEqual(result.authoredWorkflowModules.directiveModules, [authored]);
    assert.deepEqual(result.authoredWorkflowModules.workflowModules, []);
    assert.doesNotMatch(result.code, /missing-workflow-database/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
