import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfiguration } from '../agent/lib/config.ts';
import { gitAuthorization, sessionEnvironment, sessionNetworkPolicy } from '../agent/lib/workflow-session.ts';

const config = parseConfiguration({
  SLACK_CONNECTOR: 'slack/agent', GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS: 'C0123456789', GTM_AGENT_ALLOWED_SLACK_USER_IDS: 'U0123456789',
  GITHUB_CONNECTOR: 'github/agent', GTM_WORKSPACE_REPOSITORY: 'acme/gtm-workspace',
  GTM_WORKSPACE_COMMIT_AUTHOR_NAME: 'Acme Bot', GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL: '1+acme@users.noreply.github.com',
  TURSO_DATABASE_URL: 'libsql://acme-db-acme.turso.io', TURSO_READ_ONLY_AUTH_TOKEN: 'ro-token',
  GTM_WORKFLOW_URL: 'https://acme-workflows.vercel.app', GTM_RUN_SECRET: 'run-secret',
});

test('the session environment carries no secret', () => {
  const env = sessionEnvironment(config);
  assert.equal(env.GTM_SANDBOX, '1');
  assert.equal(env.GTM_HOST, 'eve');
  assert.equal(env.GIT_TERMINAL_PROMPT, '0');
  assert.equal(env.GTM_BASE_URL, 'https://acme-workflows.vercel.app');
  for (const value of Object.values(env)) {
    assert.ok(!value.includes('run-secret') && !value.includes('ro-token'), value);
  }
});

test('the network policy allows exactly the five hosts and injects placeholders per host', () => {
  const policy = sessionNetworkPolicy(config, gitAuthorization('gh-token'));
  assert.deepEqual(Object.keys(policy.allow).sort(), ['acme-db-acme.turso.io', 'acme-workflows.vercel.app', 'codeload.github.com', 'github.com', 'registry.npmjs.org']);
  assert.equal(policy.allow['acme-workflows.vercel.app'][0].transform[0].headers.authorization, 'Bearer run-secret');
  assert.equal(policy.allow['acme-db-acme.turso.io'][0].transform[0].headers.authorization, 'Bearer ro-token');
  const github = policy.allow['github.com'][0];
  assert.equal(github.match.headers[0].value.exact, `Basic ${Buffer.from('x-access-token:gtm-sandbox').toString('base64')}`);
  assert.equal(github.transform[0].headers.authorization, gitAuthorization('gh-token'));
});

test('without a GitHub token the policy allows github.com but injects nothing', () => {
  const policy = sessionNetworkPolicy(config);
  assert.deepEqual(policy.allow['github.com'], []);
});
