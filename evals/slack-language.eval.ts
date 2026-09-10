import { defineEval } from "eve/evals";
import { satisfies } from "eve/evals/expect";

export default defineEval({
  description: "Ordinary replies stay short and do not introduce a yes/no approval question.",
  async test(t) {
    await t.send("A workflow checks 25 accounts at $0.004 each and then 10 matches at $0.02 each. What is the total estimated cost? Just answer; do not run anything.");
    t.succeeded();
    t.usedNoTools();
    t.check(t.reply, satisfies(reply => typeof reply === "string" && reply.length <= 280 &&
      /(?:\$0\.30|30 cents|\$0\.3\b)/.test(reply) && !/\?|\b(?:commit|SHA|checkout|ledger|repository)\b/i.test(reply),
      "answer the cost in at most 280 characters without an approval question or implementation jargon"));
  },
});
