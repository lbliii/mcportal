/**
 * Contracts the rest of the code leans on: every tool declares what it does, arguments
 * are checked against schemas, failures carry stable codes, logs are structured, and a
 * document that can't be read is never mistaken for an empty one.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Accounts, makeBootstrap } from '../src/accounts.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { memoryPersistence, readDocument } from '../src/lib/document.ts';
import { AppError, ERROR_CODES, errorCode, httpStatus, upstreamStatus, userMessage } from '../src/lib/errors.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { createLogger, userRef } from '../src/lib/log.ts';
import { assertPublicUrl } from '../src/lib/safe-fetch.ts';
import { schemaProblem } from '../src/lib/schema.ts';
import { UsageBudget } from '../src/lib/budget.ts';
import { handleMessage } from '../src/mcp.ts';
import { defaultProfile, type Profile } from '../src/profile.ts';
import { MemoryProfileStore, type ProfileStore } from '../src/store.ts';
import { TOOLS } from '../src/tools/index.ts';
import { toolError, toolFailure, type CallToolResult, type ToolContext } from '../src/tools/kit.ts';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { store: new MemoryProfileStore({ u: { ...defaultProfile(), onboarded: true } }), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'u', ...overrides };
}

async function call(c: ToolContext, name: string, args: unknown = {}): Promise<CallToolResult> {
  const res = await handleMessage({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, c);
  return (res as { result: CallToolResult }).result;
}

const errorOf = (r: CallToolResult) => r.structuredContent?.error as { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };

test('tools: every tool declares its access and a sane cost, and its hints agree', () => {
  const names = TOOLS.map((t) => t.name);
  assert.equal(new Set(names).size, names.length, 'tool names are unique');
  for (const tool of TOOLS) {
    assert.ok(['read', 'write', 'fetch'].includes(tool.access), `${tool.name} declares access`);
    assert.equal(tool.inputSchema.type, 'object', `${tool.name} takes an object`);
    const readOnly = (tool.annotations as { readOnlyHint?: boolean } | undefined)?.readOnlyHint === true;
    assert.equal(readOnly, tool.access !== 'write', `${tool.name}: readOnlyHint matches access "${tool.access}"`);
    const cost = typeof tool.cost === 'function' ? tool.cost({}) : (tool.cost ?? 1);
    assert.ok(Number.isInteger(cost) && cost >= 1 && cost <= 20, `${tool.name} costs 1-20 units`);
  }
});

test('schema: arguments are checked before the handler, in words the model can act on', () => {
  const schema = {
    type: 'object',
    required: ['url'],
    additionalProperties: false,
    properties: {
      url: { type: 'string', maxLength: 10 },
      column: { type: 'integer', minimum: 1, maximum: 8 },
      kind: { enum: ['a', 'b'] },
      tags: { type: 'array', maxItems: 2, items: { type: 'string' } },
      anchor: { type: ['object', 'null'], additionalProperties: false, properties: { block: { type: 'integer', minimum: 0 } } },
    },
  };
  assert.equal(schemaProblem(schema, { url: 'x', column: 2, kind: 'a', tags: ['t'], anchor: null }), undefined);
  assert.equal(schemaProblem(schema, {}), 'url is required');
  assert.equal(schemaProblem(schema, { url: 'x', extra: 1 }), "extra isn't a known argument (expected url, column, kind, tags, anchor)");
  assert.equal(schemaProblem(schema, { url: 'x', column: '2' }), 'column must be a whole number');
  assert.equal(schemaProblem(schema, { url: 'x', column: 2.5 }), 'column must be a whole number');
  assert.equal(schemaProblem(schema, { url: 'x', column: 9 }), 'column must be at most 8');
  assert.equal(schemaProblem(schema, { url: 'x'.repeat(11) }), 'url must be at most 10 characters');
  assert.equal(schemaProblem(schema, { url: 'x', kind: 'c' }), 'kind must be one of "a", "b"');
  assert.equal(schemaProblem(schema, { url: 'x', tags: ['a', 'b', 'c'] }), 'tags can have at most 2 entries');
  assert.equal(schemaProblem(schema, { url: 'x', tags: [1] }), 'tags[0] must be a string');
  assert.equal(schemaProblem(schema, { url: 'x', anchor: { block: -1 } }), 'anchor.block must be at least 0');
  assert.equal(schemaProblem(schema, ['url']), 'arguments must be an object');
});

test('dispatcher: bad arguments, refusals and limits come back as coded tool errors', async () => {
  const invalid = await call(ctx(), 'add_portal', { source: 'rss', config: {}, column: '2' });
  assert.equal(invalid.isError, true);
  assert.deepEqual(errorOf(invalid), { code: 'invalid_argument', message: "add_portal wasn't called: column must be a whole number.", retryable: false });

  const denied = await call(ctx({ actor: { accountId: 'u', role: 'user', status: 'suspended' } }), 'get_profile');
  assert.equal(errorOf(denied).code, 'forbidden');

  const budget = new UsageBudget({ perMinute: 1, perDay: 100, globalPerDay: 100 });
  const c = ctx({ budget });
  assert.equal((await call(c, 'get_profile')).isError, undefined);
  const limited = await call(c, 'get_profile');
  assert.equal(errorOf(limited).code, 'rate_limited');
  assert.equal(errorOf(limited).retryable, true);
  assert.equal(errorOf(limited).details?.scope, 'minute');

  const missing = await call(ctx(), 'refresh_portal', { portalId: 'nope' });
  assert.equal(errorOf(missing).code, 'not_found');
  const unavailable = await call(ctx(), 'share', { savedUrl: 'https://example.com/' });
  assert.equal(errorOf(unavailable).code, 'unavailable');
});

test('dispatcher: a bug is logged with its stack and reported by reference, never by its message', async () => {
  const lines: string[] = [];
  const broken: ProfileStore = {
    get: async () => { throw new TypeError('secret internal detail'); },
    put: async () => {},
    delete: async () => {},
  };
  const result = await call(ctx({ store: broken, log: createLogger({ format: 'json', write: (l) => lines.push(l) }) }), 'get_profile');
  const error = errorOf(result);
  assert.equal(error.code, 'internal');
  assert.doesNotMatch(result.content[0]!.text, /secret/);
  assert.match(result.content[0]!.text, new RegExp(`reference ${error.details?.ref}`));
  const crash = lines.map((l) => JSON.parse(l)).find((l) => l.event === 'tool.crashed');
  assert.equal(crash.ref, error.details?.ref);
  assert.equal(crash.tool, 'get_profile');
  assert.match(crash.error, /TypeError: secret internal detail/);
  const done = lines.map((l) => JSON.parse(l)).find((l) => l.event === 'tool.call');
  assert.equal(done.outcome, 'crashed');
  assert.equal(done.user, userRef('u'), 'users appear only as a hash');
  assert.ok(!lines.some((l) => l.includes('"u"')), 'the raw user id is never logged');
});

test('errors: codes map to statuses, failures keep their reason, and only AppErrors are shown', () => {
  for (const [code, { status }] of Object.entries(ERROR_CODES)) assert.ok(status >= 400 && status < 600, code);
  assert.equal(httpStatus('not_found'), 404);
  const upstream = upstreamStatus('Feed', 503);
  assert.equal(upstream.code, 'upstream_error');
  assert.equal(upstream.status, 503);
  assert.equal(upstream.message, 'Feed responded 503');
  assert.throws(() => assertPublicUrl('http://127.0.0.1/'), (e: unknown) => errorCode(e) === 'fetch_blocked');
  assert.equal(userMessage(new AppError('conflict', 'Taken')), 'Taken');
  assert.equal(userMessage(new Error('stack trace soup')), 'Something went wrong on our side.');
  assert.equal(errorCode(new Error('x')), 'internal');

  assert.deepEqual(toolError('Nope', 'not_found').structuredContent, { error: { code: 'not_found', message: 'Nope', retryable: false } });
  assert.equal(toolFailure(new AppError('limit_exceeded', 'Too many.'), 'Not saved: ', '!').content[0]!.text, 'Not saved: Too many!');
  assert.throws(() => toolFailure(new RangeError('bug')), RangeError, 'bugs are rethrown for the dispatcher');
});

test('log: leveled, structured, with child fields; stacks go on their own lines', () => {
  const lines: string[] = [];
  const now = () => new Date('2026-10-01T00:00:00Z');
  const json = createLogger({ format: 'json', level: 'info', write: (l) => lines.push(l), now }).child({ req: 'r1' });
  json.debug('hidden');
  json.info('tool.call', { tool: 'open_room', ms: 4, skipped: undefined });
  assert.deepEqual(lines.map((l) => JSON.parse(l)), [{ t: '2026-10-01T00:00:00.000Z', level: 'info', event: 'tool.call', req: 'r1', tool: 'open_room', ms: 4 }]);

  const text: string[] = [];
  createLogger({ write: (l) => text.push(l) }).warn('source.failed', { source: 'rss', note: 'two words', error: 'Error: x\n    at y' });
  assert.equal(text[0], '[mcportal] warn source.failed source=rss note="two words"\n  error: Error: x\n      at y');
});

test('documents: a failed or corrupt read is never mistaken for an empty document', async () => {
  const silent = createLogger({ write: () => {} });
  assert.deepEqual(await readDocument(memoryPersistence(), 'x', silent), {});
  await assert.rejects(readDocument(memoryPersistence('{not json'), 'x', silent), (e: unknown) => errorCode(e) === 'internal');
  await assert.rejects(readDocument(memoryPersistence('[1]'), 'x', silent), /not an object/);

  // Accounts: a read that fails during a write must not replace everyone with the one change.
  const stored = memoryPersistence();
  const accounts = new Accounts(stored, makeBootstrap([], []));
  await accounts.load();
  await accounts.invite('alice', 'test');
  const before = await stored.read();
  let failing = false;
  const flaky = { read: async () => { if (failing) throw new Error('connection reset'); return stored.read(); }, write: (json: string) => stored.write(json) };
  const again = new Accounts(flaky, makeBootstrap([], []));
  await again.load();
  failing = true;
  await assert.rejects(again.invite('bob', 'test'), /connection reset/);
  assert.equal(await stored.read(), before, 'the stored document is untouched');
});

test('layout: withLayout keeps saved items exactly, whatever validation does to the rest', async () => {
  const { withLayout } = await import('../src/layout.ts');
  const saved = [{ url: 'https://example.com/', title: 'Example', savedAt: '2026-01-01T00:00:00.000Z' }];
  const profile: Profile = { ...defaultProfile(), saved };
  const next = withLayout(profile, { layout: 'shelves' });
  assert.equal(next.layout, 'shelves');
  assert.equal(next.saved, saved, 'the same array, untouched');
});

test('page sessions: cookie carries an opaque token, sessions expire, CSRF is per session', async () => {
  const { PageSessions } = await import('../src/page-sessions.ts');
  let now = 0;
  const sessions = new PageSessions('account', { publicUrl: 'https://mcportal.example', ttlMs: 1000, max: 2, now: () => now });
  const setCookie = sessions.start('acct-1', 'alice');
  assert.match(setCookie, /^__Host-mcportal_account=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=1; Secure$/);
  const req = { headers: { cookie: setCookie.split(';')[0] } } as never;
  const current = sessions.current(req)!;
  assert.equal(current.session.accountId, 'acct-1');
  assert.equal(sessions.csrfMatches(current.session, current.session.csrf), true);
  assert.equal(sessions.csrfMatches(current.session, ''), false);
  assert.equal(sessions.csrfMatches(current.session, null), false);
  sessions.endAll('acct-1');
  assert.equal(sessions.current(req), undefined, 'signed out everywhere');
  const again = { headers: { cookie: sessions.start('acct-1', 'alice').split(';')[0] } } as never;
  now = 1000;
  assert.equal(sessions.current(again), undefined, 'expired');
});
