import { connectSlackCredentials } from "@vercel/connect/eve";
import { slackChannel } from "eve/channels/slack";

import { getConfiguration } from "../lib/config.ts";

const configuration = getConfiguration();

export default slackChannel({
  credentials: connectSlackCredentials(configuration.slackConnector),
});
