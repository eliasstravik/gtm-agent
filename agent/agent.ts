import { defineAgent } from "eve";

import { getConfiguration, resolveAgentModel, resolveAgentReasoning } from "./lib/config.ts";

// Production builds and boots fail on incomplete configuration; CI, previews, and local builds compile without secrets.
if (process.env.VERCEL_ENV === "production") getConfiguration();

export default defineAgent({
  model: resolveAgentModel(),
  reasoning: resolveAgentReasoning(),
});
