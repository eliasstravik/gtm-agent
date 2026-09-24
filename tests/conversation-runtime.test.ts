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
    answer({ status: "answered", optionId: "a:yes" });
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

test("No, plain text, a stale Yes, a dismissal, no reachable person, or a Yes without status never create a grant", async () => {
  const responses = [{ status: "answered", optionId: "b:no" }, { status: "answered", text: "Yes" }, { status: "answered", optionId: "a:yes" },
    { status: "dismissed" }, { status: "unavailable" }, { optionId: "b:yes" }];
  for (const response of responses) {
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

// Since Eve 0.65 a question from ctx.ask() (ask_question, confirm_action) is answered through the tool's workflow hook,
// not the harness's pending-input batch; a thread reply reaches it through Eve's text resolver.
const { resolveTextToResponse } = await import(new URL("./channel/resolve-text.js", import.meta.resolve("eve")).href);
const { parseBlockActionsPayload } = await import(new URL("./public/channels/slack/interactions.js", import.meta.resolve("eve")).href);
const { deriveHitlResponse } = await import(new URL("./public/channels/slack/hitl.js", import.meta.resolve("eve")).href);
const { toAskQuestionRequest } = await import(new URL("./execution/tools/ask-question-workflow.js", import.meta.resolve("eve")).href);
const { questionMessage } = await import("../agent/lib/slack-questions.ts");
const { confirmationQuestion } = await import("../agent/lib/confirmation.ts");

test("Slack radio selections answer the original question through Eve's real callback parser", () => {
  // The request ask_question sends: option IDs are the labels, free text and dismissal allowed.
  const sourceRequest = { requestId: "source-request", kind: "question" as const, ...toAskQuestionRequest({ question: "Choose a source.",
    options: [{ label: "CSV", description: "Import supplied records." }, { label: "Saved table", description: "Reuse the existing records." }] }),
    action: { kind: "tool-call" as const, callId: "source-call", toolName: "ask_question", input: {} } };
  const confirmation = { ...sourceRequest, requestId: "delete-request", ...confirmationQuestion({
    action: "Remove", target: "synthetic data", consequence: "Removes its saved records.",
    operation: { tool: "bash", command: "rm synthetic-workflow.json" },
  }, "delete-call") };
  for (const request of [sourceRequest, confirmation]) {
    const message = questionMessage(request);
    const select = (message.blocks![1] as any).elements[0];
    assert.equal(select.type, "radio_buttons");
    assert.equal(select.initial_option, undefined);
    for (const [index, option] of select.options.entries()) {
      const parsed = parseBlockActionsPayload({ type: "block_actions", user: { id: "U-fixture" }, team: { id: "T-fixture" }, channel: { id: "C-fixture" },
        message: { ts: "1.2", thread_ts: "1.1", blocks: message.blocks }, actions: [{ type: "radio_buttons", action_id: select.action_id, selected_option: option }] });
      const derived = deriveHitlResponse(parsed.actions[0]);
      assert.deepEqual(derived.response, { requestId: request.requestId, optionId: option.value });
      assert.equal(option.value, request.options![index].id);
    }
  }
});

test("oversized choice IDs resolve intact from the numbered thread fallback", () => {
  const request = { requestId: "large-option-request", kind: "question" as const, prompt: "Choose a source.", allowFreeform: false,
    options: [{ id: "gateway", label: "Type your answer" }, { id: "c".repeat(151), label: "CSV", description: "Import supplied records." }],
    action: { kind: "tool-call" as const, callId: "large-call", toolName: "ask_question", input: {} } };
  assert.match(questionMessage(request).text, /2\. CSV/);
  assert.deepEqual(resolveTextToResponse("2", request), { requestId: request.requestId, optionId: request.options[1].id });
});

test("a normal thread reply answers an open question without a modal", () => {
  const request = { requestId: "csv-request", kind: "question" as const, ...toAskQuestionRequest({ question: "Upload the CSV of connections or followers." }),
    action: { kind: "tool-call" as const, callId: "csv-call", toolName: "ask_question", input: {} } };
  const message = questionMessage(request);
  assert.equal(message.blocks!.length, 1, "an open question posts as plain text with no input element");
  assert.deepEqual(resolveTextToResponse("Use the connected database instead.", request), { requestId: request.requestId, text: "Use the connected database instead." });
});

test("a typed Yes or a number picks the confirmation option, and other text answers nothing", () => {
  const request = { requestId: "delete-request", ...confirmationQuestion({ action: "Remove", target: "synthetic data", consequence: "Removes its saved records.",
    operation: { tool: "bash", command: "rm synthetic-workflow.json" } }, "delete-call") };
  assert.deepEqual(resolveTextToResponse("yes", request), { requestId: request.requestId, optionId: "delete-call:yes" });
  assert.deepEqual(resolveTextToResponse("2", request), { requestId: request.requestId, optionId: "delete-call:no" });
  assert.equal(resolveTextToResponse("sure, go ahead", request), undefined);
  assert.equal(request.dismissible, true);
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
    const output = await confirmAction.execute(input, { callId: "write-a", ask: async () => ({ status: "answered", optionId: "write-a:yes" }) } as any);
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
