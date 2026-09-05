import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const { discoverAuthoredWorkflowModules } = await import(
  new URL("./internal/workflow-bundle/authored-workflow-modules.js", import.meta.resolve("eve"))
);

test("vendored workflow templates are assets, not executable agent steps", async () => {
  const result = await discoverAuthoredWorkflowModules(fileURLToPath(new URL("../", import.meta.url)));
  assert.deepEqual(result, { directiveModules: [], workflowModules: [] });
});

test("workflow discovery skips skill assets while retaining authored steps", async () => {
  const root = await mkdtemp(join(tmpdir(), "gtm-workflow-discovery-"));
  try {
    await writeFile(join(root, "package.json"), JSON.stringify({ name: "discovery-fixture", type: "module" }));
    const skill = join(root, "agent", "skills", "example");
    await mkdir(skill, { recursive: true });
    await writeFile(join(skill, "SKILL.md"), "# Example\n");
    const step = 'export async function example() {\n  "use step";\n  return 1;\n}\n';
    await writeFile(join(skill, "template.ts"), step);
    const authored = join(root, "agent", "step.ts");
    await writeFile(authored, step);
    const result = await discoverAuthoredWorkflowModules(root);
    assert.deepEqual(result.directiveModules, [authored]);
    assert.deepEqual(result.workflowModules, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
