import { defineInstructions } from "eve/instructions";
import { describeHost } from "./lib/host";

// Standing rules for the hosted agent, plus the firewall in plain words, generated from the same list the sandbox enforces.
export default defineInstructions({
  content: [
    "The organization's GTM workspace is already checked out under `$HOME/.gtm/`.",
    "This computer lasts one conversation; only what is pushed to the workspace repository survives it.",
    "Workflows run only on their deployed copy; there are no local runs here.",
    "A dev server or build may be started as a check, but nothing it serves is ever shared: the where-to-look links in a reply come only from the deployed copy's link route, read after the push until its commit includes yours, and never contain `localhost`.",
    describeHost(),
  ].join("\n"),
});
