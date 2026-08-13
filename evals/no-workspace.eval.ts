import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default [
  defineEval({
    description: "Slack-only mode explains the workspace prerequisite without writing elsewhere.",
    async test(t) {
      await t.send(
        "Create an ICP for Nordic B2B SaaS companies and save it. No GTM workspace repository is connected.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(t.reply, includes(/workspace|repository|connect/i));
    },
  }),
  defineEval({
    description: "Slack-only persona work does not invent durable memory.",
    async test(t) {
      await t.send(
        "Create a revenue leader persona from these facts, but do not claim you saved anything for later: they own pipeline quality.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(t.reply, includes(/workspace|repository|connect|save/i));
      t.check(
        t.reply,
        satisfies(
          (reply) =>
            typeof reply === "string" &&
            !/\b(I saved|I've saved|I stored|I've stored|persisted|remembered for later)\b/i.test(
              reply,
            ),
          "must not claim durable persistence without a workspace repository",
        ),
      );
    },
  }),
];
