import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commonness, match, namedSignal, sourceSignal, termsOf } from '../src/people.ts';

const feed = (url: string, title = url) => ({ source: 'rss' as const, config: { url, limit: 10 }, title });

test('people: sources match loosely (www, http, a trailing slash), and only real sites count as "the same site"', () => {
  assert.equal(sourceSignal('rss', { url: 'http://www.Example.com/feed/' }, 'x')?.key, sourceSignal('rss', { url: 'https://example.com/feed' }, 'x')?.key);
  assert.equal(sourceSignal('rss', { url: 'https://example.com/feed' }, 'x')?.site, 'example.com');
  assert.equal(sourceSignal('rss', { url: 'https://www.reddit.com/r/synthesizers/.rss' }, 'x')?.site, undefined, 'every subreddit is on reddit');
  assert.equal(sourceSignal('github', { mode: 'releases', repo: 'Rust-Lang/Rust' }, 'x')?.key, 'github:rust-lang/rust');
  assert.equal(sourceSignal('hn', { feed: 'best' }, 'x')?.key, 'hn:best');
  assert.equal(sourceSignal('saved', {}, 'x'), undefined);

  assert.deepEqual(namedSignal('simonwillison.net'), { host: 'simonwillison.net' }, 'a bare domain is a site');
  assert.equal(namedSignal('https://simonwillison.net/atom/everything/').source?.key, 'web:simonwillison.net/atom/everything', 'an address with a path is that feed too');
  assert.equal(namedSignal('rust-lang/rust').source?.key, 'github:rust-lang/rust');
  assert.equal(namedSignal('https://github.com/rust-lang/rust').source?.key, 'github:rust-lang/rust');
  assert.deepEqual(namedSignal('cats'), {}, 'a word is not a site');

  assert.deepEqual(termsOf('I really love cats and World of Warcraft, C++ too'), ['cats', 'world', 'warcraft', 'c++', 'too']);
});

test('people: a rare shared source counts for more than a common one; words and posts count less', () => {
  const ana = { handle: 'ana', featured: [feed('https://catphysics.example/feed', 'Cat Physics'), { source: 'hn' as const, config: { feed: 'top' as const, limit: 10 }, title: 'HN' }], posts: [] };
  const ben = { handle: 'ben', featured: [{ source: 'hn' as const, config: { feed: 'top' as const, limit: 10 }, title: 'HN' }], bio: 'I write about cats', posts: [{ title: 'A cat', url: 'https://catphysics.example/a' }] };
  const everyone = [ana, ben, ...Array.from({ length: 8 }, (_, i) => ({ handle: `p${i}`, featured: [{ source: 'hn' as const, config: { feed: 'top' as const, limit: 10 }, title: 'HN' }], posts: [] }))];
  const common = commonness(everyone);
  const wanted = { sources: [sourceSignal('rss', { url: 'https://catphysics.example/feed' }, 'mine')!, sourceSignal('hn', { feed: 'top' }, 'mine')!], hosts: ['catphysics.example'], terms: ['cats'] };
  const a = match(ana, wanted, common);
  const b = match(ben, wanted, common);
  assert.deepEqual(a.sources, ['Cat Physics', 'HN']);
  assert.deepEqual(b.sources, ['HN']);
  assert.deepEqual(b.hosts, [{ host: 'catphysics.example', count: 1 }]);
  assert.deepEqual(b.terms, { space: ['cats'], posts: [] });
  assert.ok(a.score > b.score, `the rare source wins (${a.score} > ${b.score})`);
  assert.equal(match({ handle: 'zed', featured: [], posts: [] }, wanted, common).score, 0);
});
