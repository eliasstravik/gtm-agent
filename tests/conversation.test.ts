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
  const result = questionMessage(question([{ id: "csv", label: "CSV", description: "Import the uploaded file." }, { id: "answer", label: "Type your answer" }, { id: "table", label: "Existing table", description: "Reuse saved records." }]));
  const actions = result.blocks[1] as any;
  assert.equal(actions.elements.length, 1);
  const select = actions.elements[0];
  assert.equal(select.type, "radio_buttons");
  assert.equal(select.action_id, "eve_input:request-1");
  assert.deepEqual(select.options.map((option: any) => [option.value, option.text.text, option.description.text]), [["csv", "CSV", "Import the uploaded file."], ["table", "Existing table", "Reuse saved records."]]);
  assert.equal(JSON.stringify(result).includes("eve_input_freeform"), false);
});

test("question choices use radio buttons at every supported option count and stay within Slack text limits", () => {
  for (const count of [1, 2, 5, 6, 10]) {
    const options = Array.from({ length: count }, (_, index) => ({ id: `option-${index}`, label: "🙂".repeat(80), description: "Details ".repeat(30) }));
    const result = questionMessage(question(options));
    const select = (result.blocks[1] as any).elements[0];
    assert.equal(select.type, "radio_buttons");
    assert.equal(select.options.length, count);
    assert.equal(select.initial_option, undefined, "never submit or preselect an answer");
    for (const [index, option] of select.options.entries()) {
      assert.equal(option.value, options[index].id, "preserve the answer identifier");
      assert.ok(option.text.text.length <= 75);
      assert.ok(option.description.text.length <= 75);
      assert.equal(option.text.text.isWellFormed(), true);
    }
  }
});

test("short option text stays intact and empty descriptions are omitted", () => {
  const result = questionMessage(question([{ id: "a", label: "A", description: " " }, { id: "b", label: "B", description: "b".repeat(75) }]));
  const options = (result.blocks[1] as any).elements[0].options;
  assert.deepEqual(options[0], { text: { type: "plain_text", text: "A" }, value: "a" });
  assert.equal(options[1].description.text, "b".repeat(75));
});

test("oversized choice metadata stays answerable without invalid Slack controls", async () => {
  const options = [{ id: "gateway", label: "Type your answer" }, { id: "x".repeat(151), label: "CSV", description: "Import the file." }];
  for (const request of [question(options), { ...question([{ id: "csv", label: "CSV" }]), requestId: "r".repeat(256) }, question(Array.from({ length: 11 }, (_, index) => ({ id: `id-${index}`, label: `Choice ${index}` })))]) {
    const posts: any[] = [];
    await postQuestions({ requests: [request], sequence: 1, stepIndex: 1, turnId: "turn-1" }, { thread: { post: async (message: any) => { posts.push(message); return { id: "1" }; } }, state: {} } as any);
    assert.ok(posts.every(message => !message.blocks && message.text.length <= 40000));
    assert.match(posts[0].text, /Reply in this thread with the option number/);
  }
  assert.match(questionMessage(question(options)).text, /2\. CSV: Import the file/);
});

test("native tool approvals retain their confirmation buttons and pending-card state", async () => {
  const request = { ...question([{ id: "approve", label: "Approve" }, { id: "cancel", label: "Cancel" }]), kind: "tool-approval" as const, allowFreeform: false };
  const state: any = {};
  const posts: any[] = [];
  await postQuestions({ requests: [request], sequence: 1, stepIndex: 1, turnId: "turn-1" }, { thread: { post: async (message: any) => { posts.push(message); return { id: "message-1" }; } }, state } as any);
  assert.deepEqual(posts[0].blocks[1].elements.map((button: any) => [button.type, button.action_id, button.value]), [
    ["button", "eve_input:tool-approval:request-1:button:0", "approve"],
    ["button", "eve_input:tool-approval:request-1:button:1", "cancel"],
  ]);
  assert.equal(state.pendingApprovalCards[request.requestId].messageTs, "message-1");
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
