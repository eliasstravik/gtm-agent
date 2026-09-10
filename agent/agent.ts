import { defineAgent } from "eve";

import { resolveAgentModel, resolveAgentReasoning } from "./lib/config.ts";

export default defineAgent({
  model: resolveAgentModel(),
  reasoning: resolveAgentReasoning(),
  build: { externalDependencies: ["@resvg/resvg-js"] },
});
