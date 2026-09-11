const REPOSITORY = /^(?<owner>[A-Za-z0-9][A-Za-z0-9._-]*)\/(?<repo>[A-Za-z0-9][A-Za-z0-9._-]*)$/;
const REASONING = ["provider-default", "none", "minimal", "low", "medium", "high", "xhigh"] as const;

export type Configuration = ReturnType<typeof parseConfiguration>;

function need(env: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function list(value: string): string[] {
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (!values.length) throw new Error("Slack allowlists need at least one exact ID.");
  return [...new Set(values)];
}

function httpsOrigin(value: string, name: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error(`${name} must be an HTTPS origin without a path, query, or credentials.`);
  }
  return url;
}

export function parseConfiguration(env: Readonly<Record<string, string | undefined>>) {
  const repository = need(env, "GTM_WORKSPACE_REPOSITORY");
  const match = REPOSITORY.exec(repository)?.groups;
  if (!match || repository.endsWith(".git")) throw new Error("GTM_WORKSPACE_REPOSITORY must be owner/repo.");
  const ownRepository = [env.VERCEL_GIT_REPO_OWNER_SLUG, env.VERCEL_GIT_REPO_SLUG].filter(Boolean).join("/");
  if (ownRepository && ownRepository.toLowerCase() === repository.toLowerCase()) {
    throw new Error("GTM_WORKSPACE_REPOSITORY must not be the agent source repository.");
  }
  const databaseUrl = new URL(need(env, "TURSO_DATABASE_URL"));
  if (!["libsql:", "https:"].includes(databaseUrl.protocol) || !databaseUrl.hostname) {
    throw new Error("TURSO_DATABASE_URL must be a libsql or HTTPS database URL.");
  }
  const workflowUrl = httpsOrigin(need(env, "GTM_WORKFLOW_URL"), "GTM_WORKFLOW_URL");
  const reasoning = env.GTM_AGENT_REASONING?.trim() || "medium";
  if (!(REASONING as readonly string[]).includes(reasoning)) throw new Error(`GTM_AGENT_REASONING must be one of ${REASONING.join(", ")}.`);
  return {
    slack: {
      connector: need(env, "SLACK_CONNECTOR"),
      allowedChannelIds: list(need(env, "GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS")),
      allowedUserIds: list(need(env, "GTM_AGENT_ALLOWED_SLACK_USER_IDS")),
    },
    workspace: {
      connector: need(env, "GITHUB_CONNECTOR"), repository,
      owner: match.owner!, repo: match.repo!, checkoutDirectory: "/workspace",
      authorName: need(env, "GTM_WORKSPACE_COMMIT_AUTHOR_NAME"),
      authorEmail: need(env, "GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL"),
    },
    turso: {
      url: databaseUrl.toString(), host: databaseUrl.hostname,
      readOnlyToken: need(env, "TURSO_READ_ONLY_AUTH_TOKEN"),
    },
    workflow: {
      url: workflowUrl.origin, host: workflowUrl.hostname,
      runSecret: need(env, "GTM_RUN_SECRET"),
    },
    model: env.GTM_AGENT_MODEL?.trim() || "deepseek/deepseek-v4.1-flash",
    reasoning: reasoning as (typeof REASONING)[number],
  };
}

let cached: Configuration | undefined;
export function getConfiguration(): Configuration {
  return cached ??= parseConfiguration(process.env);
}

export function resolveAgentModel(): string { return getConfiguration().model; }
export function resolveAgentReasoning() { return getConfiguration().reasoning; }
