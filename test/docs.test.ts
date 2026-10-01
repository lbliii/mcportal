import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import {
  candidateBases, fetchDocPage, inDocsScope, learnedRoute, looksLikeMarkdown, parseLlmsTxt, parseObjectsInv, parseSitemap, resolveDocs, siteDomain, sitemapSite, type DocSite,
} from '../src/adapters/docs.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { normalizeSourceConfig, ProfileError } from '../src/profile.ts';
import { loadPortal } from '../src/sources.ts';
import type { Fetcher, FetchOptions } from '../src/types.ts';

const fixture = (name: string) => readFile(new URL(`./fixtures/docs/${name}`, import.meta.url), 'utf8');

/** A real objects.inv: the four header lines, then the entries zlib-compressed. */
async function inventory(name = 'python-objects.txt'): Promise<Buffer> {
  const lines = (await fixture(name)).split('\n');
  return Buffer.concat([Buffer.from(lines.slice(0, 4).join('\n') + '\n'), deflateSync(lines.slice(4).join('\n'))]);
}

interface Route { status?: number; type?: string; body: string | Buffer; when?: (o: FetchOptions) => boolean }

/** Answers from a table of URL → response (first matching `when` wins); everything else 404s. Records calls. */
function mapFetcher(routes: Record<string, Route | Route[]>, calls: Array<{ url: string; accept?: string | undefined }> = []): Fetcher {
  return async (url, options = {}) => {
    calls.push({ url, accept: options.headers?.accept });
    const all = routes[url];
    const route = (Array.isArray(all) ? all : all ? [all] : []).find((r) => !r.when || r.when(options));
    if (!route) return { status: 404, url, contentType: 'text/html', text: '<!doctype html><title>Not found</title>', truncated: false };
    const text = Buffer.isBuffer(route.body) ? route.body.toString(options.binary ? 'base64' : 'utf8') : route.body;
    return { status: route.status ?? 200, url, contentType: route.type ?? 'text/plain; charset=utf-8', text, truncated: false };
  };
}

const wantsMarkdown = (o: FetchOptions) => /^text\/markdown/.test(o.headers?.accept ?? '');

test('llms.txt: Stripe parses into sections of pages; prose links are not pages', async () => {
  const site = parseLlmsTxt(await fixture('stripe-llms.txt'), 'https://docs.stripe.com/llms.txt')!;
  assert.equal(site.title, 'Stripe Documentation');
  assert.deepEqual(site.sections.map((s) => s.title), ['Docs']);
  const pages = site.sections[0]!.pages;
  assert.equal(pages.length, 10);
  assert.ok(!pages.some((p) => p.url.includes('sandboxes')), 'a link inside a paragraph is not a page');
  assert.deepEqual(pages[0], { title: 'Testing', url: 'https://docs.stripe.com/testing.md', description: 'Simulate payments to test your integration.' });
  assert.equal(pages[1]!.description, undefined, 'no description after the link');
});

test('llms.txt: Next.js section headings are links; the summary is kept', async () => {
  const site = parseLlmsTxt(await fixture('nextjs-llms.txt'), 'https://nextjs.org/docs/llms.txt')!;
  assert.match(site.summary!, /^Reference and guides for Next\.js/);
  assert.deepEqual(site.sections.map((s) => [s.title, s.url, s.pages.length]), [
    ['Getting Started', 'https://nextjs.org/docs/app/getting-started', 8],
    ['Guides', 'https://nextjs.org/docs/app/guides', 2],
  ]);
});

test('llms.txt: nested indexes are marked, whole-docs dumps and link-less sections dropped', async () => {
  const cf = parseLlmsTxt(await fixture('cloudflare-llms.txt'), 'https://developers.cloudflare.com/llms.txt')!;
  assert.equal(cf.sections[0]!.title, 'Application performance');
  assert.ok(cf.sections[0]!.pages.every((p) => p.index));
  assert.equal(cf.sections[0]!.pages[0]!.url, 'https://developers.cloudflare.com/argo-smart-routing/llms.txt');

  const svelte = parseLlmsTxt(await fixture('svelte-llms.txt'), 'https://svelte.dev/llms.txt')!;
  assert.deepEqual(svelte.sections.map((s) => s.title), ['Individual Package Documentation'], '"Documentation Sets" held only dumps; "Notes" has no links');
  assert.equal(svelte.sections[0]!.pages.length, 4);
});

test('llms.txt: odd titles, relative links, duplicates, and what is not an index', () => {
  const text = [
    '# Drizzle', '', '## sql',
    '- [Joins [SQL]](https://orm.drizzle.team/docs/cockroach/joins)',
    '- [The complete guide \\[updated for 2026\\]](/docs/guide.md): How to publish',
    '- [Joins again](https://orm.drizzle.team/docs/cockroach/joins)',
    '- [Evil](javascript:alert(1))',
    '### deeper',
    '- [Deep](deep.md)',
  ].join('\n');
  const site = parseLlmsTxt(text, 'https://orm.drizzle.team/llms.txt')!;
  assert.deepEqual(site.sections.map((s) => s.title), ['sql', 'sql › deeper']);
  assert.deepEqual(site.sections[0]!.pages.map((p) => p.title), ['Joins [SQL]', 'The complete guide [updated for 2026]']);
  assert.equal(site.sections[0]!.pages[1]!.url, 'https://orm.drizzle.team/docs/guide.md');
  assert.equal(site.sections[1]!.pages[0]!.url, 'https://orm.drizzle.team/deep.md');

  assert.equal(parseLlmsTxt('<!DOCTYPE html><html><body># Hi</body></html>', 'https://x.dev/llms.txt'), null, 'Cursor: HTML with a 200');
  const preamble = parseLlmsTxt('## Querying This Documentation\n\nAdd `goal` to every URL.\n\n- [Tracked](/x?goal=1)\n\n---\n\n# Pydantic\n\n## Get Started\n- [a](/a)\n- [b](/b)\n- [c](/c)', 'https://pydantic.dev/llms.txt')!;
  assert.equal(preamble.title, 'Pydantic');
  assert.deepEqual(preamble.sections.map((s) => [s.title, s.pages.length]), [['Get Started', 3]], 'what comes before the title (Pydantic\'s agent instructions) is skipped');
  assert.equal(parseLlmsTxt('Just notes\n- [a](/a)\n- [b](/b)\n- [c](/c)', 'https://x.dev/llms.txt'), null, 'no # Name at all');
  assert.equal(parseLlmsTxt('# Tiny\n- [a](/a)\n- [b](/b)', 'https://x.dev/llms.txt'), null, 'fewer than three links');
});

test('objects.inv: Python pages grouped into sections, symbols kept, labels and params skipped', async () => {
  const site = parseObjectsInv(await inventory(), 'https://docs.python.org/3/objects.inv')!;
  assert.equal(site.title, 'Python');
  assert.equal(site.summary, 'Version 3.14');
  assert.deepEqual(site.sections.map((s) => s.title), ['The Python Tutorial', 'The Python standard library', 'The Python Language Reference', 'Python']);
  assert.deepEqual(site.sections[0]!.pages.map((p) => p.title), ['The Python Tutorial', 'Whetting Your Appetite'], 'the index page leads');
  assert.equal(site.sections[0]!.url, 'https://docs.python.org/3/tutorial/index.html');
  assert.deepEqual(site.sections[3]!.pages.map((p) => p.title), ['About this documentation', 'Glossary'], 'top-level pages go last');
  assert.deepEqual(site.symbols!.map((s) => [s.name, s.role, s.url]), [
    ['os', 'py:module', 'https://docs.python.org/3/library/os.html#module-os'],
    ['os.getcwd', 'py:function', 'https://docs.python.org/3/library/os.html#os.getcwd'],
    ['str.split', 'py:method', 'https://docs.python.org/3/builtins/stdtypes.html#str.split'],
    ['PYTHONPATH', 'std:envvar', 'https://docs.python.org/3/using/cmdline.html#envvar-PYTHONPATH'],
  ]);
  assert.equal(parseObjectsInv(Buffer.from('<!doctype html>\n\n\n\n'), 'https://x.dev/objects.inv'), null);
  assert.equal(parseObjectsInv(Buffer.from('# Sphinx inventory version 2\n# Project: X\n# Version: 1\n# zlib\nnot zlib'), 'https://x.dev/objects.inv'), null);
});

test('sitemap: pages under the docs path, sectioned by their first segment', () => {
  const xml = `<?xml version="1.0"?><urlset>
    <url><loc>https://example.dev/docs/</loc></url>
    <url><loc>https://example.dev/docs/intro</loc></url>
    <url><loc>https://example.dev/docs/guides/getting-started</loc></url>
    <url><loc>https://example.dev/docs/guides/deploy-to_prod.html</loc></url>
    <url><loc>https://example.dev/blog/hello</loc></url>
    <url><loc>https://other.dev/docs/x</loc></url>
  </urlset>`;
  const site = sitemapSite(parseSitemap(xml)!.urls, 'https://example.dev/docs/')!;
  assert.deepEqual(site.sections.map((s) => [s.title, s.pages.map((p) => p.title)]), [
    ['Example', ['Overview', 'Intro']],
    ['Guides', ['Getting started', 'Deploy to prod']],
  ]);
  assert.deepEqual(parseSitemap('<sitemapindex><sitemap><loc>https://example.dev/a.xml</loc></sitemap></sitemapindex>'), { urls: [], children: ['https://example.dev/a.xml'] });
  assert.equal(parseSitemap('<html>nope</html>'), null);
});

test('resolve: candidate directories, nearest first, with docs.<domain> guesses for a bare domain', () => {
  assert.deepEqual(candidateBases('nextjs.org/docs'), ['https://nextjs.org/docs/', 'https://nextjs.org/']);
  assert.deepEqual(candidateBases('https://docs.python.org/3/library/os.html#os.getcwd'), ['https://docs.python.org/3/library/', 'https://docs.python.org/3/', 'https://docs.python.org/']);
  assert.deepEqual(candidateBases('www.stripe.com'), ['https://www.stripe.com/', 'https://docs.stripe.com/', 'https://www.stripe.com/docs/']);
  assert.throws(() => candidateBases('javascript:alert(1)'));
});

test('resolve: a scoped parent llms.txt can serve a path request after local formats fail', async () => {
  const calls: Array<{ url: string }> = [];
  const site = await resolveDocs('https://docs.example.dev/guide/', mapFetcher({
    'https://docs.example.dev/guide/llms.txt': { body: '<!DOCTYPE html><html>soft 404</html>', type: 'text/html' },
    'https://docs.example.dev/llms.txt': { body: '# Guide\n- [a](/guide/a)\n- [b](/guide/b)\n- [c](/guide/c)' },
  }, calls));
  assert.deepEqual(site.toc, { kind: 'llms', url: 'https://docs.example.dev/llms.txt' });
  assert.deepEqual(calls.map((c) => c.url), [
    'https://docs.example.dev/guide/llms.txt', 'https://docs.example.dev/guide/objects.inv',
    'https://docs.example.dev/guide/sitemap.xml', 'https://docs.example.dev/guide/sitemap_index.xml',
    'https://docs.example.dev/llms.txt',
  ]);
});

test('resolve: local llms.txt keeps precedence over a local inventory', async () => {
  const calls: Array<{ url: string }> = [];
  const site = await resolveDocs('https://docs.example.dev/guide/', mapFetcher({
    'https://docs.example.dev/guide/llms.txt': { body: '# Guide\n- [a](a)\n- [b](b)\n- [c](c)' },
    'https://docs.example.dev/guide/objects.inv': { body: await inventory() },
  }, calls));
  assert.equal(site.toc.kind, 'llms');
  assert.equal(calls.length, 1);
});

test('resolve: Sphinx local inventory wins over a broad ancestor llms.txt', async () => {
  const calls: Array<{ url: string }> = [];
  const site = await resolveDocs('https://www.sphinx-doc.org/en/master/', mapFetcher({
    'https://www.sphinx-doc.org/llms.txt': { body: await fixture('parent-llms.txt') },
    'https://www.sphinx-doc.org/en/master/objects.inv': { body: await inventory('sphinx-objects.txt') },
  }, calls));
  assert.deepEqual(site.toc, { kind: 'sphinx', url: 'https://www.sphinx-doc.org/en/master/objects.inv' });
  assert.equal(site.title, 'Sphinx');
  assert.equal(calls.length, 2);
});

test('resolve: NemoClaw ancestor catalog cannot replace its documentation', async () => {
  const site = await resolveDocs('https://docs.nvidia.com/nemoclaw/latest/', mapFetcher({
    'https://docs.nvidia.com/llms.txt': { body: await fixture('parent-llms.txt') },
    'https://docs.nvidia.com/nemoclaw/objects.inv': { body: await inventory('nemoclaw-objects.txt') },
  }));
  assert.deepEqual(site.toc, { kind: 'sphinx', url: 'https://docs.nvidia.com/nemoclaw/objects.inv' });
  assert.equal(site.title, 'NemoClaw');
  assert.ok(site.sections.flatMap((section) => section.pages).every((page) => page.url.startsWith('https://docs.nvidia.com/nemoclaw/')));
});

test('resolve: unrelated ancestor llms.txt is rejected, even with one matching project link', async () => {
  await assert.rejects(resolveDocs('https://docs.nvidia.com/nemoclaw/latest/', mapFetcher({
    'https://docs.nvidia.com/llms.txt': { body: await fixture('parent-llms.txt') },
  })), /No docs index found/);
});

test('resolve: falls back to Sphinx, then to a sitemap index, then explains', async () => {
  const sphinx = await resolveDocs('docs.python.org/3', mapFetcher({ 'https://docs.python.org/3/objects.inv': { body: await inventory() } }));
  assert.deepEqual(sphinx.toc, { kind: 'sphinx', url: 'https://docs.python.org/3/objects.inv' });

  const urls = ['a', 'b/c', 'b/d'].map((p) => `<url><loc>https://ex.dev/docs/${p}</loc></url>`).join('');
  const mapped = await resolveDocs('https://ex.dev/docs', mapFetcher({
    'https://ex.dev/docs/sitemap_index.xml': { body: '<sitemapindex><sitemap><loc>https://ex.dev/s1.xml</loc></sitemap></sitemapindex>', type: 'application/xml' },
    'https://ex.dev/s1.xml': { body: `<urlset>${urls}</urlset>`, type: 'application/xml' },
  }));
  assert.equal(mapped.toc.kind, 'sitemap');
  assert.equal(mapped.sections.flatMap((s) => s.pages).length, 3);

  await assert.rejects(resolveDocs('nothing.dev', mapFetcher({})), /No docs index found for https:\/\/nothing\.dev\//);
});

test('pages: a .md link is read as markdown; front matter and the repeated H1 are dropped', async () => {
  const calls: Array<{ url: string; accept?: string | undefined }> = [];
  const md = '---\ntitle: "Testing"\n---\n# Testing\n\nSimulate payments.\n\n## Cards\n\n- Use `4242`';
  const page = await fetchDocPage('https://docs.stripe.com/testing.md', mapFetcher({ 'https://docs.stripe.com/testing.md': { body: md, type: 'text/markdown' } }, calls));
  assert.equal(page.title, 'Testing');
  assert.equal(page.route, 'markdown');
  assert.deepEqual(page.blocks, [
    { type: 'p', text: 'Simulate payments.' },
    { type: 'h', level: 2, text: 'Cards', id: 'cards' },
    { type: 'li', text: 'Use 4242', spans: [{ text: 'Use ' }, { text: '4242', code: true }] },
  ]);
  assert.equal(calls.length, 1);
  assert.match(calls[0]!.accept!, /^text\/markdown/);
});

test('pages: content negotiation, then the .md sibling, then the HTML reader, and the route is learned', async () => {
  const hono = await fetchDocPage('https://hono.dev/docs/api', mapFetcher({
    'https://hono.dev/docs/api': [{ body: '# API\n\nHello.', type: 'text/markdown', when: wantsMarkdown }, { body: '<html>app</html>', type: 'text/html' }],
  }));
  assert.equal(hono.route, 'markdown');

  const calls: Array<{ url: string; accept?: string | undefined }> = [];
  const next = mapFetcher({
    'https://nextjs.org/docs/app/caching': { body: '<!DOCTYPE html><html><main><p>html</p></main></html>', type: 'text/html' },
    'https://nextjs.org/docs/app/caching.md': { body: '# Caching\n\nFrom markdown.', type: 'text/markdown' },
    'https://nextjs.org/docs/app/fetching/': { body: '<html><main><p>x</p></main></html>', type: 'text/html' },
    'https://nextjs.org/docs/app/fetching.md': { body: '# Fetching\n\nData.', type: 'text/markdown' },
  }, calls);
  const page = await fetchDocPage('https://nextjs.org/docs/app/caching', next, { title: 'Caching' });
  assert.equal(page.route, 'suffix');
  assert.equal(page.sourceUrl, 'https://nextjs.org/docs/app/caching.md');
  assert.deepEqual(page.blocks, [{ type: 'p', text: 'From markdown.' }]);
  assert.equal(learnedRoute('https://nextjs.org/anything'), 'suffix');

  calls.length = 0;
  const second = await fetchDocPage('https://nextjs.org/docs/app/fetching/', next);
  assert.equal(second.title, 'Fetching');
  assert.deepEqual(calls.map((c) => c.url), ['https://nextjs.org/docs/app/fetching.md'], 'learned route goes first; trailing slash dropped');

  const sphinxHtml = '<!DOCTYPE html><html><head><title>os — Python</title></head><body><nav>menu</nav><main><h1>os</h1><p>Portable OS functions.</p></main></body></html>';
  const calls2: Array<{ url: string; accept?: string | undefined }> = [];
  const py = await fetchDocPage('https://docs.python.org/3/library/os.html', mapFetcher({ 'https://docs.python.org/3/library/os.html': { body: sphinxHtml, type: 'text/html' } }, calls2), { title: 'os' });
  assert.equal(py.route, 'html');
  assert.deepEqual(py.blocks.map((b) => b.text), ['Portable OS functions.'], 'the H1 repeating the title is dropped');
  assert.deepEqual(calls2.map((c) => c.url), ['https://docs.python.org/3/library/os.html', 'https://docs.python.org/3/library/os.md'], 'the HTML from the first request is reused');
});

test('pages: JSON and 404s are not pages', async () => {
  await assert.rejects(fetchDocPage('https://api.example.dev/openapi.json', mapFetcher({ 'https://api.example.dev/openapi.json': { body: '{"openapi":"3.1"}', type: 'application/json' } })), /No readable version/);
  await assert.rejects(fetchDocPage('https://gone.dev/page', mapFetcher({})), /No readable version|responded 404/);
  assert.equal(looksLikeMarkdown('# Hi', 'text/html; charset=utf-8'), true, 'some servers label markdown as HTML');
  assert.equal(looksLikeMarkdown('  <html>', 'text/plain'), false);
});

test('scope: pages in the table of contents or on its domains; nothing else', () => {
  const site: DocSite = {
    title: 'Bun', toc: { kind: 'llms', url: 'https://bun.sh/llms.txt' },
    sections: [{ title: 'Docs', pages: [{ title: 'Bytecode', url: 'https://bun.com/docs/bundler/bytecode.md' }] }],
  };
  assert.ok(inDocsScope(site, 'https://bun.com/docs/bundler/bytecode.md'));
  assert.ok(inDocsScope(site, 'https://bun.sh/docs/other'), 'the index domain');
  assert.ok(inDocsScope(site, 'https://www.bun.com/x'), 'a domain the TOC links to');
  assert.ok(!inDocsScope(site, 'https://evil.dev/docs'));
  assert.ok(!inDocsScope(site, 'file:///etc/passwd'));
  assert.equal(siteDomain('docs.stripe.com'), 'stripe.com');
  assert.equal(siteDomain('docs.foo.co.uk'), 'foo.co.uk');
});

test('portal: a docs config validates, and the portal lists sections or one section\'s pages', async () => {
  assert.throws(() => normalizeSourceConfig('docs', { url: 'ftp://x' }, 'p'), ProfileError);
  assert.throws(() => normalizeSourceConfig('docs', { url: 'https://x.dev', toc: { kind: 'algolia', url: 'https://x.dev' } }, 'p'), /toc needs a kind/);
  assert.deepEqual(normalizeSourceConfig('docs', { url: 'https://nextjs.org/docs', toc: { kind: 'llms', url: 'https://nextjs.org/docs/llms.txt' }, section: ' Guides ', limit: 99 }, 'p'), {
    url: 'https://nextjs.org/docs', toc: { kind: 'llms', url: 'https://nextjs.org/docs/llms.txt' }, section: 'Guides', limit: 30,
  });

  const deps = { fetcher: mapFetcher({ 'https://nextjs.org/docs/llms.txt': { body: await fixture('nextjs-llms.txt') } }), cache: new TtlCache() };
  const toc = { kind: 'llms', url: 'https://nextjs.org/docs/llms.txt' };
  const all = await loadPortal({ id: 'next', source: 'docs', config: { url: 'https://nextjs.org/docs', toc } }, deps);
  assert.equal(all.error, undefined);
  assert.equal(all.title, 'Next.js Documentation');
  assert.equal(all.provenance.ttlSeconds, 86_400);
  assert.deepEqual(all.items.map((i) => [i.title, i.meta[0], i.url]), [
    ['Getting Started', '8 pages', 'https://nextjs.org/docs/app/getting-started'],
    ['Guides', '2 pages', 'https://nextjs.org/docs/app/guides'],
  ]);
  assert.equal(all.items[0]!.summary, 'Installation · Project Structure · Layouts and Pages · Linking and Navigating');

  const guides = await loadPortal({ id: 'g', source: 'docs', config: { url: 'https://nextjs.org/docs', toc, section: 'guides' } }, deps);
  assert.equal(guides.title, 'Next.js Documentation: guides');
  assert.deepEqual(guides.items.map((i) => i.title), ['Adopting Partial Prefetching', 'AI Coding Agents']);

  const missing = await loadPortal({ id: 'm', source: 'docs', config: { url: 'https://nextjs.org/docs', toc, section: 'Nope' } }, deps);
  assert.match(missing.error!, /no section "Nope"/);
});
