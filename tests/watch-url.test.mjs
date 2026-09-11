import assert from 'node:assert/strict';
import test from 'node:test';
import { allowedWatchPath } from '../agent/lib/watch-paths.ts';

test('the watcher accepts the deployment route, one run, and the latest-run lookup', () => {
  assert.equal(allowedWatchPath('/api/deployment'), true);
  assert.equal(allowedWatchPath('/api/runs/abc123'), true);
  assert.equal(allowedWatchPath('/api/runs/latest?workflow=score&head=0123abcd'), true);
});

test('the watcher refuses every other path', () => {
  for (const path of ['/api/run/score', '/api/runs/abc/cancel', '/api/approve/x', '/api/runs/latest?workflow=score&x=1', '/api/runs/../run/score', 'https://evil.example/api/deployment', '/api/deployment?names=A']) {
    assert.equal(allowedWatchPath(path), false, path);
  }
});
