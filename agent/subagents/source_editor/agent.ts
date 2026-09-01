import { defineAgent, defineDynamic } from "eve";

import { isAllowedSourceCaller } from "../../lib/source-authorization.ts";
import { getConfiguration, resolveAgentModel } from "../../lib/config.ts";

export default defineDynamic({
  events: {
    "session.started": (_event, ctx) => {
      const source = getConfiguration().source;
      if (source === null || !isAllowedSourceCaller(source, ctx.session.auth.current)) {
        return null;
      }
      return defineAgent({
        description:
          "Prepare narrowly scoped changes to this Eve agent's durable instructions or native schedules. Delegate explicit requests for persistent changes to future agent behavior or schedule timing/content. The editor works in an isolated source checkout, returns an exact diff for review, and can publish only the accepted proposal as a draft pull request. It cannot edit GTM skills, workspace content, tools, channels, sandbox policy, dependencies, publisher authority, main, or deployments.",
        model: resolveAgentModel(),
      });
    },
  },
});
