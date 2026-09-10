/** Works with ordinary waits or Workflow SDK durable sleep. */
export async function pollUntil<T>(options: {
  read: () => Promise<T>;
  ready: (value: T) => boolean;
  now: () => number | Promise<number>;
  pause: () => Promise<void>;
  timeoutMs: number;
}): Promise<T | null> {
  const deadline = await options.now() + options.timeoutMs;
  while (await options.now() < deadline) {
    const value = await options.read();
    if (options.ready(value)) return value;
    await options.pause();
  }
  return null;
}
