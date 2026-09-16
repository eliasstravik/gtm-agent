import { defineState } from "eve/context";
import type { ConfirmationState } from "./confirmation";

export const confirmations = defineState<ConfirmationState>("gtm.confirmations", () => ({ pendingCallId: null, grants: {}, consumed: [] }));
