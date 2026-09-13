import { defineAgent } from "eve";

export default defineAgent({
  // A deployment picks its model in the project settings; the template default applies when the variable is unset.
  model: process.env.GTM_AGENT_MODEL || "openai/gpt-5.6-luna-fast",
  ...(process.env.GTM_AGENT_REASONING && { reasoning: process.env.GTM_AGENT_REASONING as "none" | "minimal" | "low" | "medium" | "high" | "xhigh" }),
});
