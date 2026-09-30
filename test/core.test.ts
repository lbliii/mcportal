import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { assertPublicUrl, isPrivateAddress } from '../src/lib/safe-fetch.ts';
import { handleMessage, MCP_APP_MIME } from '../src/mcp.ts';
import { defaultProfile, ProfileError, validateProfile } from '../src/profile.ts';
import { FileProfileStore, MemoryProfileStore } from '../src/store.ts';
import { WORKSPACE_URI, type ToolContext } from '../src/tools.ts';

function ctx(overrides: Partial<ToolContext> = {}): ToolContext {
  return { store: new MemoryProfileStore(), fetcher: createFixtureFetcher(), cache: new TtlCache(), userId: 'test', ...overrides };
}

async function rpc(c: ToolContext, method: string, params: Record<string, unknown> = {}, id = 1) {
  const res = await handleMessage({ jsonrpc: '2.0', id, method, params }, c);
  assert.ok(res, 'expected a response');
  return res!;
}

async function call(c: ToolContext, name: string, args: Record<string, unknown> = {}) {
  const res = await rpc(c, 'tools/call', { name, arguments: args });
  return res.result as { content: Array<{ text: string }>; structuredContent?: any; isError?: boolean };
}

// ---------------------------------------------------------------- protocol

test('initialize negotiates version and advertises the MCP Apps extension', async () => {
  const res = await rpc(ctx(), 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  const result = res.result as any;
  assert.equal(result.protocolVersion, '2025-06-18');
  assert.equal(result.serverInfo.name, 'mcportal');
  assert.deepEqual(result.capabilities.extensions['io.modelcontextprotocol/ui'].mimeTypes, [MCP_APP_MIME]);
  const unknown = await rpc(ctx(), 'initialize', { protocolVersion: '1999-01-01' });
  assert.equal((unknown.result as any).protocolVersion, '2025-11-25');
});

test('notifications get no response; unknown methods get -32601', async () => {
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ctx()), null);
  const res = await rpc(ctx(), 'does/not/exist');
  assert.equal(res.error?.code, -32601);
  const bad = await handleMessage({ hello: 'world' }, ctx());
  assert.equal(bad?.error?.code, -32600);
});

test('tools/list links open_workspace to the UI and hides app-only tools from the model', async () => {
  const res = await rpc(ctx(), 'tools/list');
  const tools = (res.result as any).tools as any[];
  const names = tools.map((t) => t.name);
  assert.deepEqual(names, ['open_workspace', 'get_profile', 'update_profile', 'read_source', 'refresh_panel', 'read_article', 'list_sources']);
  assert.equal(tools.find((t) => t.name === 'open_workspace')._meta.ui.resourceUri, WORKSPACE_URI);
  assert.deepEqual(tools.find((t) => t.name === 'refresh_panel')._meta.ui.visibility, ['app']);
  assert.ok(tools.every((t) => t.handler === undefined && t.inputSchema.type === 'object'));
});

test('resources/read serves the self-contained workspace app', async () => {
  const list = await rpc(ctx(), 'resources/list');
  assert.equal((list.result as any).resources[0].mimeType, MCP_APP_MIME);
  const read = await rpc(ctx(), 'resources/read', { uri: WORKSPACE_URI });
  const content = (read.result as any).contents[0];
  assert.equal(content.mimeType, MCP_APP_MIME);
  assert.match(content.text, /<title>MCPortal<\/title>/);
  assert.ok(!/<script[^>]+src=/.test(content.text), 'no external scripts');
  assert.ok(!content.text.includes('__MCPORTAL_DEV__='), 'dev bootstrap only in /preview');
  assert.ok(!/innerHTML/.test(content.text), 'UI never renders remote data as HTML');
  const missing = await rpc(ctx(), 'resources/read', { uri: 'ui://nope' });
  assert.equal(missing.error?.code, -32602);
});

// ---------------------------------------------------------------- tools

test('open_workspace hydrates every panel of the default profile', async () => {
  const result = await call(ctx(), 'open_workspace');
  assert.equal(result.isError, undefined);
  const { profile, panels } = result.structuredContent;
  assert.equal(profile.name, 'morning');
  assert.deepEqual(panels.map((p: any) => p.panelId), ['hn-top', 'gh-mcp', 'simonw']);
  assert.ok(panels.every((p: any) => !p.error && p.items.length > 0));
  assert.equal(panels[2].title, "Simon Willison's Weblog");
  assert.match(result.content[0]!.text, /untrusted data/);
  assert.match(result.content[0]!.text, /Pirating the Pirates/);
});

test('open_workspace caches within the freshness window', async () => {
  const calls: string[] = [];
  const c = ctx({ fetcher: createFixtureFetcher(calls) });
  await call(c, 'open_workspace');
  const first = calls.length;
  const again = await call(c, 'open_workspace');
  assert.equal(calls.length, first, 'no new upstream fetches');
  assert.ok(again.structuredContent.panels.every((p: any) => p.provenance.cached));
  const refreshed = await call(c, 'refresh_panel', { panelId: 'hn-top' });
  assert.equal(refreshed.structuredContent.panel.provenance.cached, false);
  assert.ok(calls.length > first);
});

test('a failing source degrades to an error panel, not a failed workspace', async () => {
  const store = new MemoryProfileStore();
  const profile = defaultProfile();
  profile.columns.push({ width: 1, panels: [{ id: 'broken', source: 'rss', config: { url: 'https://nowhere.example.org/feed', limit: 5 } }] });
  await store.put('test', validateProfile(profile));
  const result = await call(ctx({ store }), 'open_workspace');
  const broken = result.structuredContent.panels.find((p: any) => p.panelId === 'broken');
  assert.match(broken.error, /404/);
  assert.equal(result.structuredContent.panels.filter((p: any) => !p.error).length, 3);
});

test('update_profile saves a rearranged layout and rejects invalid ones without saving', async () => {
  const c = ctx();
  const { structuredContent } = await call(c, 'get_profile');
  const profile = structuredContent.profile;
  // "Put GitHub on the left"
  profile.columns = [profile.columns[1], profile.columns[0], profile.columns[2]];
  const saved = await call(c, 'update_profile', { profile });
  assert.equal(saved.isError, undefined);
  assert.match(saved.content[0]!.text, /After: column 1 \(width 1\): Active MCP repos/);
  const reopened = await call(c, 'open_workspace');
  assert.equal(reopened.structuredContent.panels[0].panelId, 'gh-mcp');

  const bad = await call(c, 'update_profile', { profile: { columns: [{ panels: [{ source: 'rss', config: { url: 'ftp://x' } }] }] } });
  assert.equal(bad.isError, true);
  assert.match(bad.content[0]!.text, /Profile not saved/);
  const after = await call(c, 'get_profile');
  assert.equal(after.structuredContent.profile.columns[0].panels[0].id, 'gh-mcp', 'previous profile untouched');
});

test('read_article returns plain-text reader view with provenance', async () => {
  const result = await call(ctx(), 'read_article', { url: 'https://yashgarg.dev/posts/hijacking-ps5-rtmp-stream/' });
  const { article } = result.structuredContent;
  assert.equal(article.title, "Hijacking the PS5's RTMP Stream");
  assert.equal(article.provenance.source, 'reader');
  assert.match(result.content[0]!.text, /untrusted content/);
  const failed = await call(ctx(), 'read_article', { url: 'https://unknown.example.org/' });
  assert.equal(failed.isError, true);
});

test('read_source previews a feed without touching the profile', async () => {
  const c = ctx();
  const result = await call(c, 'read_source', { source: 'rss', config: { url: 'https://example.com/feed.xml' } });
  assert.equal(result.structuredContent.panel.title, 'Example & Co Blog');
  const bad = await call(c, 'read_source', { source: 'gopher' });
  assert.equal(bad.isError, true);
});

// ---------------------------------------------------------------- profile + store

test('validateProfile normalizes ids, limits and widths', () => {
  const p = validateProfile({
    name: '  Work  ',
    columns: [{ width: 9, panels: [{ source: 'hn', title: 'HN Front!', config: { limit: 999 } }, { source: 'hn', title: 'HN Front!', config: {} }] }],
  });
  assert.equal(p.name, 'Work');
  assert.equal(p.columns[0]!.width, 4);
  assert.deepEqual(p.columns[0]!.panels.map((x) => x.id), ['hn-front', 'hn-front-2']);
  assert.deepEqual(p.columns[0]!.panels[0]!.config, { feed: 'top', limit: 30 });
  assert.throws(() => validateProfile({ columns: [] }), ProfileError);
  assert.throws(() => validateProfile({ columns: [{ panels: [{ source: 'github', config: { mode: 'releases', repo: 'nope' } }] }] }), /owner\/name/);
  assert.throws(() => validateProfile({ columns: [1, 2, 3, 4, 5] }), /At most 4 columns/);
});

test('FileProfileStore round-trips, defaults when missing, and survives hand edits', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-'));
  try {
    const store = new FileProfileStore(dir);
    assert.equal((await store.get('lawrence')).name, 'morning');
    const custom = validateProfile({ name: 'work', columns: [{ panels: [{ source: 'hn', config: { feed: 'best' } }] }] });
    await store.put('lawrence', custom);
    assert.equal((await store.get('lawrence')).name, 'work');
    assert.match(await readFile(path.join(dir, 'lawrence.json'), 'utf8'), /"feed": "best"/);
    await writeFile(path.join(dir, 'lawrence.json'), '{"columns": []}');
    await assert.rejects(store.get('lawrence'), ProfileError);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- boundaries

test('safe-fetch boundary blocks private, local and non-http targets', async () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.20.0.1', '192.168.1.1', '169.254.169.254', '::1', 'fd00::1', '::ffff:10.0.0.1']) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ['8.8.8.8', '140.82.112.3', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
  await assert.rejects(assertPublicUrl('http://localhost:8080/'), /local host/);
  await assert.rejects(assertPublicUrl('http://169.254.169.254/latest/meta-data'), /non-public/);
  await assert.rejects(assertPublicUrl('file:///etc/passwd'), /http\(s\)/);
  await assert.rejects(assertPublicUrl('https://user:pw@example.com/'), /credentials/);
  await assert.doesNotReject(assertPublicUrl('https://93.184.215.14/'));
});
