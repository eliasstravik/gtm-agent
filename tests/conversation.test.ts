import { test } from "node:test";
import assert from "node:assert/strict";
import { confirmationQuestion, consumeConfirmation, recordConfirmation, type Confirmation, type ConfirmationState } from "../agent/lib/confirmation.ts";
import { postQuestions, questionMessage } from "../agent/lib/slack-questions.ts";

const action: Confirmation = { confirmationId: "call-a", confirmed: true, action: "Delete workflow", target: "Network enrichment", consequence: "Removes its saved results.", operation: { tool: "bash", command: "rm synthetic-workflow.json" } };
const pending = (): ConfirmationState => ({ pendingCallId: "call-a", grants: {}, consumed: [] });
const question = (options: any[] = []) => ({ requestId: "request-1", kind: "question" as const, prompt: "Upload the CSV of connections or followers.", options, allowFreeform: true, action: { kind: "tool-call" as const, callId: "call-1", toolName: "ask_question", input: {} } });

test("CSV requests and accidental gateway options render without an action button", async () => {
  for (const options of [[], [{ id: "answer", label: "Type your answer" }], [{ id: "file", label: "Upload file" }]]) {
    const posts: any[] = [];
    await postQuestions({ requests: [question(options)], sequence: 1, stepIndex: 1, turnId: "turn-1" }, { thread: { post: async (message: any) => { posts.push(message); return { id: "1" }; } }, state: {} } as any);
    assert.equal(posts[0].text, question().prompt);
    assert.equal(posts[0].blocks.some((block: any) => block.type === "actions"), false);
    assert.equal(JSON.stringify(posts).includes("Type your answer"), false);
  }
});

test("real source/provider choices retain Eve's ID-addressed interaction contract", () => {
  const result = questionMessage(question([{ id: "csv", label: "CSV" }, { id: "answer", label: "Type your answer" }, { id: "table", label: "Existing table" }]));
  const actions = result.blocks[1] as any;
  assert.deepEqual(actions.elements.map((button: any) => [button.action_id, button.value]), [["eve_input:request-1:button:0", "csv"], ["eve_input:request-1:button:1", "table"]]);
  assert.equal(JSON.stringify(result).includes("eve_input_freeform"), false);
});

test("confirmation has exactly Yes/No, action-specific IDs and a concrete consequence", () => {
  const q = confirmationQuestion(action, "call-a");
  assert.deepEqual(q.options.map(o => o.label), ["Yes", "No"]);
  assert.equal(q.allowFreeform, false);
  assert.match(q.prompt, /Delete workflow Network enrichment\? Removes its saved results/);
  assert.notEqual(q.options[0].id, confirmationQuestion(action, "call-b").options[0].id);
});

test("Yes executes once; missing, No, stale, duplicate, and changed operations execute nothing", () => {
  assert.throws(() => consumeConfirmation(pending(), null, action.operation), /Confirmation required/);
  assert.throws(() => consumeConfirmation(recordConfirmation(pending(), { ...action, confirmed: false }), "call-a", action.operation));
  const approved = recordConfirmation(pending(), action);
  assert.throws(() => consumeConfirmation(approved, "call-old", action.operation));
  assert.throws(() => consumeConfirmation(approved, "call-a", { tool: "bash", command: "rm different-workflow.json" }));
  const used = consumeConfirmation(approved, "call-a", action.operation);
  assert.throws(() => consumeConfirmation(used, "call-a", action.operation));
  assert.deepEqual(recordConfirmation(used, action), used);
  const newer = { ...pending(), pendingCallId: "call-b" };
  assert.deepEqual(recordConfirmation(newer, action), newer);
});

test("a confirmed overwrite is bound to both file path and replacement content", () => {
  const overwrite: Confirmation = { ...action, operation: { tool: "write_file", filePath: "/workspace/example.json", content: "new" } };
  const approved = recordConfirmation(pending(), overwrite);
  assert.throws(() => consumeConfirmation(approved, "call-a", { ...overwrite.operation as any, content: "different" }));
  assert.throws(() => consumeConfirmation(approved, "call-a", { ...overwrite.operation as any, filePath: "/workspace/other.json" }));
  assert.deepEqual(consumeConfirmation(approved, "call-a", overwrite.operation).grants, {});
});
