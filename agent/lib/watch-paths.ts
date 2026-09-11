/**
 * The watcher may only read three things on the workflow host: the deployment
 * head, one run by id, and the newest run of a workflow started from one commit.
 */
export function allowedWatchPath(path: string): boolean {
  if (path === "/api/deployment") return true;
  if (/^\/api\/runs\/[A-Za-z0-9_-]+$/.test(path) && path !== "/api/runs/latest") return true;
  const latest = /^\/api\/runs\/latest\?workflow=([A-Za-z0-9_-]+)&head=([0-9a-f]{7,64})$/.exec(path);
  return latest !== null;
}
