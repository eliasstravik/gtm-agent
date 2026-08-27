import assert from "node:assert/strict";
import test from "node:test";

import {
  createSourceGitNetworkPolicy,
  hydrateSourceCheckout,
} from "../agent/lib/source-checkout.ts";

const source = {
  allowedSlackUserIds: ["U012345678"],
  branch: "main",
  checkoutDirectory: "/workspace/.eve-source/eve",
  connector: "github/eve-source",
  deployedSha: "a".repeat(40),
  owner: "acme",
  repo: "eve",
  repository: "acme/eve",
};

test("source hydration uses exact-repository read egress then closes it", async () => {
  const commands = [];
  const policies = [];
  const sandbox = {
    async run({ command }) {
      commands.push(command);
      return commands.length === 1
        ? { exitCode: 0, stderr: "", stdout: "" }
        : { exitCode: 0, stderr: "", stdout: `${source.deployedSha}\n` };
    },
    async setNetworkPolicy(policy) {
      policies.push(policy);
    },
  };
  let opened;
  const result = await hydrateSourceCheckout({
    authorization: "Basic secret",
    source,
    async use(options) {
      opened = options.networkPolicy;
      return sandbox;
    },
  });

  assert.deepEqual(opened, createSourceGitNetworkPolicy(source, "Basic secret"));
  assert.deepEqual(policies, ["deny-all"]);
  assert.equal(result.head, source.deployedSha);
  assert.match(commands[0], /--depth=1/);
  assert.match(commands[0], /agent\/schedules/);
  assert.match(commands[0], /remote remove origin/);
  assert.doesNotMatch(commands.join("\n"), /Basic secret/);
  assert.match(commands[1], /agent\/agent\.ts/);
  assert.match(commands[1], /Unexpected credential variable/);
  assert.match(commands[1], /120000/);
  assert.match(commands[1], /160000/);
});
