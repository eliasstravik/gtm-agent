import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowControl } from "../agent/lib/workflow-control.ts";

const HEAD = "a".repeat(40);
const OLD_HEAD = "d".repeat(40);
const configuration = {
  productionUrl: "https://acme-workflows.vercel.app",
  runSecret: "run-secret",
};
const workspace = {
  branch: "main",
  checkoutDirectory: "$HOME/.gtm/acme",
  connector: "github/acme",
  owner: "acme",
  repo: "workspace",
  repository: "acme/workspace",
  staleMarker: "$HOME/.gtm/.acme.stale",
};

function sandboxWith(handler) {
  const commands = [];
  return {
    commands,
    sandbox: {
      async run({ command }) {
        commands.push(command);
        return handler(command);
      },
    },
  };
}

function ok(stdout = "") {
  return { exitCode: 0, stdout, stderr: "" };
}

function dependencies(fetch) {
  return {
    fetch,
    async getOidcToken() {
      return "oidc-token";
    },
    now: Date.now,
    async pause() {},
  };
}

function runSandbox(body = { rows: [{ key: "one" }] }) {
  return sandboxWith((command) => {
    if (command.includes("--dry-run")) {
      return ok(
        '{"workflow":"proof","rows":1,"stages":["enrich"],"projectedCostUsd":0.1,"withinCaps":true}\n',
      );
    }
    if (command.includes("readFileSync(path).toString")) {
      return ok(`${Buffer.from(JSON.stringify(body)).toString("base64")}\n`);
    }
    return ok();
  });
}

test("run preview is read-only", async () => {
  const requests = [];
  const { sandbox } = runSandbox();
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (...args) => {
      requests.push(args);
      throw new Error("preview must not fetch");
    }),
  );

  const preview = await control.previewRun({
    checkpoint: 3,
    expectedHead: HEAD,
    inputPath: "workflows/data/proof.json",
    workflowPath: "proof",
    sandbox,
  });

  assert.equal(preview.status, "ready");
  assert.equal(preview.head, HEAD);
  assert.equal(requests.length, 0);
});

test("start waits for the exact Git SHA and rechecks it in the run request", async () => {
  const requests = [];
  let deploymentChecks = 0;
  const { sandbox } = runSandbox();
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith("/api/deployment")) {
        deploymentChecks += 1;
        return Response.json({
          head: deploymentChecks === 1 ? OLD_HEAD : HEAD,
        });
      }
      return Response.json({ runKey: "b".repeat(32) });
    }),
  );

  const started = await control.startRun({
    checkpoint: 3,
    expectedHead: HEAD,
    inputPath: "workflows/data/proof.json",
    workflowPath: "proof",
    sandbox,
  });

  assert.deepEqual(started, { runKey: "b".repeat(32), status: "started" });
  assert.equal(deploymentChecks, 2);
  const start = requests.at(-1);
  assert.equal(
    start.url,
    `${configuration.productionUrl}/api/run/proof?checkpoint=3`,
  );
  assert.equal(start.init.headers.authorization, "Bearer run-secret");
  assert.equal(
    start.init.headers["x-vercel-trusted-oidc-idp-token"],
    "oidc-token",
  );
  assert.equal(start.init.headers["x-gtm-workspace-head"], HEAD);
});

test("a deployment race starts nothing", async () => {
  const { sandbox } = runSandbox();
  let starts = 0;
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url) => {
      if (url.endsWith("/api/deployment")) return Response.json({ head: HEAD });
      starts += 1;
      return Response.json(
        {
          error: {
            code: "deployment_not_ready",
            message: "Production changed.",
          },
        },
        { status: 409 },
      );
    }),
  );

  await assert.rejects(
    () =>
      control.startRun({
        checkpoint: null,
        expectedHead: HEAD,
        inputPath: "workflows/data/proof.json",
        workflowPath: "proof",
        sandbox,
      }),
    /No run was started/i,
  );
  assert.equal(starts, 1);
});

test("status and approval never return hook tokens, input, webhook URLs, or credentials", async () => {
  let approved = false;
  const raw = () => ({
    runKey: "c".repeat(32),
    workflow: "proof",
    path: "proof",
    method: "POST",
    status: approved ? "running" : "waiting",
    checkpoint: 3,
    startedAt: 1,
    finishedAt: null,
    completed: 3,
    failed: 0,
    costUsd: 0.3,
    input: { secret: "private-input" },
    webhook_url: "https://unsafe.example/hook",
    approval: {
      stage: "checkpoint",
      summary: "3 rows done",
      token: "proof.hidden-token.checkpoint",
    },
  });
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url) => {
      if (url.includes("/api/approve/")) {
        approved = true;
        return Response.json({ approved: true });
      }
      return Response.json(raw());
    }),
  );

  const status = await control.getRun("c".repeat(32));
  assert.equal(status.approval.stage, "checkpoint");
  assert.equal(JSON.stringify(status).includes("hidden-token"), false);
  assert.equal(JSON.stringify(status).includes("private-input"), false);
  assert.equal(JSON.stringify(status).includes("unsafe.example"), false);

  const resumed = await control.approveRun({
    approved: true,
    comment: "continue",
    runKey: "c".repeat(32),
  });
  assert.equal(resumed.status, "running");
  assert.equal(JSON.stringify(resumed).includes("hidden-token"), false);
});
