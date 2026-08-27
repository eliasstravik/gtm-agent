import { AI_GATEWAY_HOST, NPM_REGISTRY_HOST } from "./workflow-session.ts";

export const WORKSPACE_BRANCH = "main" as const;

export const CONFIGURATION_ERROR =
  "GitHub workspace configuration is incomplete: set both GITHUB_CONNECTOR and GTM_WORKSPACE_REPOSITORY, or unset both for Slack-only mode.";
export const SLACK_CONFIGURATION_ERROR =
  "SLACK_CONNECTOR must be set to the deployment's Vercel Connect Slack connector.";
export const WORKFLOW_CONFIGURATION_ERROR =
  "GTM workflow configuration is incomplete: set TURSO_DATABASE_URL, TURSO_AUTH_TOKEN, and TURSO_READ_ONLY_AUTH_TOKEN together, or unset all three to run without workflow hosting.";
export const WORKFLOW_TOKEN_ERROR =
  "TURSO_READ_ONLY_AUTH_TOKEN must differ from TURSO_AUTH_TOKEN: the sandbox baseline brokers only the read-only token.";
export const WORKFLOW_WORKSPACE_ERROR =
  "GTM workflow hosting requires the connected workspace: configure GITHUB_CONNECTOR and GTM_WORKSPACE_REPOSITORY before TURSO_DATABASE_URL.";
export const WORKFLOW_CONTROL_CONFIGURATION_ERROR =
  "GTM workflow control configuration is incomplete: set GTM_WORKFLOW_VERCEL_URL and GTM_WORKFLOW_RUN_SECRET together, or unset both.";
export const WORKFLOW_CONTROL_HOST_ERROR =
  "GTM workflow control requires the connected workspace and hosted Turso workflow runtime.";
export const WORKSPACE_COMMIT_AUTHOR_CONFIGURATION_ERROR =
  "Workspace commit author configuration is incomplete: set GTM_WORKSPACE_COMMIT_AUTHOR_NAME and GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL together, or unset both.";
export const WORKFLOW_CONTROL_AUTHOR_ERROR =
  "GTM workflow control requires a commit author mapped to the Vercel project owner.";
export const SOURCE_CONFIGURATION_ERROR =
  "Eve source proposal configuration is incomplete: set EVE_SOURCE_GITHUB_CONNECTOR, EVE_SOURCE_REPOSITORY, and EVE_SOURCE_ALLOWED_SLACK_USER_IDS together, or unset all three.";
export const SOURCE_DEPLOYMENT_ERROR =
  "Eve source proposals require the exact deployed Git commit from VERCEL_GIT_COMMIT_SHA (or EVE_SOURCE_DEPLOYED_SHA for local testing).";
export const SOURCE_REPOSITORY_ERROR =
  "EVE_SOURCE_REPOSITORY must match the Git repository that produced this deployment.";

const REPOSITORY_PATTERN =
  /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?)\/(?<repo>[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?)$/;
const HOSTNAME_PATTERN =
  /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DATABASE_URL_PATTERN = /^(?:libsql|https):\/\/(?<host>[^/?#:@]+)$/;
const SOURCE_CHECKOUT_ROOT = "/workspace/.eve-source";
/** Hosts a provider allowlist can never open: they carry other trust decisions. */
const RESERVED_PROVIDER_HOSTS: ReadonlySet<string> = new Set([
  "github.com",
  "api.github.com",
  "vercel.com",
  "api.vercel.com",
  NPM_REGISTRY_HOST,
  AI_GATEWAY_HOST,
]);

export type WorkspaceRepository = {
  readonly owner: string;
  readonly repo: string;
  readonly repository: string;
};

export type ConnectedWorkspaceConfiguration = WorkspaceRepository & {
  readonly branch: typeof WORKSPACE_BRANCH;
  readonly checkoutDirectory: string;
  readonly commitAuthor: {
    readonly email: string;
    readonly name: string;
  } | null;
  readonly connector: string;
  readonly staleMarker: string;
};

/**
 * Host-side settings for authoring the vendored `gtm-workflow` project inside
 * the sandbox. The database URL is delivered to the session as
 * `TURSO_DATABASE_URL` (it is not a credential). The read-only token is
 * brokered at the sandbox firewall for every session; the write token is
 * brokered only while an approved save applies migrations. No Gateway key
 * reaches the sandbox: the sandbox never starts a real run.
 */
export type WorkflowHostConfiguration = {
  readonly databaseHost: string;
  readonly databaseUrl: string;
  readonly databaseAuthToken: string;
  readonly databaseReadOnlyAuthToken: string;
  readonly providerHosts: readonly string[];
};

export type WorkflowControlConfiguration = {
  readonly productionUrl: string;
  readonly runSecret: string;
};

export type SourceProposalConfiguration = WorkspaceRepository & {
  readonly allowedSlackUserIds: readonly string[];
  readonly branch: typeof WORKSPACE_BRANCH;
  readonly checkoutDirectory: string;
  readonly connector: string;
  readonly deployedSha: string;
};

export type GtmAgentConfiguration = {
  readonly slackConnector: string;
  readonly source: SourceProposalConfiguration | null;
  readonly workflow: WorkflowHostConfiguration | null;
  readonly workflowControl: WorkflowControlConfiguration | null;
  readonly workspace: ConnectedWorkspaceConfiguration | null;
};

export function parseWorkspaceRepository(value: string): WorkspaceRepository {
  const match = REPOSITORY_PATTERN.exec(value);
  if (!match?.groups || value.endsWith(".git")) {
    throw new Error(
      "GTM_WORKSPACE_REPOSITORY must be exactly one owner/repo value (not a URL, .git path, or ref).",
    );
  }

  const { owner, repo } = match.groups;
  return { owner, repo, repository: `${owner}/${repo}` };
}

export function parseConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): GtmAgentConfiguration {
  const slackConnector =
    present(environment.SLACK_CONNECTOR) ??
    (environment.NODE_ENV === "production" ? undefined : "slack/my-agent");
  const connector = present(environment.GITHUB_CONNECTOR);
  const repositoryValue = present(environment.GTM_WORKSPACE_REPOSITORY);

  if (slackConnector === undefined) {
    throw new Error(SLACK_CONFIGURATION_ERROR);
  }

  const source = parseSourceProposalConfiguration(environment);

  if ((connector === undefined) !== (repositoryValue === undefined)) {
    throw new Error(CONFIGURATION_ERROR);
  }

  if (connector === undefined || repositoryValue === undefined) {
    const workflow = parseWorkflowConfiguration(environment, false);
    return {
      slackConnector,
      source,
      workflow,
      workflowControl: parseWorkflowControlConfiguration(environment, false, workflow),
      workspace: null,
    };
  }

  const repository = parseWorkspaceRepository(repositoryValue);
  const workflow = parseWorkflowConfiguration(environment, true);
  const commitAuthor = parseWorkspaceCommitAuthor(environment);
  const workflowControl = parseWorkflowControlConfiguration(environment, true, workflow);
  if (workflowControl !== null && commitAuthor === null) {
    throw new Error(WORKFLOW_CONTROL_AUTHOR_ERROR);
  }
  return {
    slackConnector,
    source,
    workflow,
    workflowControl,
    workspace: {
      ...repository,
      branch: WORKSPACE_BRANCH,
      checkoutDirectory: `$HOME/.gtm/${repository.repo}`,
      commitAuthor,
      connector,
      staleMarker: `$HOME/.gtm/.${repository.repo}.stale`,
    },
  };
}

function parseSourceProposalConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
): SourceProposalConfiguration | null {
  const connector = present(environment.EVE_SOURCE_GITHUB_CONNECTOR);
  const repositoryValue = present(environment.EVE_SOURCE_REPOSITORY);
  const allowedUsersValue = present(environment.EVE_SOURCE_ALLOWED_SLACK_USER_IDS);
  const configured = [connector, repositoryValue, allowedUsersValue].filter(
    (value) => value !== undefined,
  ).length;

  if (configured === 0) return null;
  if (
    configured !== 3 ||
    connector === undefined ||
    repositoryValue === undefined ||
    allowedUsersValue === undefined
  ) {
    throw new Error(SOURCE_CONFIGURATION_ERROR);
  }

  const deployedSha =
    present(environment.EVE_SOURCE_DEPLOYED_SHA) ??
    present(environment.VERCEL_GIT_COMMIT_SHA);
  if (deployedSha === undefined || !/^[0-9a-f]{40}$/i.test(deployedSha)) {
    throw new Error(SOURCE_DEPLOYMENT_ERROR);
  }

  const repository = parseWorkspaceRepository(repositoryValue);
  const deployedOwner = present(environment.VERCEL_GIT_REPO_OWNER_SLUG);
  const deployedRepo = present(environment.VERCEL_GIT_REPO_SLUG);
  if (
    deployedOwner !== undefined &&
    deployedRepo !== undefined &&
    `${deployedOwner}/${deployedRepo}`.toLowerCase() !==
      repository.repository.toLowerCase()
  ) {
    throw new Error(SOURCE_REPOSITORY_ERROR);
  }

  const allowedSlackUserIds = [
    ...new Set(allowedUsersValue.split(",").map((value) => value.trim())),
  ];
  if (
    allowedSlackUserIds.length === 0 ||
    allowedSlackUserIds.some((value) => !/^U[A-Z0-9]{8,}$/.test(value))
  ) {
    throw new Error(
      "EVE_SOURCE_ALLOWED_SLACK_USER_IDS must be a comma-separated list of exact Slack user IDs.",
    );
  }

  return {
    ...repository,
    allowedSlackUserIds,
    branch: WORKSPACE_BRANCH,
    checkoutDirectory: `${SOURCE_CHECKOUT_ROOT}/${repository.repo}`,
    connector,
    deployedSha: deployedSha.toLowerCase(),
  };
}

function parseWorkspaceCommitAuthor(
  environment: Readonly<Record<string, string | undefined>>,
): ConnectedWorkspaceConfiguration["commitAuthor"] {
  const name = present(environment.GTM_WORKSPACE_COMMIT_AUTHOR_NAME);
  const email = present(environment.GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL);
  if ((name === undefined) !== (email === undefined)) {
    throw new Error(WORKSPACE_COMMIT_AUTHOR_CONFIGURATION_ERROR);
  }
  if (name === undefined || email === undefined) return null;
  if (
    name.length > 100 ||
    email.length > 254 ||
    !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)
  ) {
    throw new Error(
      "GTM workspace commit author must be one bounded name and valid email address.",
    );
  }
  return { email, name };
}

function parseWorkflowControlConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  hasWorkspace: boolean,
  workflow: WorkflowHostConfiguration | null,
): WorkflowControlConfiguration | null {
  const values = {
    productionUrl: present(environment.GTM_WORKFLOW_VERCEL_URL),
    runSecret: present(environment.GTM_WORKFLOW_RUN_SECRET),
  };
  const configured = Object.values(values).filter((value) => value !== undefined).length;
  if (configured === 0) return null;
  if (configured !== Object.keys(values).length) {
    throw new Error(WORKFLOW_CONTROL_CONFIGURATION_ERROR);
  }
  if (!hasWorkspace || workflow === null) {
    throw new Error(WORKFLOW_CONTROL_HOST_ERROR);
  }
  let productionUrl: URL;
  try {
    productionUrl = new URL(values.productionUrl!);
  } catch {
    throw new Error("GTM_WORKFLOW_VERCEL_URL must be one exact HTTPS production origin.");
  }
  if (
    productionUrl.protocol !== "https:" ||
    productionUrl.username !== "" ||
    productionUrl.password !== "" ||
    productionUrl.port !== "" ||
    productionUrl.pathname !== "/" ||
    productionUrl.search !== "" ||
    productionUrl.hash !== ""
  ) {
    throw new Error("GTM_WORKFLOW_VERCEL_URL must be one exact HTTPS production origin.");
  }

  return {
    productionUrl: productionUrl.origin,
    runSecret: values.runSecret!,
  };
}

function parseWorkflowConfiguration(
  environment: Readonly<Record<string, string | undefined>>,
  hasWorkspace: boolean,
): WorkflowHostConfiguration | null {
  const databaseValue = present(environment.TURSO_DATABASE_URL);
  const databaseAuthToken = present(environment.TURSO_AUTH_TOKEN);
  const databaseReadOnlyAuthToken = present(environment.TURSO_READ_ONLY_AUTH_TOKEN);
  const values = [databaseValue, databaseAuthToken, databaseReadOnlyAuthToken];
  const configured = values.filter((value) => value !== undefined).length;

  if (configured === 0) return null;
  if (
    configured !== values.length ||
    databaseValue === undefined ||
    databaseAuthToken === undefined ||
    databaseReadOnlyAuthToken === undefined
  ) {
    throw new Error(WORKFLOW_CONFIGURATION_ERROR);
  }
  if (databaseReadOnlyAuthToken === databaseAuthToken) {
    throw new Error(WORKFLOW_TOKEN_ERROR);
  }
  if (!hasWorkspace) {
    throw new Error(WORKFLOW_WORKSPACE_ERROR);
  }

  const databaseHost = parseDatabaseHost(databaseValue);
  return {
    databaseHost,
    databaseUrl: `https://${databaseHost}`,
    databaseAuthToken,
    databaseReadOnlyAuthToken,
    providerHosts: parseProviderHosts(
      environment.GTM_WORKFLOW_PROVIDER_HOSTS,
      databaseHost,
    ),
  };
}

function parseDatabaseHost(value: string): string {
  const host = DATABASE_URL_PATTERN.exec(value)?.groups?.host;
  if (host === undefined || !HOSTNAME_PATTERN.test(host)) {
    throw new Error(
      "TURSO_DATABASE_URL must be exactly one libsql:// or https:// Turso host with no path, port, query, or credentials.",
    );
  }
  return host;
}

function parseProviderHosts(
  value: string | undefined,
  databaseHost: string,
): readonly string[] {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed.length === 0) return [];

  const hosts = trimmed.split(",").map((entry) => entry.trim());
  for (const host of hosts) {
    if (
      !HOSTNAME_PATTERN.test(host) ||
      RESERVED_PROVIDER_HOSTS.has(host) ||
      host === databaseHost
    ) {
      throw new Error(
        `GTM_WORKFLOW_PROVIDER_HOSTS must list exact lowercase provider hostnames outside the trusted host set; rejected ${JSON.stringify(host)}.`,
      );
    }
  }
  return [...new Set(hosts)];
}

export function getConfiguration(): GtmAgentConfiguration {
  return parseConfiguration(process.env);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
