import { getToken } from "@vercel/connect";
import { defineSandbox } from "eve/sandbox";
import { vercel } from "eve/sandbox/vercel";

import { getConfiguration } from "../../lib/config.ts";
import { hydrateSourceCheckout } from "../../lib/source-checkout.ts";
import { createGitBasicAuthorization } from "../../lib/workspace-checkout.ts";

export default defineSandbox({
  backend: () =>
    vercel({
      networkPolicy: "deny-all",
      resources: { vcpus: 1 },
    }),
  description:
    "An isolated, credential-free checkout of the exact deployed Eve source revision.",
  async onSession({ use }) {
    const source = getConfiguration().source;
    if (source === null) {
      throw new Error("Eve source proposal configuration is unavailable.");
    }
    const token = await getToken(source.connector, {
      subject: { type: "app" },
      scopes: ["contents:read", "metadata:read"],
      authorizationDetails: [
        {
          type: "github_app_installation",
          repositories: [source.repository],
        },
      ],
    });
    await hydrateSourceCheckout({
      authorization: createGitBasicAuthorization(token),
      source,
      use,
    });
  },
});
