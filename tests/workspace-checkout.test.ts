import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { workspaceCheckout } from "../agent/lib/workspace-checkout.ts";

test("bootstrap can repeat and update a checkout, but preserves conflicting work", () => {
  const root = mkdtempSync(join(tmpdir(), "workspace-checkout-"));
  const remote = join(root, "remote");
  const target = join(root, "agent's workspace");
  const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const setup = (url = remote) => spawnSync("bash", ["-c", workspaceCheckout(url, target)], { encoding: "utf8" });
  const commit = (content: string) => {
    writeFileSync(join(remote, "data.txt"), content);
    git("-C", remote, "add", ".");
    git("-C", remote, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "-qm", content);
  };
  try {
    git("init", "-q", "-b", "main", remote);
    commit("first");
    assert.equal(setup().status, 0);
    assert.equal(setup().status, 0);
    commit("second");
    assert.equal(setup().status, 0);
    assert.equal(readFileSync(join(target, "data.txt"), "utf8"), "second");
    writeFileSync(join(target, "data.txt"), "local edit");
    commit("third");
    assert.notEqual(setup().status, 0);
    assert.equal(readFileSync(join(target, "data.txt"), "utf8"), "local edit");
    assert.notEqual(setup(join(root, "different-origin")).status, 0);
    assert.equal(readFileSync(join(target, "data.txt"), "utf8"), "local edit");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
