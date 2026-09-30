import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

/** Exercise the shipped host-context handler without a browser or upstream requests. */
async function hostTheme() {
  const html = await readFile(new URL('../src/ui/room.html', import.meta.url), 'utf8');
  const handler = html.match(/  function applyHostContext\(ctx\) \{[\s\S]*?\n  \}/)?.[0];
  assert.ok(handler, 'the room has a host-context handler');
  const properties = new Map<string, string>();
  const root = { dataset: {} as Record<string, string>, style: { setProperty: (key: string, value: string) => properties.set(key, value) } };
  const expand = { hidden: false };
  const modes: string[] = [];
  const apply = vm.runInNewContext(`${handler}; applyHostContext`, {
    root, $: () => expand, canFullscreen: true, setDisplayMode: (mode: string) => modes.push(mode),
  });
  return { apply, root, properties, expand, modes };
}

test('host theme tokens apply without overwriting the room palette or layout', async () => {
  const { apply, root, properties, expand, modes } = await hostTheme();
  apply({ theme: 'dark', displayMode: 'inline', availableDisplayModes: ['inline'], styles: { variables: {
    '--color-background-primary': '#161616', '--color-text-primary': '#ececea',
    '--font-sans': 'system-ui', '--border-radius-lg': '12px',
    '--fg': '#000', '--surface': 'transparent', '--page': 'transparent', '--lane-h': '0px',
    '--color-background-secondary': '', '--color-text-secondary': '   ', '--color-border-primary': null,
  } } });
  assert.equal(root.dataset.theme, 'dark');
  assert.deepEqual([...properties], [
    ['--color-background-primary', '#161616'], ['--color-text-primary', '#ececea'],
    ['--font-sans', 'system-ui'], ['--border-radius-lg', '12px'],
  ]);
  assert.equal(expand.hidden, true);
  assert.deepEqual(modes, ['inline']);
});

test('a host can switch themes and send partial contexts without resetting the theme', async () => {
  const { apply, root, properties, expand } = await hostTheme();
  apply({ theme: 'light', styles: { variables: { '--color-background-primary': '#fff', '--color-text-primary': '#1b1b1a' } } });
  apply({ theme: 'dark', styles: { variables: { '--color-background-primary': '#161616', '--color-text-primary': '#ececea' } } });
  apply({ availableDisplayModes: ['inline', 'fullscreen'] });
  apply(null);
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(properties.get('--color-background-primary'), '#161616');
  assert.equal(properties.get('--color-text-primary'), '#ececea');
  assert.equal(expand.hidden, false);
});

test('theme-only hosts use the room palette without requiring host CSS tokens', async () => {
  const { apply, root, properties } = await hostTheme();
  apply({ theme: 'dark' });
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(properties.size, 0);
  apply({ theme: 'light' });
  assert.equal(root.dataset.theme, 'light');
});
