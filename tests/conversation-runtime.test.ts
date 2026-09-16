import { test } from "node:test";
import assert from "node:assert/strict";
import { registerHooks } from "node:module";

// Node strips types but does not resolve the extensionless imports used by Eve's compiler.
registerHooks({ resolve(specifier, context, next) {
  try { return next(specifier, context); }
  catch (error) {
    if (specifier.startsWith(".") && context.parentURL?.includes("/agent/")) return next(`${specifier}.ts`, context);
    throw error;
  }
} });
const { contextStorage, ContextContainer } = await import(new URL("./context/container.js", import.meta.resolve("eve")).href);
const { default: confirmationHook } = await import("../agent/hooks/confirmation.ts");
const { default: confirmAction } = await import("../agent/tools/confirm_action.ts");
const { default: bash } = await import("../agent/tools/bash.ts");
const { confirmations } = await import("../agent/lib/confirmation-state.ts");

// Exercise the authored workflow, actual hook/state and guarded shell tool together.
test("native confirmation continuation authorizes the frozen operation once in the same session", async () => {
  await contextStorage.run(new ContextContainer(), async () => {
    let executions = 0;
    const ctx: any = { getSandbox: async () => ({ run: async () => { executions++; return { exitCode: 0, stdout: "Deleted synthetic workflow.", stderr: "" }; } }) };
    const command = "rm synthetic-workflow.json";
    const input = { action: "Delete workflow", target: "Network enrichment", consequence: "Removes its saved results.", operation: { tool: "bash" as const, command } };
    assert.throws(() => bash.execute({ command, destructive: true, confirmationId: null }, ctx), /Confirmation required/);
    confirmationHook.events["actions.requested"]!({ data: { actions: [{ kind: "tool-call", toolName: "confirm_action", callId: "a", input }] } } as any, ctx);
    let answer!: (response: any) => void;
    const result = confirmAction.execute(input, { callId: "a", ask: async (request: any) => {
      assert.deepEqual(request.options.map((o: any) => o.label), ["Yes", "No"]);
      return new Promise(resolve => { answer = resolve; });
    } } as any);
    assert.equal(executions, 0);
    assert.throws(() => bash.execute({ command, destructive: true, confirmationId: "a" }, ctx), /Confirmation required/);
    answer({ optionId: "a:yes" });
    const output = await result;
    const event: any = { data: { result: { kind: "tool-result", callId: "a", toolName: "confirm_action", output } } };
    confirmationHook.events["action.result"]!(event, ctx);
    // State survives a serialized step boundary.
    const restored = new ContextContainer();
    for (const [key, value] of contextStorage.getStore().entries()) restored.set(key, JSON.parse(JSON.stringify(value)));
    await contextStorage.run(restored, async () => {
      assert.throws(() => bash.execute({ command: "rm other.json", destructive: true, confirmationId: "a" }, ctx));
      await bash.execute({ command, destructive: true, confirmationId: "a" }, ctx);
      assert.equal(executions, 1);
      confirmationHook.events["action.result"]!(event, ctx);
      assert.throws(() => bash.execute({ command, destructive: true, confirmationId: "a" }, ctx));
      assert.equal(executions, 1);
    });
  });
});

test("No, plain text, and a stale Yes never create a grant; another session has no grant", async () => {
  for (const response of [{ optionId: "b:no" }, { text: "Yes" }, { optionId: "a:yes" }]) {
    await contextStorage.run(new ContextContainer(), async () => {
      const ctx: any = {};
      const input = { action: "Delete workflow", target: "Other workflow", consequence: "Removes saved results.", operation: { tool: "bash" as const, command: "rm other.json" } };
      confirmationHook.events["actions.requested"]!({ data: { actions: [{ kind: "tool-call", toolName: "confirm_action", callId: "b", input }] } } as any, ctx);
      const output = await confirmAction.execute(input, { callId: "b", ask: async () => response } as any);
      confirmationHook.events["action.result"]!({ data: { result: { kind: "tool-result", callId: "b", toolName: "confirm_action", output } } } as any, ctx);
      assert.equal(output.confirmed, false);
      assert.deepEqual(confirmations.get().grants, {});
    });
  }
  await contextStorage.run(new ContextContainer(), () => assert.deepEqual(confirmations.get().grants, {}));
});

const { appendPendingInputBatch, resolvePendingInput, hasPendingInputBatch } = await import(new URL("./harness/input-requests.js", import.meta.resolve("eve")).href);
const { parseBlockActionsPayload } = await import(new URL("./public/channels/slack/interactions.js", import.meta.resolve("eve")).href);
const { deriveHitlResponse } = await import(new URL("./public/channels/slack/hitl.js", import.meta.resolve("eve")).href);
const { questionMessage } = await import("../agent/lib/slack-questions.ts");

test("Slack choice-menu selections resume the original question through Eve's real callback parser", () => {
  const request = { requestId: "source-request", kind: "question" as const, prompt: "Choose a source.", allowFreeform: true,
    options: [{ id: "csv-source", label: "CSV", description: "Import supplied records." }, { id: "saved-source", label: "Saved table", description: "Reuse the existing records." }],
    action: { kind: "tool-call" as const, callId: "source-call", toolName: "ask_question", input: {} } };
  const message = questionMessage(request);
  const select = (message.blocks![1] as any).elements[0];
  for (const option of select.options) {
    const parsed = parseBlockActionsPayload({ type: "block_actions", user: { id: "U-fixture" }, team: { id: "T-fixture" }, channel: { id: "C-fixture" },
      message: { ts: "1.2", thread_ts: "1.1", blocks: message.blocks }, actions: [{ type: "static_select", action_id: select.action_id, selected_option: option }] });
    const derived = deriveHitlResponse(parsed.actions[0]);
    assert.deepEqual(derived.response, { requestId: request.requestId, optionId: option.value });
    const session = appendPendingInputBatch({ session: { sessionId: "choice-session", history: [], state: {} }, requests: [request], responseMessages: [], event: { turnId: "turn", stepIndex: 0, sequence: 1 } });
    const result = resolvePendingInput({ session, stepInput: { inputResponses: [derived.response] } });
    assert.equal(result.outcome, "resolved");
    assert.equal(hasPendingInputBatch(result.session.state), false);
    assert.ok(JSON.stringify(result.messages).includes(option.value));
  }
});

test("oversized choice IDs resolve intact from the numbered thread fallback", () => {
  const request = { requestId: "large-option-request", kind: "question" as const, prompt: "Choose a source.", allowFreeform: false,
    options: [{ id: "gateway", label: "Type your answer" }, { id: "c".repeat(151), label: "CSV", description: "Import supplied records." }],
    action: { kind: "tool-call" as const, callId: "large-call", toolName: "ask_question", input: {} } };
  assert.match(questionMessage(request).text, /2\. CSV/);
  const session = appendPendingInputBatch({ session: { sessionId: "fallback-session", history: [], state: {} }, requests: [request], responseMessages: [], event: { turnId: "turn", stepIndex: 0, sequence: 1 } });
  const result = resolvePendingInput({ session, stepInput: { message: "2" } });
  assert.equal(result.outcome, "resolved");
  assert.ok(JSON.stringify(result.messages).includes(request.options[1].id));
});

test("Eve resumes an open question from a normal thread reply or attachment without a modal", () => {
  const request = { requestId: "csv-request", kind: "question", prompt: "Upload the CSV of connections or followers.", allowFreeform: true,
    action: { kind: "tool-call", callId: "csv-call", toolName: "ask_question", input: {} } };
  const session = appendPendingInputBatch({ session: { sessionId: "synthetic-session", history: [], state: {} }, requests: [request], responseMessages: [], event: { turnId: "turn", stepIndex: 0, sequence: 1 } });
  assert.equal(resolvePendingInput({ session }).outcome, "unresolved");
  const text = resolvePendingInput({ session, stepInput: { message: "Use the connected database instead." } });
  assert.equal(text.outcome, "resolved");
  assert.equal(hasPendingInputBatch(text.session.state), false);
  assert.match(JSON.stringify(text.messages), /Use the connected database instead/);
  const file = resolvePendingInput({ session, stepInput: { message: [{ type: "file", filename: "connections.csv", mediaType: "text/csv", data: new Uint8Array([65]) }] } });
  assert.equal(file.outcome, "resolved");
  assert.equal(hasPendingInputBatch(file.session.state), false);
  assert.notEqual(file.consumedMessage, true, "attachment remains available to the resumed turn");
});

const { default: writeFile } = await import("../agent/tools/write_file.ts");
test("new files and routine edits run directly; destructive replacement requires exact confirmed content", async () => {
  await contextStorage.run(new ContextContainer(), async () => {
    let content: string | null = null;
    let writes = 0;
    const filePath = "/workspace/example.txt";
    const sandbox = {
      run: async () => ({ exitCode: content === null ? 1 : 0 }),
      readTextFile: async () => content,
      writeTextFile: async (input: any) => { content = input.content; writes++; },
    };
    const ctx: any = { getSandbox: async () => sandbox };
    const execute = async (text: string, confirmationId: string | null, destructive = true) => {
      for await (const result of writeFile.execute({ filePath, content: text, destructive, confirmationId }, ctx)) assert.equal(result.path, filePath);
    };
    await execute("original", null, false);
    assert.equal(writes, 1);
    await execute("routine edit", null, false);
    assert.equal(content, "routine edit");
    await assert.rejects(execute("replacement", null), /Confirmation required/);
    assert.equal(content, "routine edit");
    const input = { action: "Replace file", target: "example.txt", consequence: "Replaces existing text.", operation: { tool: "write_file" as const, filePath, content: "replacement" } };
    confirmationHook.events["actions.requested"]!({ data: { actions: [{ kind: "tool-call", toolName: "confirm_action", callId: "write-a", input }] } } as any, ctx);
    const output = await confirmAction.execute(input, { callId: "write-a", ask: async () => ({ optionId: "write-a:yes" }) } as any);
    confirmationHook.events["action.result"]!({ data: { result: { kind: "tool-result", callId: "write-a", toolName: "confirm_action", output } } } as any, ctx);
    await assert.rejects(execute("different", "write-a"), /Confirmation required/);
    await execute("replacement", "write-a");
    await assert.rejects(execute("replacement", "write-a"), /Confirmation required/);
    assert.equal(content, "replacement");
    assert.equal(writes, 3);
  });
});


test("listing workflows and ordinary shell work execute without asking for confirmation", async () => {
  await contextStorage.run(new ContextContainer(), async () => {
    const commands = [
      'ls -la "$HOME/.gtm"',
      'find "$HOME/.gtm/workflows" -name "*.ts"',
      'cd "$HOME/.gtm" && rg "name:" workflows | head -20',
      'node scripts/list-workflows.mjs',
      'mkdir -p "$HOME/.gtm/reports"',
      'npm test',
    ];
    const executions: string[] = [];
    const ctx: any = { getSandbox: async () => ({ run: async ({ command }: any) => {
      executions.push(command); return { exitCode: 0, stdout: "done", stderr: "" };
    } }) };
    for (const command of commands) await bash.execute({ command, destructive: false, confirmationId: null } as any, ctx);
    assert.deepEqual(executions, commands);
    assert.deepEqual(confirmations.get().grants, {});
  });
});
