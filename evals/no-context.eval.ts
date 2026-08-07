import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default [
  defineEval({
    description: "Slack-only mode explains the context prerequisite without writing elsewhere.",
    async test(t) {
      await t.send(
        "Score Acme against our saved ICP and persist the result. No GTM context repository is connected.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_context_changes");
      t.check(t.reply, includes(/context|repository|connect/i));
    },
  }),
  defineEval({
    description: "Slack-only research does not invent durable memory.",
    async test(t) {
      await t.send(
        "Research example.com from public sources, but do not claim you saved anything for later.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_context_changes");
      t.check(t.reply, includes(/research|source|context|save/i));
      t.check(
        t.reply,
        satisfies(
          (reply) =>
            typeof reply === "string" &&
            !/\b(I saved|I've saved|I stored|I've stored|persisted|remembered for later)\b/i.test(
              reply,
            ),
          "must not claim durable persistence without a context repository",
        ),
      );
    },
  }),
];
