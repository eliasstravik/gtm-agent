import { defineAgent } from "eve";

export default defineAgent({
  // A deployment picks its model in the project settings; the template default applies when the variable is unset.
  model: process.env.GTM_AGENT_MODEL || "openai/gpt-6-luna-fast",
  reasoning: (process.env.GTM_AGENT_REASONING || "high") as "none" | "minimal" | "low" | "medium" | "high" | "xhigh",
});
