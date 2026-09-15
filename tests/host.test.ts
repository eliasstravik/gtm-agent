import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
const base = {
  ...process.env,
  GTM_WORKSPACE_REPOSITORY: "example/gtm-fixture",
  GTM_GITHUB_TOKEN: "github-fixture",
  GTM_WORKFLOW_URL: "https://fixture.vercel.app",
  GTM_RUN_SECRET: "run-fixture",
  GTM_WORKFLOW_BYPASS_SECRET: "gate-fixture",
  GTM_WORKFLOW_GATE_REQUIRED: "1",
};
function load(env: Record<string, string | undefined>) {
  return spawnSync(
    process.execPath,
    [
      "--experimental-strip-types",
      "--input-type=module",
      "-e",
      `const h=await import('./agent/lib/host.ts');console.log(JSON.stringify({allow:h.allow,exports:h.exports,description:h.describeHost()}));`,
    ],
    { env, encoding: "utf8" },
  );
}
test("workflow credentials are injected only for its host and never included in sandbox instructions", () => {
  const result = load(base);
  assert.equal(result.status, 0, result.stderr);
  const host = JSON.parse(result.stdout);
  assert.deepEqual(host.allow["fixture.vercel.app"][0].transform[0].headers, {
    authorization: "Bearer run-fixture",
    "x-vercel-protection-bypass": "gate-fixture",
  });
  assert.deepEqual(host.allow["*"], []);
  assert.equal(
    host.allow["github.com"][0].transform[0].headers[
      "x-vercel-protection-bypass"
    ],
    undefined,
  );
  for (const secret of ["run-fixture", "gate-fixture", "github-fixture"]) {
    assert.ok(!host.exports.includes(secret));
    assert.ok(!host.description.includes(secret));
  }
});
test("protected connections fail closed when gate credentials are missing", () => {
  assert.notEqual(
    load({ ...base, GTM_WORKFLOW_BYPASS_SECRET: undefined }).status,
    0,
  );
});
test("credentialed destinations must be exact HTTPS origins", () => {
  for (const url of [
    "http://fixture.vercel.app",
    "https://user:pass@fixture.vercel.app",
    "https://fixture.vercel.app/path",
    "https://fixture.vercel.app?x=1",
    "https://fixture.vercel.app:8080",
  ])
    assert.notEqual(load({ ...base, GTM_WORKFLOW_URL: url }).status, 0);
});
