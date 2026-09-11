import { getToken } from "@vercel/connect";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";
import { getConfiguration } from "./lib/config.ts";
import { gitAuthorization, sessionEnvironment } from "./lib/workflow-session.ts";
import { hydrateWorkspace } from "./lib/workspace-checkout.ts";

export default defineSandbox({
  backend: () => {
    const config = getConfiguration();
    return vercel({
      image: "vercel/sandbox/node:22",
      networkPolicy: "deny-all",
      resources: { vcpus: 1 },
      env: sessionEnvironment(config),
    });
  },
  description: "Node 22 GTM workspace with deny-by-default egress and firewall-brokered credentials.",
  async onSession({ use }) {
    const config = getConfiguration();
    const token = await getToken(config.workspace.connector, {
      subject: { type: "app" },
      scopes: ["contents:write", "metadata:read"],
      authorizationDetails: [{
        type: "github_app_installation",
        repositories: [config.workspace.repository],
      }],
    });
    await hydrateWorkspace(config, gitAuthorization(token), use);
  },
});
