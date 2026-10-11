import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { actorLogFields, clientLogFields, createLogger, loggerFromEnv, userAgentLogFields, userRef } from '../src/lib/log.ts';
import { ToolMetrics } from '../src/lib/metrics.ts';
import { SERVER_INFO } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import { raw, startApp } from './helpers.ts';

test('production logs use Railway JSON fields and deployment metadata; local text remains available', () => {
  const lines: string[] = [];
  const log = loggerFromEnv({ NODE_ENV: 'production', RAILWAY_ENVIRONMENT_NAME: 'production', RAILWAY_DEPLOYMENT_ID: 'deployment-1', RAILWAY_GIT_COMMIT_SHA: 'abc123' }, line => lines.push(line));
  log.child({ req: 'req1', level: 'error', message: 'spoofed' }).info('http.ready', { event: 'spoofed', t: 'spoofed', error: 'two\nlines' });
  assert.equal(lines.length, 1);
  assert.equal(lines[0]!.includes('\n'), false);
  const { t, ...entry } = JSON.parse(lines[0]!);
  assert.ok(Number.isFinite(Date.parse(t)));
  assert.deepEqual(entry, { level: 'info', message: 'http.ready', event: 'http.ready', service: 'mcportal', version: SERVER_INFO.version, environment: 'production', deployment: 'deployment-1', commit: 'abc123', req: 'req1', error: 'two\nlines' });
  for (const env of [{}, { NODE_ENV: 'production', MCPORTAL_LOG_FORMAT: 'text' }]) {
    const text: string[] = [];
    loggerFromEnv(env, line => text.push(line)).info('ready');
    assert.match(text[0]!, /^\[mcportal\] info ready /);
  }
  const railway: string[] = [];
  loggerFromEnv({ RAILWAY_ENVIRONMENT_ID: 'env' }, line => railway.push(line)).warn('warning');
  assert.equal(JSON.parse(railway[0]!).level, 'warn');
});

test('JSON diagnostics stay on stderr so stdio protocol stdout is never polluted', () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', "import {loggerFromEnv} from './src/lib/log.ts'; loggerFromEnv({NODE_ENV:'production'}).info('ready');"], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '');
  assert.equal(JSON.parse(result.stderr).message, 'ready');
});

test('account attribution uses trusted roles and configured ids, and keeps raw identities out', () => {
  const actor = { accountId: 'github-123', role: 'user' as const, status: 'active' as const, login: 'private-login' };
  assert.deepEqual(actorLogFields(actor.accountId, actor, {}), { user: userRef(actor.accountId), traffic: 'user' });
  assert.equal(actorLogFields(actor.accountId, { ...actor, role: 'admin' }, {}).traffic, 'internal');
  assert.equal(actorLogFields(actor.accountId, actor, { MCPORTAL_INTERNAL_USERS: 'github-9, github-123' }).traffic, 'internal');
  assert.equal(actorLogFields(actor.accountId, actor, { MCPORTAL_INTERNAL_USERS: 'github-1234' }).traffic, 'user');
  assert.equal(actorLogFields('local-id', undefined, {}).traffic, 'local');
  assert.doesNotMatch(JSON.stringify(actorLogFields(actor.accountId, actor, {})), /github-123|private-login/);
});

test('client identity/version observations are bounded and cannot inject arbitrary text', () => {
  assert.deepEqual(userAgentLogFields('codex-mcp-client/0.162.0-alpha.17.2'), { host: 'codex', clientVersion: '0.162.0-alpha.17.2' });
  for (const version of ['token@example.com', '1.2.3+private-device', '1.2.3-secret', '1.2.3\nspoofed', '1'.repeat(1000), {}]) {
    assert.deepEqual(clientLogFields({ name: 'codex', version }), { host: 'codex', clientVersion: 'other' });
  }
  assert.deepEqual(clientLogFields({ name: '__proto__', version: '1.2.3' }), { host: 'unknown', clientVersion: 'unknown' });
  assert.deepEqual(userAgentLogFields('private-client/secret'), { host: 'unknown', clientVersion: 'unknown' });
});

test('activity summaries count connections separately from calls, split traffic, and reset interval deltas', () => {
  let now = 0;
  const metrics = new ToolMetrics(() => now);
  const lines: string[] = [];
  const log = createLogger({ format: 'json', write: line => lines.push(line) });
  for (let i = 0; i < 38; i++) metrics.recordConnection('codex', 'internal');
  metrics.record('open_room', 'ok', 100, undefined, 'internal');
  metrics.record('open_room', 'error', 300, 'upstream_error', 'internal');
  metrics.record('open_room', 'ok', 50, undefined, 'user');
  now = 300_000;
  metrics.flushActivity(log);
  const entries = lines.map(line => JSON.parse(line));
  assert.equal(entries.length, 3);
  assert.equal(entries[0].event, 'protocol.connections');
  assert.equal(entries[0].count, 38);
  assert.equal(entries[0].windowMs, 300_000);
  assert.equal(entries[1].traffic, 'internal');
  assert.equal(entries[1].calls, 2);
  assert.equal(entries[1].errors, 1);
  assert.equal(entries[1].errorRate, 0.5);
  assert.equal(entries[1].avgMs, 200);
  assert.equal(entries[1].maxMs, 300);
  assert.equal(entries[2].traffic, 'user');
  metrics.flushActivity(log);
  assert.equal(lines.length, 3, 'idle windows do not repeat stale counts');
  assert.equal(metrics.snapshot().tools[0]!.calls, 3, 'admin lifetime counters survive a summary');
  metrics.recordConnection('codex', 'internal');
  now += 300_000;
  metrics.flushActivity(log);
  assert.equal(JSON.parse(lines[3]!).count, 1);
});

test('HTTP keeps handshakes quiet, logs failed tools despite HTTP 200, and isolates request attribution', async () => {
  const lines: string[] = [];
  const app = await startApp({ staticToken: 'secret-token', staticUser: 'private-account' }, undefined, {
    log: createLogger({ format: 'json', write: line => lines.push(line) }),
    checkStorage: async () => { throw new Error('unavailable'); },
  });
  const headers = { authorization: 'Bearer secret-token', 'content-type': 'application/json', 'user-agent': 'codex-mcp-client/0.162.0-alpha.17.2' };
  try {
    const init = await raw(app.port, { method: 'POST', path: '/mcp', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', clientInfo: { name: 'codex', version: '0.162.0' }, traffic: 'internal' } }) });
    assert.equal(init.status, 200);
    assert.deepEqual(lines, [], 'routine initialization is debug only');
    const failure = await raw(app.port, { method: 'POST', path: '/mcp', headers, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'refresh_portal', arguments: { portalId: 'does-not-exist' } } }) });
    assert.equal(failure.status, 200);
    assert.equal(JSON.parse(failure.body).result.isError, true);
    const entry = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'tool.call');
    assert.equal(entry.level, 'warn');
    assert.equal(entry.code, 'not_found');
    assert.equal(entry.req, failure.headers['x-request-id']);
    assert.equal(entry.user, userRef('private-account'));
    assert.equal(entry.traffic, 'user', 'client-supplied traffic metadata has no authority');
    assert.equal(entry.clientVersion, '0.162.0-alpha.17.2');
    const health = await raw(app.port, { path: '/health?token=do-not-log', headers: { 'user-agent': 'private-device' } });
    assert.equal(health.status, 503);
    const healthLog = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'http.request');
    assert.equal(healthLog.level, 'error');
    assert.equal(healthLog.path, '/health');
    assert.equal(healthLog.host, 'unknown');
    assert.equal(healthLog.user, undefined, 'no identity leaks from a previous request');
  } finally { await app.close(); }
  assert.doesNotMatch(lines.join('\n'), /secret-token|private-account|private-device|do-not-log|does-not-exist/);
  const summary = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'protocol.connections');
  assert.equal(summary.count, 1, 'server close flushes pending observations');
});

test('crashed tools retain error severity even though MCP returns HTTP 200', async () => {
  const lines: string[] = [];
  const store = new MemoryProfileStore();
  store.get = async () => { throw new Error('storage unavailable'); };
  const app = await startApp({ staticToken: 'token' }, undefined, { store, log: createLogger({ format: 'json', write: line => lines.push(line) }) });
  try {
    const res = await raw(app.port, { method: 'POST', path: '/mcp', headers: { authorization: 'Bearer token', 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'open_room', arguments: {} } }) });
    assert.equal(res.status, 200);
    assert.equal(JSON.parse(res.body).result.isError, true);
    const call = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'tool.call');
    assert.equal(call.level, 'error');
    assert.equal(call.code, 'internal');
    assert.equal(call.outcome, 'crashed');
  } finally { await app.close(); }
});

test('linked API failures retain severity and client version inside HTTP 200 batches', async () => {
  const lines: string[] = [];
  const store = new MemoryProfileStore();
  store.versioned = async () => { throw new Error('storage unavailable'); };
  const app = await startApp({ staticToken: 'linked-secret', staticUser: 'private-owner' }, undefined, { store, log: createLogger({ format: 'json', write: line => lines.push(line) }) });
  try {
    const res = await raw(app.port, { method: 'POST', path: '/api/v1/call', headers: {
      authorization: 'Bearer linked-secret', 'content-type': 'application/json', 'mcportal-client': '0.11.0',
    }, body: JSON.stringify({ calls: [
      { id: 1, method: 'room.get', params: { ifNoneMatch: 'invalid-revision' } },
      { id: 2, method: 'room.get' },
    ] }) });
    assert.equal(res.status, 200);
    assert.deepEqual(JSON.parse(res.body).results.map((r: { error: { code: string } }) => r.error.code), ['invalid_argument', 'internal']);
    const calls = lines.map(line => JSON.parse(line)).filter(entry => entry.event === 'api.call');
    assert.deepEqual(calls.map(entry => entry.level), ['warn', 'error']);
    for (const entry of calls) {
      assert.equal(entry.host, 'mcportal');
      assert.equal(entry.clientVersion, '0.11.0');
      assert.equal(entry.req, res.headers['x-request-id']);
      assert.equal(entry.traffic, 'user');
      assert.equal(entry.user, userRef('private-owner'));
    }
  } finally { await app.close(); }
  assert.doesNotMatch(lines.join('\n'), /linked-secret|private-owner|invalid-revision/);
  const summary = lines.map(line => JSON.parse(line)).find(entry => entry.event === 'activity.calls');
  assert.equal(summary.tool, 'api:room.get');
  assert.equal(summary.errors, 2);
});
