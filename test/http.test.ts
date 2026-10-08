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

test('an oversized /mcp body is refused and its connection closed, so the next request on it is not misread', async () => {
  const app = await startApp({ allowUnauthenticated: true });
  try {
    const big = await raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json', 'content-length': String(2_000_000) } });
    assert.equal(big.status, 413);
    assert.equal(big.headers.connection, 'close');
    assert.equal((await raw(app.port, { method: 'POST', path: '/mcp', headers: { 'content-type': 'application/json' }, body: RPC_PING })).status, 200);
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

test('public pages: landing, privacy and support render without scripts; images and brand files only from the allowlist', async () => {
  const app = await startApp({ staticToken: 't', site: { supportUrl: 'mailto:help@example.com', operator: 'A <b>Person</b>' } });
  try {
    for (const path of ['/', '/privacy', '/terms', '/support', '/security']) {
      const page = await raw(app.port, { path });
      assert.equal(page.status, 200, path);
      assert.match(page.headers['content-type'] as string, /text\/html/);
      assert.match(page.headers['content-security-policy'] as string, /default-src 'none'/);
      assert.match(page.headers['content-security-policy'] as string, /font-src 'self'/, 'headings load Jost from this server');
      assert.doesNotMatch(page.body, /<script/i, `${path} has no scripts`);
      assert.match(page.body, /A &lt;b&gt;Person&lt;\/b&gt;/, 'operator is escaped');
    }
    assert.match((await raw(app.port, { path: '/support' })).body, /mailto:help@example\.com/);
    assert.match((await raw(app.port, { path: '/' })).body, /<a href="\/terms">Terms<\/a>/, 'every page links the terms');
    for (const path of ['/', '/support']) assert.doesNotMatch((await raw(app.port, { path })).body, /github\.com\/lbliii\/mcportal(?!\/issues)/, `${path}: no links to a repo the public can't open`);
    const terms = (await raw(app.port, { path: '/terms' })).body;
    assert.match(terms, /<h2>Acceptable use<\/h2>/);
    assert.match(terms, /at least 13/);
    assert.match(terms, /run by A &lt;b&gt;Person&lt;\/b&gt;/);
    assert.match((await raw(app.port, { path: '/' })).body, /http:\/\/localhost\/mcp/);
    assert.equal((await raw(app.port, { path: '/site/chat-room.png' })).status, 200);
    const landing = (await raw(app.port, { path: '/' })).body;
    assert.match(landing, /<h1 data-text="Your liminal webspace\.">Your liminal <span>webspace\.<\/span><\/h1>/);
    assert.match(landing, /<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" class="art"[^>]* aria-hidden="true" focusable="false">/, 'the hero art is inlined and decorative');
    assert.match(landing, /content:attr\(data-text\)\/""/, "the headline's keyline plate is hidden from screen readers");
    assert.match(landing, /@media \(prefers-reduced-motion:no-preference\)\{/, 'the page only moves for people who want motion');
    assert.doesNotMatch(landing, /<script/, 'the landing page runs no scripts');
    assert.doesNotMatch(landing, /https:\/\/fonts\.|@import|url\(http/, 'fonts come from this server, not a CDN');
    assert.match(landing, /src:url\(\/site\/jost-bold\.ttf\)/);
    assert.match(landing, /<meta property="og:image" content="http:\/\/localhost\/site\/og\.png">/, 'link previews get an absolute image URL');
    assert.match(landing, /<link rel="icon" href="\/favicon\.svg" type="image\/svg\+xml">/);
    for (const path of ['/', '/privacy', '/terms', '/support', '/security']) {
      assert.doesNotMatch((await raw(app.port, { path })).body, /inside Claude|[Aa]sk Claude|tell Claude/, `${path} talks about "your agent", not one host`);
    }
    const types: Record<string, RegExp> = {
      '/favicon.ico': /^image\/x-icon$/, '/favicon.svg': /^image\/svg\+xml$/, '/apple-touch-icon.png': /^image\/png$/,
      '/site/og.png': /^image\/png$/, '/site/icon-512.png': /^image\/png$/, '/site/lockup-on-dark.svg': /^image\/svg\+xml$/,
      '/site/jost-bold.ttf': /^font\/ttf$/,
      '/site/launch.mp4': /^video\/mp4$/, '/site/launch.jpg': /^image\/jpeg$/,
    };
    for (const [path, type] of Object.entries(types)) {
      const file = await raw(app.port, { path });
      assert.equal(file.status, 200, path);
      assert.match(file.headers['content-type'] as string, type, path);
      assert.match(file.headers['content-security-policy'] as string, /default-src 'none'/, `${path} can't run anything`);
    }
    assert.ok((await raw(app.port, { path: '/favicon.ico' })).body.startsWith('\0\0\u0001\0'), 'an ICO header');
    assert.match(landing, /<video src="\/site\/launch\.mp4" poster="\/site\/launch\.jpg" controls playsinline preload="none"/, 'the launch video waits to be played');
    assert.doesNotMatch(landing, /autoplay/);
    const video = await raw(app.port, { path: '/site/launch.mp4' });
    assert.match(video.headers['content-security-policy'] as string, /media-src 'self'/);
    assert.equal(video.headers['accept-ranges'], 'bytes');
    const size = Number(video.headers['content-length']);
    const head = await raw(app.port, { path: '/site/launch.mp4', headers: { range: 'bytes=0-7' } });
    assert.equal(head.status, 206, 'Safari plays video only from ranges');
    assert.equal(head.headers['content-range'], `bytes 0-7/${size}`);
    assert.equal(head.headers['content-length'], '8');
    assert.match(head.body, /ftyp/, 'an MP4 starts with its ftyp box');
    assert.equal((await raw(app.port, { path: '/site/launch.mp4', headers: { range: 'bytes=-4' } })).headers['content-range'], `bytes ${size - 4}-${size - 1}/${size}`);
    assert.equal((await raw(app.port, { path: '/site/launch.mp4', headers: { range: `bytes=${size}-` } })).status, 416);
    assert.equal((await raw(app.port, { path: '/site/launch.mp4', headers: { range: 'items=0-1' } })).status, 200, 'unknown range units get the whole file');
    assert.equal((await raw(app.port, { path: '/site/favicon.svg' })).status, 404, 'each file has exactly one URL');
    assert.equal((await raw(app.port, { path: '/site/toString' })).status, 404);
    assert.equal((await raw(app.port, { path: '/site/..%2Fhttp.ts' })).status, 404);
    assert.equal((await raw(app.port, { path: '/site/other.png' })).status, 404);
    assert.equal((await raw(app.port, { method: 'POST', path: '/privacy' })).status, 404);
  } finally {
    await app.close();
  }
});

test('agent installation guides are public, use the configured instance and retain host and route boundaries', async () => {
  for (const invited of [false, true]) {
    const app = await startApp({
      publicUrl: 'https://reader.example',
      staticToken: 'private-test-token',
      github: { clientId: 'fixture', clientSecret: 'private-test-github-secret' },
      allowedGithubUsers: invited ? ['invited-reader'] : [],
    });
    try {
      const guide = await raw(app.port, { path: '/install.md' });
      assert.equal(guide.status, 200);
      assert.match(guide.headers['content-type'] as string, /^text\/markdown; charset=utf-8$/);
      assert.match(guide.body, /codex mcp add mcportal --url https:\/\/reader\.example\/mcp/);
      assert.match(guide.body, /claude mcp add --transport http mcportal --scope user https:\/\/reader\.example\/mcp/);
      assert.match(guide.body, invited ? /This instance is invite-only/ : /Anyone with a GitHub account can sign in/);
      const index = await raw(app.port, { path: '/llms.txt' });
      assert.equal(index.status, 200);
      assert.match(index.headers['content-type'] as string, /^text\/plain; charset=utf-8$/);
      assert.match(index.body, /\[Installation guide\]\(https:\/\/reader\.example\/install\.md\)/);
      for (const response of [guide, index]) {
        assert.equal(response.headers['x-content-type-options'], 'nosniff');
        assert.doesNotMatch(response.body, /mcportal\.lol|private-test-token|private-test-github-secret/);
      }
      assert.equal((await raw(app.port, { method: 'POST', path: '/mcp', headers: json, body: RPC_PING })).status, 401, 'public setup does not bypass MCP authentication');
      assert.equal((await raw(app.port, { path: '/install.md', headers: { host: 'untrusted.example' } })).status, 421);
      for (const route of ['/install.md/private', '/llms.txt/private', '/docs/how-to/install.md', '/installation.ts']) {
        assert.equal((await raw(app.port, { path: route })).status, 404, 'only the two exact public routes are exposed');
      }
      assert.equal((await raw(app.port, { method: 'POST', path: '/install.md' })).status, 404);
    } finally { await app.close(); }
  }
});

test('contact: one address for support and security, security.txt, and the law in the terms', async () => {
  assert.throws(() => configFromEnv({ MCPORTAL_CONTACT_EMAIL: 'not an email' }, '/tmp/x'), /isn't an email address/);
  const site = configFromEnv({ MCPORTAL_CONTACT_EMAIL: 'hello@mcportal.example', MCPORTAL_JURISDICTION: 'the State of Oregon, USA', MCPORTAL_OPERATOR: 'Jane Doe', MCPORTAL_SOURCE_URL: 'https://github.com/example/mcportal' }, '/tmp/x').site!;
  assert.equal(site.supportUrl, 'mailto:hello@mcportal.example', 'support defaults to the contact address');
  const app = await startApp({ staticToken: 't', site });
  try {
    const txt = await raw(app.port, { path: '/.well-known/security.txt' });
    assert.equal(txt.status, 200);
    assert.match(txt.headers['content-type'] as string, /^text\/plain/);
    assert.match(txt.body, /^Contact: mailto:hello@mcportal\.example$/m);
    const expires = Date.parse(/^Expires: (.+)$/m.exec(txt.body)![1]!);
    assert.ok(expires > Date.now() && expires < Date.now() + 365 * 86_400_000, 'RFC 9116: expires within a year');
    assert.match(txt.body, /^Canonical: http:\/\/localhost\/\.well-known\/security\.txt$/m);
    assert.match(txt.body, /^Policy: http:\/\/localhost\/security$/m);
    const security = (await raw(app.port, { path: '/security' })).body;
    assert.match(security, /mailto:hello@mcportal\.example/);
    assert.match(security, /within 3 business days/);
    assert.match((await raw(app.port, { path: '/terms' })).body, /governed by the laws of the State of Oregon, USA/);
    assert.doesNotMatch((await raw(app.port, { path: '/support' })).body, /invite-only/, 'open sign-up: no invite-only answer');
    assert.match((await raw(app.port, { path: '/' })).body, /<a href="https:\/\/github\.com\/example\/mcportal">Source<\/a>/, 'with MCPORTAL_SOURCE_URL, the footer links the source');
    assert.match((await raw(app.port, { path: '/support' })).body, /github\.com\/example\/mcportal#readme/);
  } finally {
    await app.close();
  }
});

test('/health checks storage: 503 when it fails, answered from a short cache', async () => {
  let down = false;
  let checks = 0;
  const checkStorage = async () => { checks++; if (down) throw new Error('connection refused'); };
  let now = 0;
  const app = await startApp({ allowUnauthenticated: true }, undefined, { checkStorage, now: () => now });
  try {
    const ok = await raw(app.port, { path: '/health' });
    assert.equal(ok.status, 200);
    assert.deepEqual(JSON.parse(ok.body).checks, { storage: 'ok' });
    down = true;
    assert.equal((await raw(app.port, { path: '/health' })).status, 200, 'cached for a few seconds');
    assert.equal(checks, 1);
    now = 5_000;
    const failing = await raw(app.port, { path: '/health' });
    assert.equal(failing.status, 503);
    assert.equal(JSON.parse(failing.body).ok, false);
    assert.ok(failing.headers['x-request-id'], 'every response carries a request id');
  } finally {
    await app.close();
  }
});
