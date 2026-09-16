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

/** Shell syntax and arbitrary programs cannot reliably be classified by destructive keywords. */
export function isReadOnlyCommand(command: string): boolean {
  if (/[;&|<>\n\r`$()\\]/u.test(command)) return false;
  const words = command.trim().split(/\s+/u);
  if (["pwd", "ls", "cat", "head", "tail", "wc"].includes(words[0])) return true;
  return words[0] === "git" && words.length === 2 && ["status", "log", "diff"].includes(words[1]);
}

export function confirmationQuestion(input: Omit<Confirmation, "confirmationId" | "confirmed">, id: string) {
  return {
    prompt: `${input.action} ${input.target}? ${input.consequence}`,
    options: [{ id: `${id}:yes`, label: "Yes" }, { id: `${id}:no`, label: "No" }],
    display: "confirmation" as const,
    allowFreeform: false,
  };
}
