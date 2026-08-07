export const CONTEXT_BRANCH = "main" as const;

export const CONFIGURATION_ERROR =
  "GitHub context configuration is incomplete: set both GITHUB_CONNECTOR and GTM_CONTEXT_REPOSITORY, or unset both for Slack-only mode.";
export const SLACK_CONFIGURATION_ERROR =
  "SLACK_CONNECTOR must be set to the deployment's Vercel Connect Slack connector.";

const REPOSITORY_PATTERN =
  /^(?<owner>[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?)\/(?<repo>[A-Za-z0-9](?:[A-Za-z0-9._-]{0,98}[A-Za-z0-9])?)$/;

export type ContextRepository = {
  readonly owner: string;
  readonly repo: string;
  readonly repository: string;
};

export type ConnectedContextConfiguration = ContextRepository & {
  readonly branch: typeof CONTEXT_BRANCH;
  readonly checkoutDirectory: string;
  readonly connector: string;
  readonly staleMarker: string;
};

export type GtmAgentConfiguration = {
  readonly slackConnector: string;
  readonly context: ConnectedContextConfiguration | null;
};

export function parseContextRepository(value: string): ContextRepository {
  const match = REPOSITORY_PATTERN.exec(value);
  if (!match?.groups || value.endsWith(".git")) {
    throw new Error(
      "GTM_CONTEXT_REPOSITORY must be exactly one owner/repo value (not a URL, .git path, or ref).",
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
  const repositoryValue = present(environment.GTM_CONTEXT_REPOSITORY);

  if (slackConnector === undefined) {
    throw new Error(SLACK_CONFIGURATION_ERROR);
  }

  if ((connector === undefined) !== (repositoryValue === undefined)) {
    throw new Error(CONFIGURATION_ERROR);
  }

  if (connector === undefined || repositoryValue === undefined) {
    return { slackConnector, context: null };
  }

  const repository = parseContextRepository(repositoryValue);
  return {
    slackConnector,
    context: {
      ...repository,
      branch: CONTEXT_BRANCH,
      checkoutDirectory: `$HOME/.gtm/${repository.repo}`,
      connector,
      staleMarker: `$HOME/.gtm/.${repository.repo}.stale`,
    },
  };
}

export function getConfiguration(): GtmAgentConfiguration {
  return parseConfiguration(process.env);
}

function present(value: string | undefined): string | undefined {
  return value === undefined || value.length === 0 ? undefined : value;
}
