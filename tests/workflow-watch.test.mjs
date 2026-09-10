import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { pollUntil } from "../agent/lib/poll.ts";

test("deployment polling follows a delayed version and stops at ten minutes", async () => {
  let time = 0, reads = 0;
  const options = { now: () => time, pause: async () => { time += 10_000; }, timeoutMs: 600_000,
    read: async () => ++reads >= 4 ? "live" : "not_live", ready: value => value === "live" };
  assert.equal(await pollUntil(options), "live");
  assert.equal(reads, 4);
  time = 0; reads = 0;
  assert.equal(await pollUntil({ ...options, read: async () => { reads++; return "not_live"; } }), null);
  assert.equal(time, 600_000);
  assert.equal(reads, 60);
});

test("watch executors use durable suspension and return through the original session", async () => {
  for (const name of ["watch_gtm_deployment", "watch_gtm_run"]) {
    const source = await readFile(new URL(`../agent/tools/${name}.ts`, import.meta.url), "utf8");
    assert.match(source, /defineWorkflowTool/);
    assert.match(source, /execution: "background"/);
    assert.match(source, /"use workflow"/);
    assert.match(source, /sleep\("10s"\)/);
    assert.match(source, /approval: admitWatch/);
    assert.doesNotMatch(source, /setTimeout|channelId: z|threadTs: z/);
  }
});
