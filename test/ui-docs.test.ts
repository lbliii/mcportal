import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

// Exercise the shipped tool-result dispatcher and card setup, including real DOM ids.
// Browser validation still checks the full layout and asynchronous page fetch.
async function viewer() {
  const html = await readFile(new URL('../src/ui/room.html', import.meta.url), 'utf8');
  const ids = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
  const nodes = new Map(ids.map((id) => [id, { hidden: true, textContent: '', replaceChildren(...children: unknown[]) { this.textContent = children.join(' '); } }]));
  const fn = (name: string) => {
    const match = html.match(new RegExp(`  function ${name}\\([^]*?\\n  \\}`));
    assert.ok(match, name);
    return match[0];
  };
  const shown: unknown[] = [];
  const errors: unknown[] = [];
  const statuses: string[] = [];
  const context = vm.createContext({
    $: (id: string) => nodes.get(id), root: { classList: { add() {}, remove() {} } },
    showDocs: (data: unknown, key: unknown, options: unknown) => shown.push({ data, key, options }),
    setStatus: (text: string) => statuses.push(text), console: { error: (...args: unknown[]) => errors.push(args) },
    el: (_tag: string, _attrs: unknown, text: string) => text,
  });
  vm.runInContext(`let docsArgs = { docs: 'acme/widgets' }; let toolRunning = true; let gotInitialResult = false;
    ${fn('showAppError')}\n${fn('showDocsCard')}\n${fn('onHostNotification')}
    function dispatch(params) { try { onHostNotification('ui/notifications/tool-result', params); } catch (error) { showAppError('Could not display the tool result', error); } }`, context);
  return { context, nodes, shown, errors, statuses };
}

test('open_docs host result makes a visible docs card using existing DOM elements', async () => {
  const v = await viewer();
  vm.runInContext(`dispatch({ structuredContent: { docs: 'acme/widgets', site: { sections: [] } } })`, v.context);
  assert.equal(v.errors.length, 0);
  assert.equal(v.nodes.get('roomName')!.textContent, 'docs');
  assert.equal(v.nodes.get('reader')!.hidden, false);
  assert.equal(v.nodes.get('grid')!.hidden, true);
  assert.equal(v.nodes.get('welcome')!.hidden, true);
  assert.equal(v.shown.length, 1);
});

test('tool errors show the actual diagnostic and stop initial fallback', async () => {
  const v = await viewer();
  vm.runInContext(`dispatch({ isError: true, content: [{ type: 'text', text: 'No docs index found' }] })`, v.context);
  assert.match(v.nodes.get('reader')!.textContent, /No docs index found/);
  assert.equal(v.nodes.get('reader')!.hidden, false);
  assert.equal(v.errors.length, 1);
  assert.equal(vm.runInContext('gotInitialResult && !toolRunning', v.context), true);
});

test('unsupported host results display a diagnostic instead of leaving a loading view', async () => {
  const v = await viewer();
  vm.runInContext('dispatch({ structuredContent: {} })', v.context);
  assert.match(v.nodes.get('reader')!.textContent, /no supported view data/);
  assert.equal(v.statuses.at(-1), 'View failed');
});

test('render exceptions reach the visible error boundary', async () => {
  const v = await viewer();
  vm.runInContext(`showDocs = () => { throw new Error('Invalid docs viewer data'); };
    dispatch({ structuredContent: { docs: 'acme/widgets', site: { sections: [] } } })`, v.context);
  assert.match(v.nodes.get('reader')!.textContent, /Invalid docs viewer data/);
  assert.equal(v.errors.length, 1);
});
