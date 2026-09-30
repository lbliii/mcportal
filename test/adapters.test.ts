import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { fetchGithub } from '../src/adapters/github.ts';
import { fetchHn } from '../src/adapters/hn.ts';
import { extractArticle } from '../src/adapters/reader.ts';
import { parseFeed } from '../src/adapters/rss.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';

const fixture = (name: string) => readFile(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');

test('hn: fetches top stories, skips missing items, keeps order', async () => {
  const calls: string[] = [];
  const items = await fetchHn({ feed: 'top', limit: 4 }, createFixtureFetcher(calls));
  assert.equal(calls[0], 'https://hacker-news.firebaseio.com/v0/topstories.json');
  assert.deepEqual(items.map((i) => i.id), ['49880036', '49883844', '49879702']); // 49999999 has no fixture
  assert.equal(items[0]!.title, 'Pirating the Pirates');
  assert.equal(items[0]!.discussionUrl, 'https://news.ycombinator.com/item?id=49880036');
  assert.ok(items[0]!.meta.includes('310 points'));
  assert.ok(items[0]!.meta.includes('mubi.com'));
});

test('github: maps search results', async () => {
  const items = await fetchGithub({ mode: 'search', query: 'topic:mcp', sort: 'stars', limit: 3 }, createFixtureFetcher());
  assert.equal(items.length, 3);
  assert.equal(items[0]!.title, 'affaan-m/ECC');
  assert.equal(items[0]!.meta[0], '★ 270k');
  assert.equal(items[2]!.summary, undefined);
});

test('rss: parses Atom with entities and CDATA titles', async () => {
  const feed = parseFeed(await fixture('simonw.atom'));
  assert.equal(feed.title, "Simon Willison's Weblog");
  assert.equal(feed.items.length, 3);
  assert.equal(feed.items[0]!.title, 'Claude Sonnet 5.5');
  assert.equal(feed.items[0]!.url, 'https://simonwillison.net/2026/Sep/28/claude-sonnet-5-5/');
  assert.equal(feed.items[0]!.publishedAt, '2026-09-28T22:07:38.000Z');
  assert.match(feed.items[0]!.summary!, /^New Sonnet model/, 'leading title is not repeated');
  assert.ok(!feed.items[0]!.summary!.includes('<'));
  assert.equal(feed.items[1]!.summary, 'Security posture takes time to develop. It’s not just about hardening the systems at play…');
  assert.equal(feed.items[2]!.title, 'Quoting Muse AI Agent & friends');
});

test('rss: parses RSS 2.0, resolves relative links, drops unsafe schemes', async () => {
  const feed = parseFeed(await fixture('sample.rss'), 10, 'https://example.com/feed.xml');
  assert.equal(feed.title, 'Example & Co Blog');
  assert.equal(feed.items[0]!.summary, 'Hello world');
  assert.deepEqual(feed.items[0]!.meta, ['by Ada', 'example.com']);
  assert.equal(feed.items[1]!.url, 'https://example.com/second');
  assert.equal(feed.items[1]!.publishedAt, undefined);
  assert.equal(feed.items[2]!.url, undefined);
});

test('reader: extracts clean text blocks and strips chrome, scripts and markup', async () => {
  const article = extractArticle(await fixture('article.html'));
  assert.equal(article.title, "Hijacking the PS5's RTMP Stream");
  assert.equal(article.siteName, 'Yash Garg');
  assert.equal(article.byline, 'Yash Garg');
  const texts = article.blocks.map((b) => b.text);
  assert.ok(!texts.some((t) => /Site header|Home|Related posts|tracker|color:red/.test(t)), 'chrome and scripts removed');
  assert.ok(!texts.includes("Hijacking the PS5's RTMP Stream"), 'duplicate title heading dropped');
  assert.deepEqual(article.blocks.filter((b) => b.type === 'h').map((b) => b.text), ['The Problem', 'DNS Trick']);
  assert.equal(article.blocks.find((b) => b.type === 'pre')!.text.split('\n').length, 2);
  assert.equal(article.blocks.find((b) => b.type === 'quote')?.text, undefined);
  assert.ok(texts.includes('If we control what DNS returns, we control where the stream goes.'));
  assert.ok(texts.some((t) => t.includes('friends on Discord, but')), 'no stray space before punctuation after inline links');
  assert.deepEqual(article.blocks.filter((b) => b.type === 'li').map((b) => b.text), ['dnsmasq', 'nginx-rtmp']);
  const injected = article.blocks.find((b) => b.text.startsWith('IGNORE'))!;
  assert.ok(!injected.text.includes('<') && !injected.text.includes('onerror'), 'markup never survives');
  assert.ok(article.wordCount > 40);
});
