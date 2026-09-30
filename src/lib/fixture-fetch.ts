/**
 * Offline fetcher backed by test/fixtures. Used by the test suite and by
 * `MCPORTAL_FIXTURES=1` demo mode, so the workspace can be shown without network.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Fetcher } from '../types.ts';

const DIR = fileURLToPath(new URL('../../test/fixtures/', import.meta.url));

function fixtureFor(url: URL): { file: string; type: string } | undefined {
  if (url.host === 'hacker-news.firebaseio.com') {
    const item = url.pathname.match(/\/v0\/item\/(\d+)\.json$/);
    if (item) return { file: `hn-item-${item[1]}.json`, type: 'application/json' };
    if (/\/v0\/\w+stories\.json$/.test(url.pathname)) return { file: 'hn-top.json', type: 'application/json' };
  }
  if (url.host === 'api.github.com' && url.pathname === '/search/repositories') return { file: 'github-search.json', type: 'application/json' };
  if (url.host === 'simonwillison.net' && url.pathname.startsWith('/atom/')) return { file: 'simonw.atom', type: 'application/xml' };
  if (url.host === 'example.com' && url.pathname === '/feed.xml') return { file: 'sample.rss', type: 'application/rss+xml' };
  if (url.host === 'example.com' && url.pathname === '/') return { file: 'site.html', type: 'text/html; charset=utf-8' };
  if (url.host === 'yashgarg.dev') return { file: 'article.html', type: 'text/html; charset=utf-8' };
  return undefined;
}

export function createFixtureFetcher(calls: string[] = []): Fetcher {
  return async (target) => {
    calls.push(target);
    const url = new URL(target);
    const match = fixtureFor(url);
    if (!match) return { status: 404, url: target, contentType: 'text/plain', text: 'not found', truncated: false };
    const text = await readFile(DIR + match.file, 'utf8');
    return { status: 200, url: target, contentType: match.type, text, truncated: false };
  };
}
