import assert from "node:assert/strict";
import test from "node:test";

import { WorkflowControl } from "../agent/lib/workflow-control.ts";

const HEAD = "a".repeat(40);
const OLD_HEAD = "d".repeat(40);

test("trusted preview uses deployment defaults and exposes unavailable auth checks", async () => {
  const { sandbox, commands } = runSandbox(undefined, { paidStages: [{ label: "Score account", provider: "Gateway", model: "deepseek/deepseek-v4.1-flash", unitCostUsd: 0.1 }] });
  const control = new WorkflowControl(configuration, workspace, dependencies(async () => { throw new Error("No paid request expected"); },
    async () => Response.json({ ...PREFLIGHT, auth: [{ provider: "Example", status: "unavailable" }] })));
  const result = await control.previewRun({ expectedHead: HEAD, workflowPath: "proof", inputPath: "workflows/data/proof.json", checkpoint: 1, sandbox });
  assert.equal(result.preflight.auth[0].status, "unavailable");
  assert.equal(result.paidStages[0].model, "deepseek/deepseek-v4.1-flash");
  assert.ok(commands.some(command => command.includes("GTM_AGENT_BACKEND=api GTM_WORKFLOW_MODEL='deepseek/deepseek-v4.1-flash'")));
});

test("changed models, missing tables, stale preflight, and unresolved models stop paid starts", async () => {
  const paidStages = [{ label: "Score account", provider: "Gateway", model: "deepseek/deepseek-v4.1-flash", unitCostUsd: 0.1 }];
  for (const scenario of ["model", "table", "head", "dynamic", "runtime"]) {
    let starts = 0;
    const { sandbox } = runSandbox(undefined, { paidStages: scenario === "dynamic" ? [{ ...paidStages[0], model: "dynamic" }] : scenario === "runtime" ? [{ ...paidStages[0], model: "Selected at runtime" }] : paidStages });
    const preflight = scenario === "table" ? { ...PREFLIGHT, ok: false, missing: ["Table leads"] }
      : scenario === "head" ? { ...PREFLIGHT, head: OLD_HEAD } : PREFLIGHT;
    const control = new WorkflowControl(configuration, workspace, dependencies(async () => { starts++; throw new Error("Paid start must not happen"); }, async () => Response.json(preflight)));
    await assert.rejects(control.startRun({ expectedHead: HEAD, workflowPath: "proof", inputPath: "workflows/data/proof.json", checkpoint: 1,
      sandbox, expectedRows: 1, expectedProjectedCostUsd: 0.1, expectedPaidStages: scenario === "model" ? [{ ...paidStages[0], model: "different/model" }] : paidStages }),
      /model|table|not live/);
    assert.equal(starts, 0);
  }
});
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

const PREFLIGHT = { ok: true, head: HEAD, missing: [], auth: [], modelDefaults: { backend: "api", model: "deepseek/deepseek-v4.1-flash" } };

function dependencies(fetch, preflight = async () => Response.json(PREFLIGHT)) {
  return {
    fetch: (url, init) => String(url).includes("/api/preflight/") ? preflight(url, init) : fetch(url, init),
    async getOidcToken() {
      return "oidc-token";
    },
    now: Date.now,
    async pause() {},
  };
}

function runSandbox(body = { rows: [{ key: "one" }] }, execution = {}) {
  return sandboxWith((command) => {
    if (command.includes("--dry-run")) {
      return ok(
        JSON.stringify({ workflow: "proof", rows: 1, paidStages: [], stages: ["enrich"], projectedCostUsd: 0.1, withinCaps: true, ...execution }),
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
      throw new Error("preview must not call a paid route");
    }, async (...args) => {
      requests.push(args);
      return Response.json(PREFLIGHT);
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
  assert.equal(requests.length, 1);
  assert.ok(requests[0][0].endsWith("/api/preflight/proof"));
  assert.equal(requests[0][1].headers.authorization, "Bearer run-secret");
  assert.equal(preview.preflight.ok, true);
});

test("start binds concurrency, rounded checkpoint, and every child batch limit", async () => {
  const batch = { childWorkflow: "child", table: "leads", batchSize: 5, count: 2, timeoutMs: 60_000 };
  for (const shape of [{ concurrency: 4 }, { concurrency: 2, batch }]) {
    let starts = 0;
    const { sandbox } = runSandbox(undefined, { rows: 9, ...shape });
    const control = new WorkflowControl(configuration, workspace, dependencies(async (url) => {
      if (url.endsWith("/api/deployment")) return Response.json({ head: HEAD });
      starts++;
      return Response.json({ runKey: "b".repeat(32) });
    }));
    const request = { checkpoint: shape.batch ? null : 3, expectedHead: HEAD,
      expectedRows: 9, expectedPaidStages: [], expectedProjectedCostUsd: 0.1, inputPath: "workflows/data/proof.json", workflowPath: "proof", sandbox };
    const preview = await control.previewRun(request);
    assert.equal(preview.execution.checkpoint, shape.batch ? null : 4);
    const changes = [undefined, { ...preview.execution, concurrency: 1 },
      { ...preview.execution, checkpoint: 8 }];
    if (shape.batch) for (const [key, value] of Object.entries({ batchSize: 4, count: 3, timeoutMs: 90_000, childWorkflow: "other", table: "other" })) {
      changes.push({ ...preview.execution, batch: { ...batch, [key]: value } });
    }
    for (const expectedExecution of changes) {
      await assert.rejects(control.startRun({ ...request, expectedExecution }), /accepted execution limits differ/);
    }
    assert.equal(starts, 0);
    assert.equal((await control.startRun({ ...request, expectedExecution: preview.execution })).status, "started");
    assert.equal(starts, 1);
  }
});

test("batch preview rejects checkpoints and malformed limits without starting", async () => {
  for (const shape of [
    { concurrency: 0 },
    { concurrency: 17 },
    { concurrency: 2, batch: { childWorkflow: "child", table: "leads", batchSize: 5, count: 2, timeoutMs: 60_000 } },
  ]) {
    const { sandbox } = runSandbox(undefined, shape);
    const control = new WorkflowControl(configuration, workspace, dependencies(() => { throw new Error("unexpected fetch"); }));
    await assert.rejects(control.previewRun({ checkpoint: 3, expectedHead: HEAD, inputPath: "workflows/data/proof.json", workflowPath: "proof", sandbox }));
  }
});

test("start submits the accepted rounded checkpoint even when fewer rows remain", async () => {
  const { sandbox } = runSandbox(undefined, { rows: 5, concurrency: 4 });
  let startUrl;
  const control = new WorkflowControl(configuration, workspace, dependencies(async (url) => {
    if (url.endsWith("/api/deployment")) return Response.json({ head: HEAD });
    startUrl = url;
    return Response.json({ runKey: "b".repeat(32) });
  }));
  const request = { checkpoint: 8, expectedHead: HEAD, expectedRows: 5,
    expectedPaidStages: [], expectedProjectedCostUsd: 0.1, inputPath: "workflows/data/proof.json", workflowPath: "proof", sandbox };
  const preview = await control.previewRun(request);
  assert.equal(preview.execution.checkpoint, 5);
  await control.startRun({ ...request, expectedExecution: preview.execution });
  assert.equal(startUrl, `${configuration.productionUrl}/api/run/proof?checkpoint=5`);
});

test("parent status and cancellation retain child receipts while dropping private fields", async () => {
  const child = { runKey: "c".repeat(32), workflow: "child", status: "cancelling", completed: 2, failed: 1, costUsd: 0.3, remainingKeys: ["four"] };
  const control = new WorkflowControl(configuration, workspace, dependencies(async () => Response.json({
    runKey: "b".repeat(32), status: "cancelling", remaining_keys: ["four", "five"],
    children: [{ ...child, input: "PRIVATE", trigger_token: "PRIVATE", webhook_url: "PRIVATE", runId: "PRIVATE" }],
  })));
  for (const result of [await control.getRun("b".repeat(32)), await control.cancelRun({ runKey: "b".repeat(32), reason: null })]) {
    assert.deepEqual(result.children, [child]);
    assert.deepEqual(result.remainingKeys, ["four", "five"]);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("agent starts bind the exact accepted capability definition", async () => {
  for (const accepted of [undefined, "d".repeat(64), "c".repeat(64)]) {
    let starts = 0;
    const { sandbox } = sandboxWith((command) => {
      if (command.includes("--dry-run")) return ok(JSON.stringify({ rows: 1, projectedCostUsd: 0.1,
        withinCaps: true, paidStages: [], capabilitiesHash: "c".repeat(64) }));
      if (command.includes("readFileSync(path).toString")) return ok(Buffer.from('{"rows":[]}').toString("base64"));
      return ok();
    });
    const control = new WorkflowControl(configuration, workspace, dependencies(async (url) => {
      if (url.endsWith("/api/deployment")) return Response.json({ head: HEAD });
      starts += 1;
      return Response.json({ runKey: "b".repeat(32) });
    }));
    const request = { checkpoint: null, expectedHead: HEAD, expectedRows: 1,
      expectedPaidStages: [], expectedProjectedCostUsd: 0.1, expectedCapabilitiesHash: accepted,
      inputPath: "workflows/data/proof.json", workflowPath: "proof", sandbox };
    if (accepted === "c".repeat(64)) {
      assert.equal((await control.startRun(request)).status, "started");
      assert.equal(starts, 1);
    } else {
      await assert.rejects(control.startRun(request), /accepted agent capabilities differ/);
      assert.equal(starts, 0);
    }
  }
});

test("trigger uses the fixed protected callback route and reports ended waits", async () => {
  let conflict = false;
  const control = new WorkflowControl(configuration, workspace, dependencies(async (url, init) => {
    assert.equal(url, `${configuration.productionUrl}/api/runs/${"b".repeat(32)}/trigger`);
    assert.equal(init.headers.authorization, "Bearer run-secret");
    assert.deepEqual(JSON.parse(init.body), { event: "enriched" });
    return conflict ? Response.json({ error: { code: "trigger_not_pending" } }, { status: 409 })
      : Response.json({ accepted: true, runKey: "b".repeat(32) });
  }));
  const input = { runKey: "b".repeat(32), payload: { event: "enriched" } };
  assert.equal((await control.triggerRun(input)).status, "triggered");
  conflict = true;
  await assert.rejects(control.triggerRun(input), /no pending trigger/);
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
    expectedPaidStages: [], expectedProjectedCostUsd: 0.1,
    expectedRows: 1,
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
        expectedPaidStages: [], expectedProjectedCostUsd: 0.1,
        expectedRows: 1,
        inputPath: "workflows/data/proof.json",
        workflowPath: "proof",
        sandbox,
      }),
    /No run was started/i,
  );
  assert.equal(starts, 1);
});

test("start refuses when the fresh dry run disagrees with the accepted rows or cost", async () => {
  const { sandbox } = runSandbox();
  let fetched = 0;
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async () => {
      fetched += 1;
      return Response.json({ head: HEAD });
    }),
  );
  for (const accepted of [
    { expectedRows: 2, expectedPaidStages: [], expectedProjectedCostUsd: 0.1 },
    { expectedRows: 1, expectedPaidStages: [], expectedProjectedCostUsd: 0.5 },
    { expectedRows: 1, expectedPaidStages: [], expectedProjectedCostUsd: 0.099 },
  ]) {
    await assert.rejects(
      () =>
        control.startRun({
          checkpoint: null,
          expectedHead: HEAD,
          ...accepted,
          inputPath: "workflows/data/proof.json",
          workflowPath: "proof",
          sandbox,
        }),
      /dry run reports 1 rows? and \$0\.10[\s\S]*No run was started/i,
    );
  }
  assert.equal(fetched, 0);
});

test("a dry run that fails reports the runtime's own error code instead of a caps message", async () => {
  const { sandbox } = sandboxWith((command) =>
    command.includes("--dry-run")
      ? {
          exitCode: 2,
          stdout: "",
          stderr: '{"error":{"code":"invalid_checkpoint","message":"scheduled workflows do not accept --checkpoint"}}\n',
        }
      : ok(),
  );
  const control = new WorkflowControl(configuration, workspace, dependencies(async () => {
    throw new Error("must not fetch");
  }));
  await assert.rejects(
    () =>
      control.previewRun({
        checkpoint: 1,
        expectedHead: HEAD,
        inputPath: "workflows/data/proof.json",
        workflowPath: "proof",
        sandbox,
      }),
    /invalid_checkpoint[\s\S]*do not accept --checkpoint/,
  );
});

test("cancel posts to the bearer-protected cancel route and returns a sanitized run", async () => {
  const requests = [];
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url, init) => {
      requests.push({ url, init });
      return Response.json({
        runKey: "c".repeat(32),
        workflow: "proof",
        path: "proof",
        method: "POST",
        status: "cancelled",
        checkpoint: null,
        startedAt: 1,
        finishedAt: 2,
        completed: 3,
        failed: 0,
        costUsd: 0.3,
        error: "cancelled: operator stopped it",
        input: { secret: "private-input" },
        approval: { stage: "checkpoint", summary: "3 rows done", token: "proof.hidden-token.checkpoint" },
      });
    }),
  );
  const cancelled = await control.cancelRun({ runKey: "c".repeat(32), reason: "operator stopped it" });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, `${configuration.productionUrl}/api/runs/${"c".repeat(32)}/cancel`);
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { reason: "operator stopped it" });
  assert.equal(requests[0].init.headers.authorization, "Bearer run-secret");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(JSON.stringify(cancelled).includes("hidden-token"), false);
  assert.equal(JSON.stringify(cancelled).includes("private-input"), false);
});

test("cancelling a finished run reports the current state instead of failing", async () => {
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url) => {
      if (url.endsWith("/cancel")) {
        return Response.json(
          { error: { code: "run_not_active", message: "already completed", runKey: "c".repeat(32), status: "completed" } },
          { status: 409 },
        );
      }
      return Response.json({
        runKey: "c".repeat(32),
        workflow: "proof",
        path: "proof",
        method: "POST",
        status: "completed",
        checkpoint: null,
        startedAt: 1,
        finishedAt: 2,
        completed: 20,
        failed: 0,
        costUsd: 2,
        input: {},
        approval: null,
      });
    }),
  );
  const result = await control.cancelRun({ runKey: "c".repeat(32), reason: null });
  assert.equal(result.status, "completed");
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

test("the deployment check is read-only and reports live only for the exact commit", async () => {
  const requests = [];
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async (url, init) => {
      requests.push([url, init]);
      return Response.json({ head: HEAD });
    }),
  );

  assert.deepEqual(await control.getDeployment(HEAD), { status: "live", expectedHead: HEAD });
  assert.deepEqual(await control.getDeployment(OLD_HEAD), {
    status: "not_live",
    expectedHead: OLD_HEAD,
  });
  assert.equal(requests.length, 2);
  for (const [url, init] of requests) {
    assert.match(String(url), /\/api\/deployment$/);
    assert.notEqual((init?.method ?? "GET").toUpperCase(), "POST");
  }
  await assert.rejects(control.getDeployment("not-a-commit"), /invalid/i);
});

test("a deployment that is not yet serving reports not live instead of failing", async () => {
  const control = new WorkflowControl(
    configuration,
    workspace,
    dependencies(async () => new Response("", { status: 503 })),
  );
  assert.equal((await control.getDeployment(HEAD)).status, "not_live");
});

const PACKAGE_JSON = JSON.stringify({ gtm: { vercel: { team: "stravik", project: "gtm-acme-workflows" } } });

function diagramSandbox() {
  return sandboxWith((command) => {
    if (command.includes("readFileSync(path).toString")) return ok(`${Buffer.from(PACKAGE_JSON).toString("base64")}\n`);
    return ok();
  });
}

function pngResponse(status = 200, type = "image/png") {
  return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), { status, headers: { "content-type": type } });
}

test("getDiagram mints a signed link, probes the image without credentials, and derives links", async () => {
  const calls = [];
  const fixedNow = 1800000000 * 1000 - 24 * 60 * 60 * 1000;
  const controlAtFixedNow = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    {
      ...dependencies(async (url, init) => {
        calls.push({ url: String(url), headers: init?.headers });
        return pngResponse();
      }),
      now: () => fixedNow,
    },
  );
  const result = await controlAtFixedNow.getDiagram({
    workflowPath: "account-scoring",
    runKey: null,
    databaseUrl: "libsql://gtm-acme-stravik.turso.io",
    sandbox: diagramSandbox().sandbox,
  });
  assert.equal(result.status, "ready");
  assert.equal(result.url, "https://acme-workflows.vercel.app/gtm/diagram/account-scoring?exp=1800000000&sig=blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(result.imageUrl, "https://acme-workflows.vercel.app/api/diagram-image/account-scoring?exp=1800000000&sig=blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(result.expiresAt, "2027-01-15T08:00:00.000Z");
  assert.deepEqual(result.links, {
    diagram: result.url,
    runs: "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows",
    data: "https://app.turso.tech/stravik/databases/gtm-acme",
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, result.imageUrl);
  // No headers object at all, so neither the run secret nor the OIDC token can
  // ride along on a link a Slack viewer's browser will open.
  assert.equal(calls[0].headers, undefined);
});

test("getDiagram reports a protected deployment instead of a dead link", async () => {
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async () => new Response("<html>Vercel Authentication</html>", { status: 401, headers: { "content-type": "text/html" } })),
  );
  const result = await control.getDiagram({ workflowPath: "account-scoring", runKey: null, databaseUrl: null, sandbox: diagramSandbox().sandbox });
  assert.equal(result.status, "protected");
  assert.match(result.message, /deployment protection/i);
  assert.equal(result.links.data, "https://app.turso.tech");
});

test("getDiagram uses the run's stored URL for the runs link and refuses a bad run key", async () => {
  const runKey = "0123456789abcdef0123456789abcdef";
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async (url) => {
      if (String(url).endsWith(`/api/runs/${runKey}`)) {
        return Response.json({ run_key: runKey, workflow: "account-scoring", status: "running", run_url: "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows/wrun_1" });
      }
      return pngResponse();
    }),
  );
  const result = await control.getDiagram({ workflowPath: "account-scoring", runKey, databaseUrl: null, sandbox: diagramSandbox().sandbox });
  assert.equal(result.status, "ready");
  assert.equal(new URL(result.url).searchParams.get("run"), runKey);
  assert.equal(result.links.runs, "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows/wrun_1");
  await assert.rejects(
    control.getDiagram({ workflowPath: "account-scoring", runKey: "nope", databaseUrl: null, sandbox: diagramSandbox().sandbox }),
    /run key is invalid/,
  );
});

test("getDiagram refuses a run URL that is not a plain vercel.com link", async () => {
  const runKey = "0123456789abcdef0123456789abcdef";
  const control = (runUrl) =>
    new WorkflowControl(
      { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
      workspace,
      dependencies(async (url) => {
        if (String(url).endsWith(`/api/runs/${runKey}`)) {
          return Response.json({ run_key: runKey, workflow: "account-scoring", status: "running", run_url: runUrl });
        }
        return pngResponse();
      }),
    );
  const derived = "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows";
  const hostile = [
    "https://evil.example.com/x|Click here to sign in>",
    "https://vercel.com.evil.example.com/x",
    "http://vercel.com/x",
    "javascript:alert(1)",
  ];
  for (const runUrl of hostile) {
    const result = await control(runUrl).getDiagram({ workflowPath: "account-scoring", runKey, databaseUrl: null, sandbox: diagramSandbox().sandbox });
    assert.equal(result.links.runs, derived, `refused ${runUrl}`);
  }
});

test("getDiagram reports an HTML 404 as an unknown workflow, not as protection", async () => {
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async () => new Response("<html>404: NOT_FOUND</html>", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } })),
  );
  await assert.rejects(
    control.getDiagram({ workflowPath: "account-scoring", runKey: null, databaseUrl: null, sandbox: diagramSandbox().sandbox }),
    /does not know this workflow or run/,
  );
});

test("getDiagram names the workspace file when its package manifest is not JSON", async () => {
  const control = new WorkflowControl(
    { productionUrl: "https://acme-workflows.vercel.app", runSecret: "run-secret" },
    workspace,
    dependencies(async () => pngResponse()),
  );
  const { sandbox } = sandboxWith((command) => {
    if (command.includes("readFileSync(path).toString")) {
      return ok(`${Buffer.from("{ not json").toString("base64")}\n`);
    }
    return ok();
  });
  await assert.rejects(
    control.getDiagram({ workflowPath: "account-scoring", runKey: null, databaseUrl: null, sandbox }),
    /The workspace's workflows\/package\.json is not valid JSON\./,
  );
});
