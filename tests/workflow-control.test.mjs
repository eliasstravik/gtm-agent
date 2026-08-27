import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowControl } from "../agent/lib/workflow-control.ts";

const HEAD = "a".repeat(40);
const configuration = {
  productionUrl: "https://acme-workflows.vercel.app",
  projectId: "prj_acme",
  projectName: "acme-workflows",
  runSecret: "run-secret",
  teamId: "team_acme",
  vercelToken: "vercel-secret",
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

function deploymentSource() {
  const files = [
    [
      "package.json",
      JSON.stringify({
        gtm: {
          libVersion: 4,
          vercel: {
            project: configuration.projectName,
            team: "acme",
            url: configuration.productionUrl,
          },
        },
      }),
    ],
    [
      ".env.example",
      "TURSO_DATABASE_URL=\nTURSO_AUTH_TOKEN=\nGTM_RUN_SECRET=\nAI_GATEWAY_API_KEY=\n",
    ],
    ["drizzle/0000_init.sql", "select 1;\n"],
    ["workflows/proof.ts", "export const proof = true;\n"],
  ].map(([file, content]) => ({
    data: Buffer.from(content).toString("base64"),
    file,
    size: Buffer.byteLength(content),
  }));
  return JSON.stringify({
    files,
    totalBytes: files.reduce((total, file) => total + file.size, 0),
  });
}

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

function fakeVercel(overrides = {}) {
  const uploads = [];
  const deployments = {
    uploads,
    async uploadFile(input) {
      uploads.push(input);
      return {};
    },
    async createDeployment(input) {
      return {
        id: "dpl_acme",
        meta: input.requestBody.meta,
        projectId: configuration.projectId,
        readyState: "BUILDING",
        url: "acme-123.vercel.app",
      };
    },
    async getDeployment({ idOrUrl }) {
      return {
        id: idOrUrl === "acme-workflows.vercel.app" ? "dpl_current" : "dpl_acme",
        meta: { gtmWorkspaceHead: HEAD },
        projectId: configuration.projectId,
        readyState: "READY",
        url: "acme-123.vercel.app",
      };
    },
    ...overrides.deployments,
  };
  return {
    deployments,
    projects: {
      async filterProjectEnvs() {
        return {
          envs: [
            "TURSO_DATABASE_URL",
            "TURSO_AUTH_TOKEN",
            "GTM_RUN_SECRET",
            "AI_GATEWAY_API_KEY",
          ].map((key) => ({ key, target: ["production"] })),
        };
      },
      ...overrides.projects,
    },
  };
}

function dependencies(vercel) {
  return {
    createVercel() {
      return vercel;
    },
    async getOidcToken() {
      return "oidc-token";
    },
    now: (() => {
      let value = 0;
      return () => (value += 1_000);
    })(),
    async pause() {},
  };
}

test("deployment preview validates exact tracked source and production environment without mutating cloud state", async () => {
  const vercel = fakeVercel();
  const { sandbox, commands } = sandboxWith((command) => {
    if (command.includes("npm run gtm -- check")) {
      return ok('{"ok":true,"workflows":1,"libVersion":4}\n');
    }
    if (command.includes("git ls-files -z -- workflows/")) {
      return ok(deploymentSource());
    }
    return ok();
  });
  const control = new WorkflowControl(configuration, workspace, dependencies(vercel));

  const preview = await control.previewDeployment(HEAD, sandbox);

  assert.equal(preview.status, "ready");
  assert.equal(preview.libVersion, 4);
  assert.equal(preview.fileCount, 4);
  assert.equal(preview.migrationCount, 1);
  assert.deepEqual(preview.validation, { ok: true, workflows: 1, libVersion: 4 });
  assert.equal(vercel.deployments.uploads.length, 0);
  assert.equal(commands.some((command) => command.includes("db:migrate")), false);
});

test("approved deployment applies committed migrations, uploads tracked files, and pins the workspace HEAD", async () => {
  const vercel = fakeVercel();
  const { sandbox, commands } = sandboxWith((command) => {
    if (command.includes("npm run gtm -- check")) {
      return ok('{"ok":true,"workflows":1,"libVersion":4}\n');
    }
    if (command.includes("git ls-files -z -- workflows/")) return ok(deploymentSource());
    return ok();
  });
  const control = new WorkflowControl(configuration, workspace, dependencies(vercel));

  const deployed = await control.deploy(HEAD, sandbox);

  assert.deepEqual(deployed, {
    head: HEAD,
    productionUrl: configuration.productionUrl,
    status: "ready",
  });
  assert.equal(commands.filter((command) => command.includes("db:migrate")).length, 1);
  assert.equal(vercel.deployments.uploads.length, 4);
  assert.equal(JSON.stringify(deployed).includes("secret"), false);
});

test("run preview is read-only and start requires the same HEAD to be live", async (context) => {
  const vercel = fakeVercel();
  const body = { rows: [{ key: "one" }] };
  const { sandbox } = sandboxWith((command) => {
    if (command.includes("--dry-run")) {
      return ok('{"workflow":"proof","rows":1,"stages":["enrich"],"projectedCostUsd":0.1,"withinCaps":true}\n');
    }
    if (command.includes("readFileSync(path).toString")) {
      return ok(`${Buffer.from(JSON.stringify(body)).toString("base64")}\n`);
    }
    return ok();
  });
  const control = new WorkflowControl(configuration, workspace, dependencies(vercel));
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, init) => {
    requests.push({ url, init });
    return new Response(JSON.stringify({ runKey: "b".repeat(32) }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

  const preview = await control.previewRun({
    checkpoint: 3,
    expectedHead: HEAD,
    inputPath: "workflows/data/proof.json",
    workflowPath: "proof",
    sandbox,
  });
  assert.equal(preview.status, "ready");
  assert.equal(requests.length, 0);

  const started = await control.startRun({
    checkpoint: 3,
    expectedHead: HEAD,
    inputPath: "workflows/data/proof.json",
    workflowPath: "proof",
    sandbox,
  });
  assert.deepEqual(started, { runKey: "b".repeat(32), status: "started" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${configuration.productionUrl}/api/run/proof?checkpoint=3`);
  assert.equal(requests[0].init.headers.authorization, "Bearer run-secret");
  assert.equal(
    requests[0].init.headers["x-vercel-trusted-oidc-idp-token"],
    "oidc-token",
  );
});

test("status and approval never return hook tokens, input, webhook URLs, or credentials", async (context) => {
  const vercel = fakeVercel();
  const control = new WorkflowControl(configuration, workspace, dependencies(vercel));
  const originalFetch = globalThis.fetch;
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
  globalThis.fetch = async (url, init) => {
    if (url.includes("/api/approve/")) {
      approved = true;
      return new Response(JSON.stringify({ approved: true }), { status: 200 });
    }
    return new Response(JSON.stringify(raw()), { status: 200 });
  };
  context.after(() => {
    globalThis.fetch = originalFetch;
  });

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
