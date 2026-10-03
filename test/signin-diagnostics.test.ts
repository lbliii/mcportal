import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { AppError } from '../src/lib/errors.ts';
import { createLogger } from '../src/lib/log.ts';
import { LinkFile, type LinkRecord } from '../src/link/link-file.ts';
import { startSignIn } from '../src/link/signin.ts';

const SECRET = 'must-never-appear-in-diagnostic-logs';
const cases = [
  { name: 'unreachable discovery', stage: 'discovery', message: /reading sign-in settings.*Check the connection/ },
  { name: 'discovery timeout', stage: 'discovery', message: /took too long.*reading sign-in settings/ },
  { name: 'invalid discovery JSON', stage: 'discovery', message: /unreadable response.*reading sign-in settings/ },
  { name: 'registration rate limit', stage: 'registration', message: /registering this computer.*HTTP 429.*Wait a minute/ },
  { name: 'missing callback code', stage: 'authorization', message: /without an authorization code/ },
  { name: 'expired token code', stage: 'token', message: /HTTP 400.*Authorization code is invalid or expired/ },
  { name: 'invalid token JSON', stage: 'token', message: /unreadable response.*finishing this computer/ },
  { name: 'invalid account identity', stage: 'account', message: /unreadable account identity/ },
  { name: 'saving failed', stage: 'save', message: /data folder is writable and has free disk space/ },
  { name: 'browser deadline', stage: 'authorization', message: /link expired.*fresh link/ },
] as const;

for (const scenario of cases) {
  test(`sign-in diagnostics: ${scenario.name} identifies the step and keeps secrets out of logs`, async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-signin-diagnostics-'));
    const lines: string[] = [];
    const log = createLogger({ format: 'json', write: (line) => lines.push(line) });
    class TestLink extends LinkFile {
      override write(record: LinkRecord): Promise<void> {
        if (scenario.name === 'saving failed') return Promise.reject(new Error(SECRET));
        return super.write(record);
      }
    }
    const link = new TestLink(dir);
    const fetcher: typeof fetch = async (input) => {
      const route = new URL(String(input)).pathname;
      if (route.startsWith('/.well-known')) {
        if (scenario.name === 'unreachable discovery') throw new TypeError(SECRET);
        if (scenario.name === 'discovery timeout') throw new DOMException(SECRET, 'TimeoutError');
        if (scenario.name === 'invalid discovery JSON') return new Response('not JSON');
        return Response.json({ resource: 'https://portal.example/mcp' });
      }
      if (route === '/oauth/register') return scenario.name === 'registration rate limit'
        ? Response.json({ error: 'slow_down' }, { status: 429 }) : Response.json({ client_id: 'fixture-client' });
      if (route === '/oauth/token') {
        if (scenario.name === 'expired token code') return Response.json({ error: 'invalid_grant', error_description: 'Authorization code is invalid or expired' }, { status: 400 });
        if (scenario.name === 'invalid token JSON') return new Response('not JSON');
        return Response.json({ access_token: SECRET, refresh_token: SECRET });
      }
      return Response.json({ results: [{ id: 0, result: scenario.name === 'invalid account identity' ? null : { accountId: 'github-42', login: 'fixture' } }] });
    };
    let browserState = '';
    const failure = (error: unknown) => {
      assert.ok(error instanceof AppError);
      assert.match(error.message, scenario.message);
      assert.equal(error.details?.stage, scenario.stage);
      assert.match(String(error.details?.reference), /^[0-9a-f]{12}$/);
      assert.ok(error.message.includes(String(error.details!.reference)));
      return true;
    };
    try {
      if (['discovery', 'registration'].includes(scenario.stage)) {
        await assert.rejects(startSignIn({ server: 'https://portal.example', link, fetch: fetcher, log }), failure);
      } else {
        const pending = await startSignIn({ server: 'https://portal.example', link, fetch: fetcher, log, timeoutMs: scenario.name === 'browser deadline' ? 25 : 60_000 });
        const authorize = new URL(pending.url);
        browserState = authorize.searchParams.get('state')!;
        if (scenario.name !== 'browser deadline') {
          const callback = new URL(authorize.searchParams.get('redirect_uri')!);
          callback.search = new URLSearchParams({ state: browserState, ...(scenario.name !== 'missing callback code' ? { code: SECRET } : {}) }).toString();
          const response = await fetch(callback);
          assert.equal(response.status, 400);
          assert.match(await response.text(), scenario.message);
        }
        await assert.rejects(pending.done, failure);
      }
      assert.equal(await link.read(), undefined, 'a failed sign-in does not save credentials');
      const event = lines.map((line) => JSON.parse(line)).find((e) => e.event === 'signin.failed');
      assert.equal(event.stage, scenario.stage);
      assert.match(event.reference, /^[0-9a-f]{12}$/);
      assert.ok(!lines.join('\n').includes(SECRET));
      assert.ok(!browserState || !lines.join('\n').includes(browserState));
      assert.ok(!lines.join('\n').includes(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
}

test('sign-in diagnostics: a failed initial import preserves sign-in and explains that local data remains', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-signin-import-'));
  const lines: string[] = [];
  const link = new LinkFile(dir);
  const fetcher: typeof fetch = async (input) => {
    const route = new URL(String(input)).pathname;
    return Response.json(route.startsWith('/.well-known') ? { resource: 'https://portal.example/mcp' } : route === '/oauth/register' ? { client_id: 'fixture-client' } : route === '/oauth/token' ? { access_token: SECRET, refresh_token: SECRET } : { results: [{ id: 0, result: { accountId: 'github-42', login: 'fixture' } }] });
  };
  try {
    const pending = await startSignIn({ server: 'https://portal.example', link, fetch: fetcher, log: createLogger({ format: 'json', write: (line) => lines.push(line) }), onLinked: async () => { throw new Error(SECRET); } });
    const authorize = new URL(pending.url);
    const callback = new URL(authorize.searchParams.get('redirect_uri')!);
    callback.search = new URLSearchParams({ state: authorize.searchParams.get('state')!, code: SECRET }).toString();
    const response = await fetch(callback);
    assert.equal(response.status, 200);
    const page = await response.text();
    assert.match(page, /This computer is signed in/);
    assert.match(page, /local data is still here.*retry the import/);
    assert.equal((await pending.done).accountId, 'github-42');
    assert.ok(await link.read());
    assert.equal(JSON.parse(lines[0]!).stage, 'sync');
    assert.ok(!lines.join('\n').includes(SECRET));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
