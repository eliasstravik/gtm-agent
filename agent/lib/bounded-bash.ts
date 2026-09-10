import type { RuntimeSandboxSession } from "eve/sandbox";

// Model-authored commands cannot extend either deadline.
export const COMMAND_TIMEOUT_MS = 120_000;
const STOP_TIMEOUT_MS = 10_000;
const OUTPUT_LIMIT = 64_000;
const expired = Symbol("expired");

async function within<T>(operation: PromiseLike<T>, ms: number): Promise<T | typeof expired> {
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<typeof expired>((resolve) => {
    timer = setTimeout(() => resolve(expired), ms);
  });
  try {
    return await Promise.race([operation, deadline]);
  } finally {
    clearTimeout(timer!);
  }
}

export async function runBoundedBash(
  sandbox: Pick<RuntimeSandboxSession, "run" | "stop">,
  command: string,
  limits = { timeoutMs: COMMAND_TIMEOUT_MS, stopTimeoutMs: STOP_TIMEOUT_MS },
) {
  const controller = new AbortController();
  const result = await within(
    sandbox.run({ command, abortSignal: controller.signal }),
    limits.timeoutMs,
  );
  if (result === expired) {
    controller.abort();
    // Cancelling an HTTP wait alone does not kill a process. Stop the backing
    // compute, including descendants that created their own terminal/session.
    const stopped = await within(
      Promise.resolve().then(() => sandbox.stop()).then(() => true, () => false),
      limits.stopTimeoutMs,
    );
    return {
      exitCode: 124,
      stdout: "",
      stderr: stopped === true
        ? "Command timed out. Sandbox compute was stopped to terminate its processes. The conversation is preserved; recheck the checkout and any side effects before continuing. Report the timeout to the user. Resolve the cause before retrying; interactive prompts require a noninteractive helper or a user decision."
        : "Command timed out. Could not confirm that sandbox compute stopped. Do not retry or claim the operation failed without side effects. Tell the user the outcome is unknown and requires inspection.",
      truncated: false,
    };
  }
  return {
    exitCode: result.exitCode,
    stdout: result.stdout.slice(-OUTPUT_LIMIT),
    stderr: result.stderr.slice(-OUTPUT_LIMIT),
    truncated: result.stdout.length > OUTPUT_LIMIT || result.stderr.length > OUTPUT_LIMIT,
  };
}
