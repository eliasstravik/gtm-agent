import { getToken } from "@vercel/connect";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { getConfiguration } from "./lib/config.ts";
import {
  createGitBasicAuthorization,
  hydrateWorkspaceCheckout,
} from "./lib/workspace-checkout.ts";

export default defineSandbox({
  backend: vercel({
    networkPolicy: "deny-all",
    resources: { vcpus: 1 },
  }),
  description:
    "A credential-free GTM workspace with deny-all sandbox network access.",
  async onSession({ use }) {
    const configuration = getConfiguration();
    if (configuration.workspace === null) {
      await use({ networkPolicy: "deny-all" });
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
      workspace: configuration.workspace,
      use,
    });
  },
});
