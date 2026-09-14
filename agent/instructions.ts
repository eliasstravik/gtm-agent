import { defineInstructions } from "eve/instructions";
import { describeHost } from "./lib/host";

// Standing rules for the hosted agent, plus the firewall in plain words, generated from the same list the sandbox enforces.
export default defineInstructions({
  content: [
    "The organization's GTM workspace is already checked out under `$HOME/.gtm/`.",
    "This computer lasts one conversation; only what is pushed to the workspace repository survives it.",
    "Workflows run only on their deployed copy; there are no local runs here.",
    "A dev server or build may be started as a check, but nothing it serves is ever shared: the where-to-look links in a reply come only from the deployed copy's link route, read after the push until its commit includes yours, and never contain `localhost`.",
    "Messages that start with `[workflow tell]`, `[workflow ask]`, `[workflow show]`, or `[workflow handoff]` come from a running workflow through this agent's notify route, not from a person. tell: post the news in one plain sentence. ask: it carries an approval token; ask the person in one message what the run wants to do and what it costs, and when they answer, decide it with `POST /api/runs/<run id>/approve` on the workflow project with `{ token, approved, reason }`, then say it continued or stopped. show: present the results in plain words with the data link. handoff: the person can steer the run from this thread; relay their replies as follow-up approvals or decisions, never as new runs.",
    describeHost(),
  ].join("\n"),
});
