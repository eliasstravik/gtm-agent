/** Each poll is a short host step. Credentials never enter durable inputs/results. */
export async function checkDeployment(expectedHead: string, workflowPath: string) {
  "use step";
  const { WorkflowControl } = await import("./workflow-control.ts");
  const { getConfiguration } = await import("./config.ts");
  const configuration = getConfiguration();
  if (!configuration.workspace || !configuration.workflowControl) throw new Error("Workflow follow-ups are not configured.");
  const client = new WorkflowControl(configuration.workflowControl, configuration.workspace);
  const deployment = await client.getDeployment(expectedHead);
  return deployment.status === "live"
    ? { ...deployment, preflight: await client.preflight(workflowPath, expectedHead) }
    : { ...deployment, preflight: null };
}

export async function checkRun(runKey: string) {
  "use step";
  const { WorkflowControl } = await import("./workflow-control.ts");
  const { getConfiguration } = await import("./config.ts");
  const configuration = getConfiguration();
  if (!configuration.workspace || !configuration.workflowControl) throw new Error("Workflow follow-ups are not configured.");
  return new WorkflowControl(configuration.workflowControl, configuration.workspace).getRun(runKey);
}

export async function watchClock() {
  "use step";
  return Date.now();
}
