import assert from "node:assert/strict";
import { test } from "node:test";
import { runBoundedBash } from "../agent/lib/bounded-bash.ts";

test("a stuck command returns control and stops the sandbox even if run ignores abort", async () => {
  let signal;
  let stopped = false;
  const result = await runBoundedBash({
    run(input) { signal = input.abortSignal; return new Promise(() => {}); },
    async stop() { stopped = true; },
  }, "script -q -c 'read answer' /dev/null", { timeoutMs: 20, stopTimeoutMs: 20 });
  assert.equal(result.exitCode, 124);
  assert.equal(signal.aborted, true);
  assert.equal(stopped, true);
  assert.match(result.stderr, /stopped/i);
});

test("a stalled stop request is bounded and reports unconfirmed termination", async () => {
  const result = await runBoundedBash({
    run() { return new Promise(() => {}); },
    stop() { return new Promise(() => {}); },
  }, "sleep 999", { timeoutMs: 20, stopTimeoutMs: 20 });
  assert.equal(result.exitCode, 124);
  assert.match(result.stderr, /could not confirm/i);
});

test("normal failures preserve exit status and bounded output without stopping the sandbox", async () => {
  const result = await runBoundedBash({
    async run() { return { exitCode: 2, stdout: "x".repeat(100_000), stderr: "invalid schema" }; },
    async stop() { assert.fail("normal command must not stop the sandbox"); },
  }, "check");
  assert.equal(result.exitCode, 2);
  assert.equal(result.truncated, true);
  assert.ok(result.stdout.length < 70_000);
  assert.equal(result.stderr, "invalid schema");
});
