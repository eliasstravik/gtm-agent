import type { SandboxSessionUseFn } from "eve/sandbox";
import type { Configuration } from "./config.ts";
import { sessionNetworkPolicy } from "./workflow-session.ts";

type SessionUse = SandboxSessionUseFn<{ readonly networkPolicy?: ReturnType<typeof sessionNetworkPolicy> }>;

function quote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export async function hydrateWorkspace(
  config: Configuration,
  authorization: string,
  use: SessionUse,
): Promise<void> {
  const baseline = sessionNetworkPolicy(config);
  const sandbox = await use({ networkPolicy: sessionNetworkPolicy(config, authorization) });
  const remote = `https://x-access-token:gtm-sandbox@github.com/${config.workspace.repository}.git`;
  const command = [
    "set -eu",
    `git clone --branch main --single-branch ${quote(remote)} /workspace`,
    "cd /workspace",
    `git config user.name ${quote(config.workspace.authorName)}`,
    `git config user.email ${quote(config.workspace.authorEmail)}`,
    `git remote set-url origin ${quote(remote)}`,
    "mkdir -p /tmp/gtm-scratch /opt/gtm-skills/skills",
    'test -d "$HOME/.agents/skills"',
    'cp -R "$HOME/.agents/skills/." /opt/gtm-skills/skills/',
    'find /opt/gtm-skills/skills -name SKILL.md -type f | grep -q .',
    'if [ -f workflows/package-lock.json ]; then cd workflows && npm ci; fi',
  ].join("\n");
  try {
    const result = await sandbox.run({ command });
    if (result.exitCode !== 0) throw new Error(`Workspace startup failed: ${result.stderr.slice(-2_000)}`);
    await verifyWorkspace(sandbox, config);
  } finally {
    await sandbox.setNetworkPolicy(baseline);
  }
}

export async function verifyWorkspace(
  sandbox: { run(input: { command: string }): PromiseLike<{ exitCode: number; stdout: string; stderr: string }> },
  config: Configuration,
): Promise<string> {
  const expected = `https://x-access-token:gtm-sandbox@github.com/${config.workspace.repository}.git`;
  const result = await sandbox.run({
    command: `cd /workspace && test "$(git branch --show-current)" = main && test "$(git remote get-url origin)" = ${quote(expected)} && git rev-parse HEAD`,
  });
  const head = result.stdout.trim();
  if (result.exitCode !== 0 || !/^[0-9a-f]{40,64}$/i.test(head)) throw new Error("Workspace checkout verification failed.");
  return head;
}
