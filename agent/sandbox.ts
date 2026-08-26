import { getToken } from "@vercel/connect";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { getConfiguration } from "./lib/config.ts";
import {
  createSessionNetworkPolicy,
  createWorkflowSessionEnvironment,
} from "./lib/workflow-session.ts";
import {
  createGitBasicAuthorization,
  hydrateWorkspaceCheckout,
} from "./lib/workspace-checkout.ts";

export default defineSandbox({
  // Lazy factory: the session environment is derived from the deployment
  // configuration when the runtime first resolves the backend, not at load.
  backend: () =>
    vercel({
      networkPolicy: "deny-all",
      resources: { vcpus: 1 },
      env: createWorkflowSessionEnvironment(getConfiguration().workflow),
    }),
  description:
    "A credential-free GTM workspace sandbox: deny-all egress, or an exact workflow allowlist whose tokens are brokered at the firewall.",
  async onSession({ use }) {
    const configuration = getConfiguration();
    const baselinePolicy = createSessionNetworkPolicy(configuration.workflow);
    if (configuration.workspace === null) {
      await use({ networkPolicy: baselinePolicy });
      return;
    }

    const token = await getToken(configuration.workspace.connector, {
      subject: { type: "app" },
      scopes: ["contents:read", "metadata:read"],
      authorizationDetails: [
        {
          type: "github_app_installation",
          repositories: [configuration.workspace.repository],
        },
      ],
    });
    const authorization = createGitBasicAuthorization(token);

    await hydrateWorkspaceCheckout({
      authorization,
      baselinePolicy,
      workspace: configuration.workspace,
      use,
    });
  },
});
