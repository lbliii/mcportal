import assert from 'node:assert/strict';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { createLogger, silentLogger } from '../src/lib/log.ts';
import { handleMessage, SUPPORTED_PROTOCOL_VERSIONS } from '../src/mcp.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { ToolContext } from '../src/tools/kit.ts';

function context(lines: string[]): ToolContext {
  return { store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'private-account',
    log: createLogger({ format: 'json', write: (line) => lines.push(line) }) };
}

function observation(line: string | undefined): Record<string, unknown> {
  assert.ok(line);
  const { t: _time, level: _level, ...fields } = JSON.parse(line);
  return fields;
}

test('protocol observation: known versions/host aliases are bounded and legacy replies stay identical', async () => {
  const hosts = [ ['Claude Desktop', 'claude'], ['claude-ai', 'claude'], ['claude-code', 'claude_code'], ['ChatGPT', 'chatgpt'], ['codex-mcp-client', 'codex'] ];
  for (const [name, host] of hosts) for (const version of [...SUPPORTED_PROTOCOL_VERSIONS, '2026-07-28']) {
    const lines: string[] = [];
    const ctx = context(lines);
    const message = { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version, clientInfo: { name, version: 'private-device-version' }, capabilities: {} } };
    const response = await handleMessage(message, ctx);
    assert.deepEqual(response, await handleMessage(message, { ...ctx, log: silentLogger }), 'observation never changes the wire reply');
    assert.deepEqual(observation(lines[0]), { event: 'protocol.initialize', requestedVersion: version,
      selectedVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(version) ? version : '2025-11-25', host });
    assert.equal(lines.length, 1);
    assert.doesNotMatch(lines[0]!, /private-device-version|private-account/);
  }
});

test('protocol observation: unrecognized and malformed client fields never become log content', async () => {
  const secret = 'secret-token@example.com\nspoofed event';
  const inputs = [
    { protocolVersion: secret, clientInfo: { name: secret, version: secret } },
    { protocolVersion: 123, clientInfo: secret },
    { protocolVersion: null, clientInfo: [{ name: 'codex' }] },
    { protocolVersion: {}, clientInfo: { name: { text: secret } } },
    { protocolVersion: 'future-version', clientInfo: { name: 'Claude Desktop ' + secret } },
    { clientInfo: { name: 'codex-' + 'x'.repeat(1000) } },
    {},
  ];
  for (const params of inputs) {
    const lines: string[] = [];
    await handleMessage({ jsonrpc: '2.0', id: 1, method: 'initialize', params }, context(lines));
    assert.deepEqual(observation(lines[0]), { event: 'protocol.initialize', requestedVersion: params.protocolVersion === undefined ? 'missing' : 'other', selectedVersion: '2025-11-25', host: 'unknown' });
    assert.doesNotMatch(lines.join(''), /secret-token|spoofed|future-version|private-account/);
  }
});

test('protocol discovery probes are observed without claiming support or changing method-not-found', async () => {
  for (const meta of [
    { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientInfo': { name: 'ChatGPT', version: 'private-version' } },
    { 'io.modelcontextprotocol/protocolVersion': 'secret-version', 'io.modelcontextprotocol/clientInfo': { name: 'private-machine' } },
    null,
    [],
  ]) {
    const lines: string[] = [];
    const ctx = context(lines);
    const message = { jsonrpc: '2.0', id: 2, method: 'server/discover', params: { _meta: meta } };
    const response = await handleMessage(message, ctx);
    assert.deepEqual(response, await handleMessage(message, { ...ctx, log: silentLogger }));
    assert.deepEqual(response?.error, { code: -32601, message: 'Method not found: server/discover' });
    assert.deepEqual(observation(lines[0]), { event: 'protocol.discovery_probe', requestedVersion: meta && !Array.isArray(meta) ? meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28' ? '2026-07-28' : 'other' : 'missing', host: meta && !Array.isArray(meta) && meta['io.modelcontextprotocol/protocolVersion'] === '2026-07-28' ? 'chatgpt' : 'unknown' });
    assert.doesNotMatch(lines.join(''), /secret-version|private-machine|private-version/);
  }
  const lines: string[] = [];
  const ctx = context(lines);
  await handleMessage({ jsonrpc: '2.0', method: 'server/discover', params: {} }, ctx);
  await handleMessage({ jsonrpc: '2.0', id: 3, method: 'ping' }, ctx);
  assert.deepEqual(lines, [], 'notifications and unrelated requests do not emit observations');
});
