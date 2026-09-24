export type Operation =
  | { tool: "bash"; command: string }
  | { tool: "write_file"; filePath: string; content: string };

export type Confirmation = {
  confirmationId: string;
  action: string;
  target: string;
  consequence: string;
  operation: Operation;
  confirmed: boolean;
};

export type ConfirmationState = { pendingCallId: string | null; grants: Record<string, Confirmation>; consumed: string[] };

export function sameOperation(a: Operation, b: Operation): boolean {
  return a.tool === "bash" && b.tool === "bash" ? a.command === b.command
    : a.tool === "write_file" && b.tool === "write_file" && a.filePath === b.filePath && a.content === b.content;
}

export function recordConfirmation(state: ConfirmationState, result: Confirmation): ConfirmationState {
  if (state.pendingCallId !== result.confirmationId || state.consumed.includes(result.confirmationId)) return state;
  // One current action: a later confirmation replaces any unused earlier grant.
  return { ...state, pendingCallId: null, grants: result.confirmed ? { [result.confirmationId]: result } : {} };
}

export function consumeConfirmation(state: ConfirmationState, id: string | null, operation: Operation): ConfirmationState {
  const grant = id ? state.grants[id] : undefined;
  if (!grant?.confirmed || !sameOperation(grant.operation, operation) || state.consumed.includes(id!)) {
    throw new Error("Confirmation required for this exact action. Call confirm_action and wait for Yes before execution.");
  }
  return { pendingCallId: null, grants: {}, consumed: [...state.consumed, id!] };
}

// Classify the operation's actual effects in the calling tool input. A shell allowlist
// cannot distinguish a harmless script/read from data loss and blocked routine work.
export function confirmationQuestion(input: Omit<Confirmation, "confirmationId" | "confirmed">, id: string) {
  return {
    prompt: `${input.action} ${input.target}? ${input.consequence}`,
    options: [{ id: `${id}:yes`, label: "Yes" }, { id: `${id}:no`, label: "No" }],
    display: "confirmation" as const,
    allowFreeform: false,
    // A message about something else resolves the question as dismissed, which confirms nothing.
    dismissible: true,
  };
}
