import assert from 'node:assert/strict';
import test from 'node:test';
import { approvalCardText, decideApproval, replayKey, recordApproved } from '../agent/lib/approval.ts';

const allow = (command) => command.startsWith('npm run gtm -- check');

test('allow-listed commands never ask', () => {
  assert.equal(decideApproval({ command: 'npm run gtm -- check' }, { retries: {} }, allow).kind, 'not-applicable');
});

test('an ask command without a summary is denied with the plain sentence', () => {
  const decision = decideApproval({ command: 'git push' }, { retries: {} }, allow);
  assert.equal(decision.kind, 'denied');
  assert.match(decision.reason, /Say in plain words what this does and what it costs/);
});

test('the first ask requests a card, the same command and summary replay twice, then ask again', () => {
  const input = { command: 'git push', summary: 'Save the scoring workflow and test one row for $0.02.' };
  let state = { retries: {} };
  assert.equal(decideApproval(input, state, allow).kind, 'user-approval');
  state = recordApproved(input, state);
  assert.equal(decideApproval(input, state, allow).kind, 'approved');
  state = decideApproval(input, state, allow).state;
  assert.equal(decideApproval(input, state, allow).kind, 'approved');
  state = decideApproval(input, state, allow).state;
  assert.equal(decideApproval(input, state, allow).kind, 'user-approval');
});

test('a different command under the same summary asks again', () => {
  const approved = { command: 'git push', summary: 'Save it.' };
  const state = recordApproved(approved, { retries: {} });
  assert.equal(decideApproval({ command: 'npm run gtm -- run score --input data/all.json', summary: 'Save it.' }, state, allow).kind, 'user-approval');
  assert.notEqual(replayKey(approved), replayKey({ command: 'git push', summary: 'Save it!' }));
});

test('the card shows the summary, never the command or JSON', () => {
  const text = approvalCardText({ kind: 'tool-approval', prompt: 'Approve bash?', action: { input: { command: 'git push && rm -rf x', summary: 'Save the workflow.' } } });
  assert.equal(text, 'Save the workflow.');
  assert.ok(!text.includes('git push'));
  assert.equal(approvalCardText({ kind: 'question', prompt: 'Which one?' }), 'Which one?');
  assert.equal(approvalCardText({ kind: 'tool-approval', prompt: '', action: { input: {} } }), 'Approve this action?');
  assert.equal(approvalCardText({ kind: 'tool-approval', prompt: '', action: { input: { summary: 'x'.repeat(900) } } }).length, 700);
});
