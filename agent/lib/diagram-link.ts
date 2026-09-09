import { createHmac } from "node:crypto";

export type DiagramClaims = { readonly path: string; readonly run: string | null; readonly exp: number };
export type WhereToLook = { readonly diagram: string; readonly runs: string; readonly data: string };

export function signDiagram(claims: DiagramClaims, secret: string): string {
  return createHmac("sha256", secret)
    .update(`diagram|${claims.path}|${claims.run ?? "-"}|${claims.exp}`)
    .digest("base64url");
}

function diagramQuery(claims: DiagramClaims, secret: string): string {
  const query = new URLSearchParams();
  if (claims.run) query.set("run", claims.run);
  query.set("exp", String(claims.exp));
  query.set("sig", signDiagram(claims, secret));
  return query.toString();
}

/** Matches the run routes: each segment is escaped, the separators are kept. */
function encodeWorkflowPath(path: string): string {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function diagramLinks(input: {
  readonly productionUrl: string;
  readonly claims: DiagramClaims;
  readonly secret: string;
}): { url: string; imageUrl: string } {
  const query = diagramQuery(input.claims, input.secret);
  const path = encodeWorkflowPath(input.claims.path);
  return {
    url: `${input.productionUrl}/gtm/diagram/${path}?${query}`,
    imageUrl: `${input.productionUrl}/api/diagram-image/${path}?${query}`,
  };
}

export function vercelObservabilityUrl(team: string, project: string): string {
  return `https://vercel.com/${encodeURIComponent(team)}/${encodeURIComponent(project)}/observability/workflows`;
}

/** Turso hosts look like `<db>-<org>.turso.io` or `<db>-<org>.<region>.turso.io`; the org has no hyphen. */
export function tursoDashboardUrl(databaseUrl: string | null): string {
  if (databaseUrl === null) return "https://app.turso.tech";
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return "https://app.turso.tech";
  }
  const match = host.match(/^([a-z0-9-]+)-([a-z0-9]+)(?:\.[a-z0-9-]+)*\.turso\.io$/);
  if (!match) return "https://app.turso.tech";
  return `https://app.turso.tech/${match[2]}/databases/${match[1]}`;
}

export function whereToLookText(links: WhereToLook): string {
  return [
    `Diagram: <${links.diagram}|Open the diagram>`,
    `Runs (needs Vercel access): <${links.runs}|Open the runs>`,
    `Data: <${links.data}|Open the data>`,
  ].join("\n");
}
