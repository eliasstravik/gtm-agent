import assert from 'node:assert/strict';
import test from 'node:test';
import { parseConfiguration, resolveAgentModel, resolveAgentReasoning, resolveSlackConfiguration } from '../agent/lib/config.ts';

const base = {
  SLACK_CONNECTOR: 'slack/agent',
  GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS: 'C0123456789',
  GTM_AGENT_ALLOWED_SLACK_USER_IDS: 'U0123456789, U0123456789',
  GITHUB_CONNECTOR: 'github/agent',
  GTM_WORKSPACE_REPOSITORY: 'acme/gtm-workspace',
  GTM_WORKSPACE_COMMIT_AUTHOR_NAME: 'Acme Bot',
  GTM_WORKSPACE_COMMIT_AUTHOR_EMAIL: '1+acme@users.noreply.github.com',
  TURSO_DATABASE_URL: 'libsql://acme-db-acme.turso.io',
  TURSO_READ_ONLY_AUTH_TOKEN: 'ro',
  GTM_WORKFLOW_URL: 'https://acme-workflows.vercel.app',
  GTM_RUN_SECRET: 'secret',
};

test('a complete environment parses with deduplicated allowlists and derived hosts', () => {
  const config = parseConfiguration(base);
  assert.deepEqual(config.slack.allowedUserIds, ['U0123456789']);
  assert.equal(config.workspace.owner, 'acme');
  assert.equal(config.turso.host, 'acme-db-acme.turso.io');
  assert.equal(config.workflow.host, 'acme-workflows.vercel.app');
  assert.equal(config.reasoning, 'medium');
});

test('every required variable is named when missing', () => {
  for (const name of Object.keys(base)) {
    const env = { ...base }; delete env[name];
    assert.throws(() => parseConfiguration(env), new RegExp(name), name);
  }
});

test('the workspace repository may not be the agent repository', () => {
  assert.throws(() => parseConfiguration({ ...base, VERCEL_GIT_REPO_OWNER_SLUG: 'acme', VERCEL_GIT_REPO_SLUG: 'gtm-workspace' }), /must not be the agent source repository/);
});

test('the workflow URL must be a bare HTTPS origin', () => {
  assert.throws(() => parseConfiguration({ ...base, GTM_WORKFLOW_URL: 'http://acme.vercel.app' }), /HTTPS origin/);
  assert.throws(() => parseConfiguration({ ...base, GTM_WORKFLOW_URL: 'https://acme.vercel.app/api' }), /HTTPS origin/);
});

test('model and reasoning resolve from their own variables without the rest of the configuration', () => {
  assert.equal(resolveAgentModel({}), 'deepseek/deepseek-v4.1-flash');
  assert.equal(resolveAgentReasoning({}), 'medium');
  assert.equal(resolveAgentModel({ GTM_AGENT_MODEL: ' openai/gpt-5 ' }), 'openai/gpt-5');
  assert.equal(resolveAgentReasoning({ GTM_AGENT_REASONING: 'low' }), 'low');
  assert.throws(() => resolveAgentReasoning({ GTM_AGENT_REASONING: 'extreme' }), /GTM_AGENT_REASONING must be one of/);
});

test('outside production an unconfigured Slack channel admits nobody instead of failing the build', () => {
  assert.deepEqual(resolveSlackConfiguration({}), { connector: 'slack/unconfigured', allowedChannelIds: [], allowedUserIds: [] });
  assert.deepEqual(resolveSlackConfiguration({ VERCEL_ENV: 'preview' }), { connector: 'slack/unconfigured', allowedChannelIds: [], allowedUserIds: [] });
});

test('a production or partially configured Slack channel is still validated', () => {
  assert.throws(() => resolveSlackConfiguration({ VERCEL_ENV: 'production' }), /SLACK_CONNECTOR is required/);
  assert.throws(() => resolveSlackConfiguration({ SLACK_CONNECTOR: 'slack/agent' }), /GTM_AGENT_ALLOWED_SLACK_CHANNEL_IDS is required/);
  assert.deepEqual(resolveSlackConfiguration(base), parseConfiguration(base).slack);
});
