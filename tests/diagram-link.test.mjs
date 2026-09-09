import assert from "node:assert/strict";
import test from "node:test";

import {
  diagramLinks,
  signDiagram,
  tursoDashboardUrl,
  vercelObservabilityUrl,
  whereToLookText,
} from "../agent/lib/diagram-link.ts";

test("signs diagram claims like the workflows project", () => {
  assert.equal(signDiagram({ path: "account-scoring", run: null, exp: 1800000000 }, "run-secret"), "blMhCFDtQH3hzIQsBNiSMpttas2dGVMJq5qtqtW8NAM");
  assert.equal(
    signDiagram({ path: "account-scoring", run: "0123456789abcdef0123456789abcdef", exp: 1800000000 }, "run-secret"),
    "zyr8hay07tYU4meH4oDXDf-8dKFK8mIeNq4EZUFlcBw",
  );
});

test("builds the page and image links with the same query", () => {
  const links = diagramLinks({
    productionUrl: "https://acme-workflows.vercel.app",
    claims: { path: "nested/account-scoring", run: null, exp: 1800000000 },
    secret: "run-secret",
  });
  assert.equal(links.url, `https://acme-workflows.vercel.app/gtm/diagram/nested/account-scoring?exp=1800000000&sig=${signDiagram({ path: "nested/account-scoring", run: null, exp: 1800000000 }, "run-secret")}`);
  assert.equal(new URL(links.imageUrl).pathname, "/api/diagram-image/nested/account-scoring");
  assert.equal(new URL(links.imageUrl).search, new URL(links.url).search);
  const withRun = diagramLinks({ productionUrl: "https://acme-workflows.vercel.app", claims: { path: "a", run: "0123456789abcdef0123456789abcdef", exp: 1 }, secret: "s" });
  assert.equal(new URL(withRun.url).searchParams.get("run"), "0123456789abcdef0123456789abcdef");
});

test("derives the runs and data links", () => {
  assert.equal(vercelObservabilityUrl("stravik", "gtm-acme-workflows"), "https://vercel.com/stravik/gtm-acme-workflows/observability/workflows");
  assert.equal(tursoDashboardUrl("libsql://gtm-acme-stravik.turso.io"), "https://app.turso.tech/stravik/databases/gtm-acme");
  assert.equal(tursoDashboardUrl("https://gtm-acme-stravik.aws-eu-west-1.turso.io"), "https://app.turso.tech/stravik/databases/gtm-acme");
  assert.equal(tursoDashboardUrl("libsql://weird.example.com"), "https://app.turso.tech");
  assert.equal(tursoDashboardUrl(null), "https://app.turso.tech");
});

test("formats the where-to-look block", () => {
  assert.equal(
    whereToLookText({ diagram: "https://d/1", runs: "https://r/2", data: "https://t/3" }),
    "Diagram: <https://d/1|Open the diagram>\nRuns: <https://r/2|Open the runs>\nData: <https://t/3|Open the data>",
  );
});
