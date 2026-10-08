import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** Every .ts and .js file under a directory. @param {string} dir */
async function sources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(entries.map((e) => {
    const full = path.join(dir, e.name);
    return e.isDirectory() ? sources(full) : /\.(ts|js|mjs)$/.test(e.name) ? [full] : [];
  }));
  return nested.flat();
}

test('the image copies every top-level folder the server reads files from at runtime', async () => {
  const docker = await readFile(path.join(ROOT, 'Dockerfile'), 'utf8');
  const copied = new Set([...docker.matchAll(/^COPY\s+(\S+)/gm)].map((m) => m[1]!.split('/')[0]!));
  const needed = new Map<string, string>();
  for (const file of [...await sources(path.join(ROOT, 'src')), ...await sources(path.join(ROOT, 'bin'))]) {
    const text = await readFile(file, 'utf8');
    for (const m of text.matchAll(/new URL\(['`](\.\.?\/[^'`$]+)/g)) {
      const top = path.relative(ROOT, path.resolve(path.dirname(file), m[1]!)).split(path.sep)[0]!;
      if (top && !top.startsWith('..') && !needed.has(top)) needed.set(top, path.relative(ROOT, file));
    }
  }
  const missing = [...needed].filter(([top]) => !copied.has(top) && !/\.(ts|js|mjs|json)$/.test(top));
  assert.deepEqual(missing, [], `Dockerfile doesn't COPY: ${missing.map(([top, by]) => `${top} (read by ${by})`).join(', ')}`);
});
