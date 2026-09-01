import { defineAgent } from "eve";

import { resolveAgentModel } from "./lib/config.ts";

export default defineAgent({
  model: resolveAgentModel(),
});
