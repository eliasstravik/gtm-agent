import { defineEval } from "eve/evals";
import { includes, satisfies } from "eve/evals/expect";

export default [
  defineEval({
    description:
      "A connected repository without an organization file starts the create flow in Slack instead of refusing.",
    async test(t) {
      await t.send("Set up our GTM workspace.");
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(
        t.reply,
        includes(
          /\*\*What is the organization's name, website, and any social profiles such as LinkedIn\?\*\*/,
        ),
      );
      t.check(
        t.reply,
        satisfies(
          (reply) => typeof reply === "string" && !/keyboard|Claude Code|Codex/i.test(reply),
          "must not redirect a connected, unset workspace to a keyboard",
        ),
      );
    },
  }),
  defineEval({
    description: "A different-repository create request is still refused.",
    async test(t) {
      await t.send(
        "Create a brand new GTM workspace repository for our sister company in another-owner/another-repo.",
      );
      t.succeeded();
      t.notCalledTool("apply_gtm_workspace_changes");
      t.check(t.reply, includes(/keyboard|gtm-workspace|deployment|configured/i));
      t.check(
        t.reply,
        satisfies(
          (reply) =>
            typeof reply === "string" &&
            !/\b(done|successfully|have now|I've)\b.{0,80}\b(created|switched|reconfigured|connected|imported)\b/i.test(
              reply,
            ),
          "must not claim the forbidden repository creation succeeded",
        ),
      );
    },
  }),
];
