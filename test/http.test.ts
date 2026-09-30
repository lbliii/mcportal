import assert from 'node:assert/strict';
import { connect } from 'node:net';
import { test } from 'node:test';
import { configFromEnv, MAX_BATCH } from '../src/http.ts';
import { raw, RPC_PING, startApp } from './helpers.ts';

const json = { 'content-type': 'application/json' };

test('a malformed request line cannot crash the server', async () => {
  const app = await startApp({ allowUnauthenticated: true });
  try {
    for (const line of ['GET //[ HTTP/1.1\r\nHost: localhost\r\n\r\n', 'GET / HTTP/1.1\r\nHost: [\r\n\r\n', 'GARBAGE\r\n\r\n']) {
      await new Promise<void>((resolve) => {
        const s = connect(app.port, '127.0.0.1', () => s.end(line));
        s.on('data', () => {});
        s.on('close', () => resolve());
        s.on('error', () => resolve());
      });
    }
    const health = await raw(app.port, { path: '/health' });
    assert.equal(health.status, 200, 'still alive');
  } finally {
    await app.close();
  }
});

test('Host allowlist blocks DNS rebinding; /health is exempt for platform checks', async () => {
  const app = await startApp({ allowUnauthenticated: true });
  try {
    const rebinding = await raw(app.port, { method: 'POST', path: '/mcp', headers: { ...json, host: 'attacker.example:8799', origin: 'http://attacker.example:8799' }, body: RPC_PING });
    assert.equal(rebinding.status, 421);
    const health = await raw(app.port, { path: '/health', headers: { host: 'healthcheck.railway.app' } });
    assert.equal(health.status, 200);
    const crossOrigin = await raw(app.port, { method: 'POST', path: '/mcp', headers: { ...json, origin: 'https://evil.example' }, body: RPC_PING });
    assert.equal(crossOrigin.status, 403);
    const ok = await raw(app.port, { method: 'POST', path: '/mcp', headers: json, body: RPC_PING });
    assert.equal(ok.status, 200);
  } finally {
    await app.close();
  }
});

test('static token: required, constant-time compared, header only on /mcp', async () => {
  const app = await startApp({ staticToken: 's3cret-token' });
  try {
    assert.equal((await raw(app.port, { method: 'POST', path: '/mcp', headers: json, body: RPC_PING })).status, 401);
    assert.equal((await raw(app.port, { method: 'POST', path: '/mcp?token=s3cret-token', headers: json, body: RPC_PING })).status, 401, 'no query-string tokens on /mcp');
    assert.equal((await raw(app.port, { method: 'POST', path: '/mcp', headers: { ...json, authorization: 'Bearer wrong' }, body: RPC_PING })).status, 401);
    const good = await raw(app.port, { method: 'POST', path: '/mcp', headers: { ...json, authorization: 'Bearer s3cret-token' }, body: RPC_PING });
    assert.equal(good.status, 200);
    assert.equal(JSON.parse(good.body).result && true, true);
  } finally {
    await app.close();
  }
});

test('/preview: reflects nothing, embeds no secrets, sends a CSP', async () => {
  const open = await startApp({ allowUnauthenticated: true });
  try {
    const attack = await raw(open.port, { path: `/preview?token=${encodeURIComponent('</script><script>alert(1)</script>')}` });
    assert.equal(attack.status, 200);
    assert.ok(!attack.body.includes('alert(1)'), 'query string is never reflected');
    assert.match(attack.body, /__MCPORTAL_DEV__=\{"needsToken":false\}/);
    assert.match(String(attack.headers['content-security-policy']), /connect-src 'self'/);
  } finally {
    await open.close();
  }
  const locked = await startApp({ staticToken: 'tok-secret' });
  try {
    const page = await raw(locked.port, { path: '/preview?token=tok-secret' });
    assert.equal(page.status, 200);
    assert.ok(!page.body.includes('tok-secret'), 'token never embedded');
    assert.match(page.body, /"needsToken":true/);
  } finally {
    await locked.close();
  }
  const oauthOnly = await startApp({ github: { clientId: 'a', clientSecret: 'b' } });
  try {
    assert.equal((await raw(oauthOnly.port, { path: '/preview' })).status, 404);
  } finally {
    await oauthOnly.close();
  }
});

test('a stalled gzip response times out instead of hanging', async () => {
  const { createServer, get } = await import('node:http');
  const { gzipSync } = await import('node:zlib');
  const { readResponse } = await import('../src/lib/safe-fetch.ts');
  const partial = gzipSync(Buffer.from('x'.repeat(10_000))).subarray(0, 20);
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-encoding': 'gzip' });
    res.write(partial); // ...and never finish
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const started = Date.now();
  try {
    await assert.rejects(
      new Promise((resolve, reject) => {
        const req = get({ host: '127.0.0.1', port, signal: AbortSignal.timeout(300) }, (res) => readResponse(res, 1_000_000).then(resolve, reject));
        req.on('error', reject);
      }),
    );
    assert.ok(Date.now() - started < 3000, `took ${Date.now() - started}ms`);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test('batches are capped and notifications return 202', async () => {
  const app = await startApp({ allowUnauthenticated: true });
  try {
    const big = JSON.stringify(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })));
    const res = await raw(app.port, { method: 'POST', path: '/mcp', headers: json, body: big });
    assert.match(JSON.parse(res.body).error.message, /Batch must have/);
    const note = await raw(app.port, { method: 'POST', path: '/mcp', headers: json, body: '{"jsonrpc":"2.0","method":"notifications/initialized"}' });
    assert.equal(note.status, 202);
    assert.equal((await raw(app.port, { path: '/mcp' })).status, 405);
  } finally {
    await app.close();
  }
});

test('config: loopback by default; refuses a public bind without auth', () => {
  const local = configFromEnv({}, '/tmp/x');
  assert.equal(local.host, '127.0.0.1');
  assert.equal(local.allowUnauthenticated, true);
  assert.throws(() => configFromEnv({ HOST: '0.0.0.0' }, '/tmp/x'), /Refusing to listen/);
  const railway = configFromEnv({ HOST: '0.0.0.0', RAILWAY_PUBLIC_DOMAIN: 'mcportal.up.railway.app', GITHUB_CLIENT_ID: 'id', GITHUB_CLIENT_SECRET: 's' }, '/tmp/x');
  assert.equal(railway.publicUrl, 'https://mcportal.up.railway.app');
  assert.ok(railway.allowedHosts.includes('mcportal.up.railway.app'));
  assert.equal(railway.allowUnauthenticated, false);
  const token = configFromEnv({ MCPORTAL_TOKEN: 't' }, '/tmp/x');
  assert.equal(token.allowUnauthenticated, false, 'a token means auth is required even on loopback');
});
