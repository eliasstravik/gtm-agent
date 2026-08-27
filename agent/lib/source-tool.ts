import type { SourceProposalConfiguration } from "./config.ts";
import { getConfiguration } from "./config.ts";

export function requireSourceConfiguration(): SourceProposalConfiguration {
  const source = getConfiguration().source;
  if (source === null) {
    throw new Error("Eve source proposal configuration is unavailable.");
  }
  return source;
}
