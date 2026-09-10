import { defineInstrumentation } from "eve/instrumentation";

/**
 * Per-step timing in the runtime logs. Eve calls `step.started` once the
 * model input for a step is assembled, so the gap between consecutive steps
 * of one turn is that step's model latency plus its tool execution. Logging
 * it, with the input size, shows where a slow Slack turn spends its time
 * without any external tracing setup.
 */
const lastStepStartedAt = new Map<string, number>();

export default defineInstrumentation({
  events: {
    "step.started"(input) {
      const now = Date.now();
      const turnKey = `${input.session.id}:${input.turn.id}`;
      const previous = lastStepStartedAt.get(turnKey);
      lastStepStartedAt.set(turnKey, now);
      if (lastStepStartedAt.size > 256) {
        const oldest = lastStepStartedAt.keys().next().value;
        if (oldest !== undefined) lastStepStartedAt.delete(oldest);
      }
      const instructions = input.modelInput.instructions;
      const inputChars =
        JSON.stringify(input.modelInput.messages ?? []).length +
        (typeof instructions === "string"
          ? instructions.length
          : instructions === undefined
            ? 0
            : JSON.stringify(instructions).length);
      console.log(
        JSON.stringify({
          event: "gtm.step",
          session: input.session.id,
          turn: input.turn.id,
          step: input.step.index,
          channel: input.channel.kind,
          inputChars,
          msSincePreviousStep: previous === undefined ? null : now - previous,
        }),
      );
      return {
        runtimeContext: {
          "gtm.input_chars": inputChars,
          "gtm.step_index": input.step.index,
        },
      };
    },
  },
});
