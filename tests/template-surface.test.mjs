import assert from "node:assert/strict";
import { access, readFile, readdir } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

async function exists(path) {
  try {
    await access(new URL(path, root));
    return true;
  } catch {
    return false;
  }
}

test("agent selects the approved model and official minimal Slack channel", async () => {
  const agent = await read("agent/agent.ts");
  const slack = await read("agent/channels/slack.ts");

  assert.match(agent, /anthropic\/claude-sonnet-5/);
  assert.match(slack, /connectSlackCredentials/);
  assert.match(slack, /slackChannel/);
  assert.match(slack, /getConfiguration/);
  assert.doesNotMatch(slack, /slack\/my-agent|\?\?/);
  assert.doesNotMatch(slack, /@slack|WebClient|onInteraction/);
});

test("sandbox is Vercel-backed, deny-all by default, and repository-optional", async () => {
  const sandbox = await read("agent/sandbox.ts");

  assert.match(sandbox, /defineSandbox/);
  assert.match(sandbox, /vercel\(/);
  assert.match(sandbox, /networkPolicy:\s*"deny-all"/);
  assert.match(sandbox, /if \(configuration\.context === null\)/);
  assert.match(sandbox, /contents:read/);
  assert.match(sandbox, /metadata:read/);
  assert.doesNotMatch(sandbox, /contents:write/);
  assert.match(sandbox, /authorizationDetails/);
  assert.match(sandbox, /hydrateContextWorkspace/);
});

test("the sole authored write tool is approval-gated and repository-bound", async () => {
  const tools = await readdir(new URL("agent/tools/", root));
  assert.deepEqual(tools.sort(), ["apply_gtm_context_changes.ts"]);

  const tool = await read("agent/tools/apply_gtm_context_changes.ts");
  assert.match(tool, /approval:\s*always\(\)/);
  assert.match(tool, /summary[\s\S]+manifest[\s\S]+expectedHead[\s\S]+message[\s\S]+additions[\s\S]+deletions/);
  assert.match(tool, /contents:read/);
  assert.match(tool, /contents:write/);
  assert.match(tool, /metadata:read/);
  assert.match(tool, /authorizationDetails/);
  assert.match(tool, /retry:\s*\{ enabled: false \}/);
  assert.match(tool, /request:\s*\{ timeout: 15_000 \}/);
  assert.match(tool, /createCommitOnMain/);
  assert.match(tool, /runApprovedContextMutation/);

  const schemaBlock = tool.slice(
    tool.indexOf("const inputSchema"),
    tool.indexOf("export default defineTool"),
  );
  for (const forbidden of ["owner", "repo:", "repository", "branch", "connector", "checkoutDirectory"]) {
    assert.doesNotMatch(schemaBlock, new RegExp(forbidden, "i"));
  }
});

test("an invalid connected mutation is rejected before sandbox or token access", async () => {
  const prior = {
    github: process.env.GITHUB_CONNECTOR,
    repository: process.env.GTM_CONTEXT_REPOSITORY,
    slack: process.env.SLACK_CONNECTOR,
  };
  process.env.SLACK_CONNECTOR = "slack/gtm-agent";
  process.env.GITHUB_CONNECTOR = "github/gtm-agent";
  process.env.GTM_CONTEXT_REPOSITORY = "acme-inc/gtm-context";

  try {
    const { default: tool } = await import(
      "../agent/tools/apply_gtm_context_changes.ts"
    );
    let openedSandbox = false;
    await assert.rejects(
      tool.execute(
        {
          summary: "Unsafe write",
          manifest: [{ path: "../org.md", operation: "write" }],
          expectedHead: "a".repeat(40),
          message: "Unsafe write",
          additions: [{ path: "../org.md", content: "unsafe\n" }],
          deletions: [],
        },
        {
          async getSandbox() {
            openedSandbox = true;
            throw new Error("sandbox must not be opened");
          },
        },
      ),
      /GTM context path|path is outside/i,
    );
    assert.equal(openedSandbox, false);
  } finally {
    restore("GITHUB_CONNECTOR", prior.github);
    restore("GTM_CONTEXT_REPOSITORY", prior.repository);
    restore("SLACK_CONNECTOR", prior.slack);
  }
});

test("the tool returns setup guidance before opening a sandbox in Slack-only mode", async () => {
  const priorConnector = process.env.GITHUB_CONNECTOR;
  const priorRepository = process.env.GTM_CONTEXT_REPOSITORY;
  const priorSlackConnector = process.env.SLACK_CONNECTOR;
  process.env.SLACK_CONNECTOR = "slack/gtm-agent";
  delete process.env.GITHUB_CONNECTOR;
  delete process.env.GTM_CONTEXT_REPOSITORY;

  try {
    const { default: tool } = await import(
      "../agent/tools/apply_gtm_context_changes.ts"
    );
    let openedSandbox = false;
    const result = await tool.execute(
      {
        summary: "Write an org update",
        manifest: [{ path: "org.md", operation: "write" }],
        expectedHead: "a".repeat(40),
        message: "Update organization",
        additions: [{ path: "org.md", content: "# Organization\n" }],
        deletions: [],
      },
      {
        async getSandbox() {
          openedSandbox = true;
          throw new Error("sandbox must not be opened");
        },
      },
    );

    assert.equal(openedSandbox, false);
    assert.equal(result.status, "setup_required");
  } finally {
    restore("GITHUB_CONNECTOR", priorConnector);
    restore("GTM_CONTEXT_REPOSITORY", priorRepository);
    restore("SLACK_CONNECTOR", priorSlackConnector);
  }
});

function restore(name, value) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

test("no parallel app shell or generic GitHub extension is present", async () => {
  for (const path of [
    "app/",
    "pages/",
    "api/",
    "components/",
    "vercel.json",
    "agent/extensions/",
    "agent/subagents/",
    "agent/schedules/",
  ]) {
    assert.equal(await exists(path), false, path);
  }
});
