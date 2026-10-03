import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkService } from '../scripts/ops-check.ts';

const env = { MCPORTAL_URL: 'https://portal.example/mcp', MCPORTAL_TOKEN: 'secret-monitor-token' };
function fixture(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}
const health = { ok: true, storage: 'postgres', checks: { storage: 'ok' } };
const init = { jsonrpc: '2.0', id: 1, result: { serverInfo: { version: '0.7.0' } } };
const listing = { jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'open_room' }] } };

test('monitor checks storage and authenticated discovery without fetching feeds', async () => {
  const calls: string[] = [];
  const result = await checkService(env, async (url, options) => {
    assert.equal(options?.redirect, 'error');
    assert.ok(options?.signal);
    const headers = new Headers(options?.headers);
    if (String(url).endsWith('/health')) {
      assert.equal(headers.has('authorization'), false);
      calls.push('health');
      return fixture(health);
    }
    assert.equal(headers.get('authorization'), `Bearer ${env.MCPORTAL_TOKEN}`);
    const message = JSON.parse(String(options?.body)) as { method: string };
    calls.push(message.method);
    return fixture(message.method === 'initialize' ? init : listing);
  });
  assert.deepEqual(calls, ['health', 'initialize', 'tools/list']);
  assert.deepEqual(result, { ok: true, stage: 'tools/list', version: '0.7.0', storage: 'postgres', toolCount: 1 });
});

test('monitor refuses unsafe or ambiguous origins before sending credentials', async () => {
  for (const url of ['http://portal.example/mcp', 'https://user:pass@portal.example/mcp', 'https://portal.example/mcp?token=secret', 'https://portal.example/other', 'https://portal.example/mcp#secret']) {
    assert.equal((await checkService({ ...env, MCPORTAL_URL: url }, async () => { throw new Error('must not fetch'); })).code, 'invalid_url');
  }
  assert.equal((await checkService({ MCPORTAL_URL: env.MCPORTAL_URL })).code, 'missing_or_invalid_token');
});

test('monitor detects storage failures before MCP and never reports raw provider errors', async () => {
  assert.deepEqual(await checkService(env, async () => fixture({ ...health, ok: false })), { ok: false, stage: 'health', code: 'storage_unhealthy' });
  const failed = await checkService(env, async (url) => String(url).endsWith('/health') ? fixture(health) : fixture({ secret: env.MCPORTAL_TOKEN }, 401));
  assert.deepEqual(failed, { ok: false, stage: 'initialize', code: 'http_error', httpStatus: 401 });
  assert.ok(!JSON.stringify(failed).includes(env.MCPORTAL_TOKEN));
});

test('monitor rejects JSON-RPC errors, wrong IDs and missing room tool', async () => {
  for (const value of [ { ...listing, id: 3 }, { ...listing, result: { tools: [] } }, { jsonrpc: '2.0', id: 2, error: { message: env.MCPORTAL_TOKEN } } ]) {
    const result = await checkService(env, async (url, options) => String(url).endsWith('/health') ? fixture(health) : JSON.parse(String(options?.body)).method === 'initialize' ? fixture(init) : fixture(value));
    assert.deepEqual(result, { ok: false, stage: 'tools/list', code: 'invalid_rpc_response' });
  }
});

test('monitor caps response bodies and sanitizes network failures', async () => {
  const large = await checkService(env, async () => new Response('x'.repeat(524289)));
  assert.equal(large.ok, false);
  const result = await checkService(env, async () => { throw new Error(env.MCPORTAL_TOKEN); });
  assert.deepEqual(result, { ok: false, stage: 'health', code: 'request_or_response_failed' });
});
