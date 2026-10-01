import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { roomHtml } from '../src/mcp.ts';

const html = await roomHtml();
function shipped(name: string) {
  const found = html.match(new RegExp(`  (?:async )?function ${name}\\([^]*?\\n  \\}`));
  assert.ok(found, name);
  return found[0];
}

test('missing bridge capabilities reject without posting a request or scheduling a timeout', async () => {
  const calls: unknown[] = [];
  const context = vm.createContext({ setTimeout: () => calls.push('timer'), window: { parent: { postMessage: () => calls.push('post') } } });
  vm.runInContext(`let hostCapabilities = {}, canFullscreen = false, nextId = 1; ${shipped('hostRequest')}`, context);
  for (const method of ['tools/call', 'ui/open-link', 'ui/message', 'ui/update-model-context', 'ui/request-display-mode']) {
    await assert.rejects(vm.runInContext(`hostRequest('${method}', {})`, context), /not support|not available/);
  }
  assert.deepEqual(calls, []);
});

test('advertised capability sends the normal JSON-RPC request', async () => {
  const sent: any[] = [];
  const context = vm.createContext({ setTimeout: () => 1, window: { parent: { postMessage: (msg: unknown) => sent.push(msg) } } });
  vm.runInContext(`let hostCapabilities = { serverTools: {} }, canFullscreen = false, nextId = 1; const pending = new Map(); ${shipped('hostRequest')}; hostRequest('tools/call', { name: 'open_room' });`, context);
  assert.equal(sent[0].method, 'tools/call');
  assert.equal(sent[0].params.name, 'open_room');
  assert.equal(vm.runInContext('pending.size', context), 1);
});

test('chat preference falls back inline immediately when messages are unsupported', async () => {
  const opened: unknown[] = [];
  const context = vm.createContext({ hostCapabilities: {}, openReader: (...args: unknown[]) => opened.push(args), isHttpUrl: () => true });
  vm.runInContext(shipped('openInChat'), context);
  await vm.runInContext(`openInChat({url:'https://example.com'}, {title:'News'})`, context);
  assert.equal(opened.length, 1);
});

test('declined original-link requests expose an address fallback', async () => {
  const addresses: string[] = [];
  const context = vm.createContext({ DEV: false, isHttpUrl: () => true, hostRequest: async () => ({ isError: true }), showLinkFallback: (url: string) => addresses.push(url) });
  vm.runInContext(shipped('openLink'), context);
  await vm.runInContext(`openLink('https://example.com')`, context);
  assert.deepEqual(addresses, ['https://example.com']);
});

test('returning to a room restores lane/column scroll and focus without reloading', async () => {
  const lane = { hidden: false, scrollLeft: 340, scrollTop: 0, querySelectorAll: () => [column] };
  const column = { scrollLeft: 0, scrollTop: 280 };
  let focused = false;
  const nodes: any = { grid: lane, reader: { hidden: false, classList: { remove() {} } }, roomName: {} };
  const positions: unknown[] = [];
  const context = vm.createContext({ $: (id: string) => nodes[id], state: { profile: { name: 'My room' } }, root: { classList: { remove() {} } }, document: { activeElement: { focus: () => { focused = true; } } }, window: { scrollX: 0, scrollY: 150, scrollTo: (...args: unknown[]) => positions.push(args) } });
  vm.runInContext(`let readerGeneration = 0, roomNavigation = null, articleUrl = null, clipId = null, docsArgs = null, spaceHandle = null, docsState = null; ${shipped('rememberRoomNavigation')} ${shipped('closeReader')} rememberRoomNavigation();`, context);
  lane.hidden = true; lane.scrollLeft = 0; column.scrollTop = 0;
  await vm.runInContext('closeReader()', context);
  assert.equal(lane.hidden, false);
  assert.equal(nodes.reader.hidden, true);
  assert.equal(lane.scrollLeft, 340);
  assert.equal(column.scrollTop, 280);
  assert.equal(focused, true);
  assert.deepEqual(positions, [[0, 150]]);
});

test('standalone card home clears card routing and loads a room', async () => {
  let loaded = 0;
  const nodes: any = { grid: { hidden: true }, reader: { classList: { remove() {} } } };
  const context = vm.createContext({ $: (id: string) => nodes[id], state: { profile: null }, root: { classList: { remove() {} } }, loadRoom: async () => { loaded++; } });
  vm.runInContext(`let readerGeneration = 0, articleUrl = 'https://example.com', clipId = null, docsArgs = {}, spaceHandle = null, docsState = {}; ${shipped('closeReader')}`, context);
  await vm.runInContext('closeReader()', context);
  assert.equal(loaded, 1);
  assert.equal(nodes.grid.hidden, false);
  assert.equal(vm.runInContext('articleUrl === null && docsArgs === null && docsState === null', context), true);
});

test('a late article result cannot replace the view after home navigation', async () => {
  let resolveTool!: (value: unknown) => void;
  const replaced: unknown[] = [];
  const reader = { hidden: true, scrollTop: 0, replaceChildren: (...children: unknown[]) => replaced.push(children) };
  const context = vm.createContext({ $: (id: string) => id === 'reader' ? reader : {}, rememberRoomNavigation() {}, window: { scrollTo() {} }, readerTop() {}, el() {}, callTool: () => new Promise((resolve) => { resolveTool = resolve; }), articleNodes: () => { throw new Error('Stale article rendered'); } });
  vm.runInContext(`let readerGeneration = 0; ${shipped('openReader')}`, context);
  const opened = vm.runInContext(`openReader({url:'https://example.com'}, {title:'News'})`, context);
  vm.runInContext('readerGeneration++', context);
  resolveTool({ structuredContent: { article: {} } });
  await opened;
  assert.equal(replaced.length, 1);
});
