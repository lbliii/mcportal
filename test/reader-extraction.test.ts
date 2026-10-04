import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractArticle, READER_LIMITS } from '../src/adapters/reader.ts';
const fixture = (name: string) => readFile(new URL(`./fixtures/reader-extraction/${name}.html`, import.meta.url), 'utf8');
const story = (body: string) => extractArticle(`<article>${body}</article>`, 'https://journal.example/story');

test('reader extraction: selects an encompassing story and excludes component chrome, with editorial preservation controls', async () => {
  const a = extractArticle(await fixture('editorial'), 'https://journal.example/forest');
  assert.equal(a.title, "Ada's Forest");
  assert.equal(a.siteName, 'Field Journal');
  assert.equal(a.byline, 'Ada Grove, Bo Leaf');
  assert.equal(a.publishedAt, '2026-10-03T12:00:00.000Z');
  assert.equal(a.updatedAt, '2026-10-03T14:00:00.000Z');
  assert.equal(a.blocks.filter((b) => b.type === 'h').length, 2);
  const text = a.blocks.map((b) => b.text).join('\n');
  assert.doesNotMatch(text, /UI marker|card headline|Unrelated widget|Ada's Forest/);
  for (const marker of ['short editorial deck', 'FIRST', 'MIDDLE', 'LAST', 'Correction:', 'Photography by', 'Related measurements', 'Share of the sample']) assert.ok(text.includes(marker), marker);
  assert.equal(a.blocks.find((b) => b.text.startsWith('LAST'))?.spans?.find((s) => s.href)?.href, 'https://journal.example/reference');
});

test('reader extraction: composed emphasis, links and inline code retain authored line breaks', () => {
  const a = story('<p>Intro <strong><em><a href="/dates"><code>New dates</code></a></em></strong><br>October 4<br><b>October 6</b></p>');
  const spans = a.blocks[0]!.spans!;
  const marked = spans.find((s) => s.text.includes('New dates'))!;
  assert.equal(marked.strong, true); assert.equal(marked.em, true); assert.equal(marked.code, true); assert.equal(marked.href, 'https://journal.example/dates');
  assert.equal(spans.filter((s) => s.breakBefore).length, 2);
  assert.match(a.blocks[0]!.text, /New dates October 4 October 6/);
});

test('reader extraction: numbered groups, explicit values, nesting and parent continuation survive', () => {
  const a = story('<ol start="4"><li>Parent lead<ol start="9"><li>Child one</li><li value="15">Child two</li></ol>Parent tail</li><li>Next parent</li></ol><ol start="2"><li>Separate group</li></ol>');
  const lis = a.blocks.filter((b) => b.type === 'li');
  assert.deepEqual(lis.map((b) => [b.text, b.level, b.value, b.listStart]), [['Parent lead', 0, 4, 4], ['Child one', 1, 9, 9], ['Child two', 1, 15, 9], ['Next parent', 0, 5, 4], ['Separate group', 0, 2, 2]]);
  assert.ok(lis.every((b) => b.ordered));
  assert.equal(lis[0]!.listId, lis[3]!.listId); assert.notEqual(lis[0]!.listId, lis[4]!.listId);
  assert.equal(a.blocks[3]!.text, 'Parent tail');
});

test('reader extraction: coherent quotes preserve attribution and separate adjacent quotations', () => {
  const a = story('<blockquote><p>First paragraph.</p><p>Second paragraph.</p><cite>— First speaker</cite></blockquote><blockquote><p>Separate quotation.</p></blockquote>');
  assert.deepEqual(a.blocks.map((b) => b.text), ['First paragraph.', 'Second paragraph.', '— First speaker', 'Separate quotation.']);
  assert.equal(a.blocks[0]!.quoteId, a.blocks[2]!.quoteId); assert.notEqual(a.blocks[0]!.quoteId, a.blocks[3]!.quoteId);
});

test('reader extraction: figures attach captions and credit, dedup gallery renditions, preserve distinct/repeated works and safe media fallback', async () => {
  const a = extractArticle(await fixture('gallery'), 'https://journal.example/gallery');
  const figures = a.blocks.filter((b) => b.figure);
  assert.equal(figures.length, 4);
  assert.equal(figures[0]!.figure!.caption, 'A bright forest.'); assert.equal(figures[0]!.figure!.credit, '© Ada Grove');
  assert.equal(figures[1]!.figure!.url, 'https://journal.example/second.jpg?w=1400');
  assert.ok(figures.every((b) => b.spans?.[0]?.href === b.figure!.url && b.text.length > 0));
  assert.deepEqual(a.blocks.filter((b) => b.media).map((b) => b.media!.kind), ['video', 'audio']);
  assert.doesNotMatch(JSON.stringify(a), /tracking\.example|javascript:|tracker\.gif/);
  assert.equal(a.wordCount, 21, 'only editorial text contributes to reading time');
});

test('reader extraction: metadata graph ignores unrelated articles and invalid/rolled-over dates', () => {
  const a = extractArticle(`<head><title>Local headline | Journal</title><meta property="og:site_name" content="Journal"><meta name="author" content="https://journal.example/ada"><script type="application/ld+json">{"@graph":[{"@type":"NewsArticle","url":"https://journal.example/other","headline":"Other","author":{"name":"Wrong Author"},"datePublished":"2026-02-31"},{"@type":"NewsArticle","url":"https://journal.example/local","headline":"Local headline","author":{"name":"Right Author"},"datePublished":"2026-02-28","dateModified":"2"}]}</script></head><article><h1>Local headline</h1><p>Leading prose.</p><h2>Local headline</h2><p>Deeper prose.</p></article>`, 'https://journal.example/local');
  assert.equal(a.title, 'Local headline'); assert.equal(a.byline, 'Right Author'); assert.equal(a.publishedAt, '2026-02-28T00:00:00.000Z'); assert.equal(a.updatedAt, undefined);
  assert.equal(a.blocks.filter((b) => b.type === 'h').length, 1, 'a deeper repeated heading remains editorial');
  assert.equal(story('<p>A small uncredited story.</p>').byline, undefined);
});

test('reader extraction: recognized markup authors can populate a header without biography substitution', () => {
  const a = story('<header><p class="byline">By <span>Ada Grove</span></p><time itemprop="datePublished" datetime="2026-10-03">October 3, 2026</time></header><p>Lead.</p><div class="author-profile"><p>Ada writes many stories and enjoys trees.</p></div>');
  assert.equal(a.byline, 'Ada Grove'); assert.equal(a.publishedAt, '2026-10-03T00:00:00.000Z'); assert.deepEqual(a.blocks.map((b) => b.text), ['Lead.']);
});

test('reader extraction: docs mode preserves generic component classes and technical structure', () => {
  const a = extractArticle('<main><h1>Reference</h1><section class="newsletter"><h2>Related subscriptions</h2><p>A documented newsletter endpoint.</p></section><div class="admonition warning"><p class="admonition-title">Careful</p><p>Warning text.</p></div><pre><code class="language-js">const x = 1;\nreturn x;</code></pre><table><tr><th>Key</th><th>Value</th></tr><tr><td>x</td><td>1</td></tr></table></main>', 'https://docs.example/reference', READER_LIMITS, { mode: 'docs' });
  assert.ok(a.blocks.some((b) => b.text.includes('documented newsletter')));
  assert.equal(a.blocks.find((b) => b.type === 'callout')?.label, 'Careful'); assert.equal(a.blocks.find((b) => b.type === 'pre')?.lang, 'js'); assert.deepEqual(a.blocks.find((b) => b.type === 'table')?.columns, ['Key', 'Value']);
});

test('reader extraction: malformed/deep inputs and custom content limits stay bounded', () => {
  const start = performance.now();
  for (const html of ['<article>' + '<div>'.repeat(150_000) + '<p>Deep text</p>', '<article><p>one<p>two<p>three', '<article>' + '<p>x</p>'.repeat(50_000)]) {
    const a = extractArticle(html, undefined, { blocks: 5, totalChars: 20 });
    assert.ok(a.blocks.length <= 5); assert.ok(a.blocks.reduce((n, b) => n + b.text.length, 0) <= 20);
  }
  assert.ok(performance.now() - start < 1500);
  assert.deepEqual(story('<p>one<p>two<p>three').blocks.map((b) => b.text), ['one', 'two', 'three']);
});

test('reader extraction: ambiguous component names retain substantial editorial prose while actionable widgets are excluded', () => {
  const prose = 'This section examines subscription funding models used by small publications. Readers may support a publication for many different reasons, and our interviews discuss how these choices shape the articles they encounter and the communities around them.';
  const a = story(`<section id="subscription"><h2>Subscription models</h2><p>${prose}</p></section><section class="related-content"><h2>Related content</h2><p>${prose}</p></section><div class="newsletter"><p>Sign up for our newsletter and enter your email to get the latest news.</p><button>Subscribe</button></div>`);
  assert.equal(a.blocks.filter((b) => b.text === prose).length, 2);
  assert.doesNotMatch(a.blocks.map((b) => b.text).join('\n'), /Sign up|enter your email/);
});

test('reader extraction: every distinct image in a multi-image figure keeps its shared caption and credit', () => {
  const a = story('<p>Compare the works.</p><figure><img src="/left.jpg" alt="Left"><img src="/right.jpg" alt="Right"><figcaption><p>Two complementary works.</p><span class="credit">Photo: Ada</span></figcaption></figure><ol start="3"><li><p>A wrapped item.</p><p>Its continuation.</p></li></ol>');
  assert.deepEqual(a.blocks.filter((b) => b.figure).map((b) => [b.figure!.alt, b.figure!.caption, b.figure!.credit]), [['Left', 'Two complementary works.', 'Photo: Ada'], ['Right', 'Two complementary works.', 'Photo: Ada']]);
  assert.equal(a.blocks.find((b) => b.type === 'li')?.value, 3);
  assert.ok(a.blocks.some((b) => b.text === 'Its continuation.'));
});

test('reader extraction: inline image, audio and trusted embed preserve the surrounding editorial phrasing', () => {
  const a = story('<p>Image lead <img src="/diagram.jpg" alt="Diagram"> image tail.</p><p>Audio lead <audio><source src="/voice.mp3"></audio> audio tail.</p><p>Video lead <iframe src="https://www.youtube.com/embed/story"></iframe> video tail.</p><p>Final paragraph.</p>');
  const text = a.blocks.map((b) => b.text).join(' ');
  for (const phrase of ['Image lead', 'image tail.', 'Audio lead', 'audio tail.', 'Video lead', 'video tail.', 'Final paragraph.']) assert.ok(text.includes(phrase), phrase);
  assert.equal(a.blocks.filter((b) => b.figure).length, 1); assert.equal(a.blocks.filter((b) => b.media).length, 2);
});

test('reader extraction: nested quotation tails and multi-paragraph list continuation retain explicit ownership', () => {
  const a = story('<blockquote>Outer lead.<blockquote>Inner text.</blockquote>Outer tail.</blockquote><ol start="3"><li><p>List lead.</p><p>Second paragraph.</p><ul><li>Nested item.</li></ul>Parent tail.</li><li>Next item.</li></ol>');
  const outer = a.blocks.find((b) => b.text === 'Outer lead.')!, tail = a.blocks.find((b) => b.text === 'Outer tail.')!, inner = a.blocks.find((b) => b.text === 'Inner text.')!;
  assert.equal(outer.quoteId, tail.quoteId); assert.notEqual(inner.quoteId, tail.quoteId);
  const first = a.blocks.find((b) => b.text === 'List lead.')!;
  assert.equal(first.type, 'li'); assert.equal(first.value, 3);
  for (const phrase of ['Second paragraph.', 'Parent tail.']) { const b = a.blocks.find((b) => b.text === phrase)!; assert.equal(b.type, 'p'); assert.equal(b.listId, first.listId); assert.equal(b.level, 0); assert.equal(b.value, 3); }
  assert.equal(a.blocks.find((b) => b.text === 'Nested item.')!.level, 1);
  assert.equal(a.blocks.find((b) => b.text === 'Next item.')!.value, 4);
});

test('reader extraction: different image credits survive adjacent deduplication and list media keeps item ownership', () => {
  const a = story('<figure><img src="/same.jpg"><figcaption>Caption<span class="credit">First credit</span></figcaption></figure><figure><img src="/same.jpg"><figcaption>Caption<span class="credit">Second credit</span></figcaption></figure><ol start="5"><li>Item lead<img src="/list.jpg" alt="List diagram">Item tail<audio src="/item.mp3"></audio>Final tail</li></ol>');
  assert.deepEqual(a.blocks.filter((b) => b.figure && !b.listId).map((b) => b.figure!.credit), ['First credit', 'Second credit']);
  const li = a.blocks.find((b) => b.type === 'li')!;
  for (const b of a.blocks.filter((b) => b.listId)) { assert.equal(b.listId, li.listId); assert.equal(b.level, 0); assert.equal(b.value, 5); }
  assert.ok(a.blocks.some((b) => b.text === 'Final tail' && b.listId === li.listId));
});

test('reader extraction: nested gallery rendition wrappers share media identity and header portraits stay outside the story', () => {
  const a = story('<header><div class="article-header-author-img"><img src="/writer.jpg" alt="Author portrait"></div></header><p>Visual story lead.</p><div class="article-gallery"><div class="gallery-carousel"><figure><img src="/one.jpg?w=1000&amp;dpr=2" alt="First work"><figcaption>First caption.</figcaption></figure><img src="/two.jpg?w=1000&amp;dpr=2" alt="Second work"></div><div class="gallery-thumbnails"><img src="/one.jpg?w=200&amp;dpr=1" alt="one-thumb.jpg"><img src="/two.jpg?w=200&amp;dpr=1" alt="two-thumb.jpg"></div><div class="gallery-fullscreen"><img src="/one.jpg?w=1800&amp;dpr=2" alt="First work"><img src="/two.jpg?w=1800&amp;dpr=2" alt="Second work"></div></div><p>Visual story end.</p>');
  const figures = a.blocks.filter((b) => b.figure);
  assert.equal(figures.length, 2); assert.equal(figures[0]!.figure!.caption, 'First caption.');
  assert.doesNotMatch(JSON.stringify(a), /writer\.jpg|thumb\.jpg/);
  assert.equal(a.blocks.at(-1)?.text, 'Visual story end.');
});

test('reader extraction: source-item identities distinguish media-first unordered siblings and repeated ordered numbers', () => {
  const a = story('<ul><li><img src="/first.jpg">First text.</li><li><audio src="/second.mp3"></audio>Second text.</li></ul><ol><li value="3"><img src="/third.jpg">Third text.</li><li value="3"><img src="/fourth.jpg">Fourth text.</li></ol>');
  assert.equal(a.blocks.filter((b) => b.type === 'li').length, 0, 'media-first items do not emit an extra text item');
  const media = a.blocks.filter((b) => b.figure || b.media);
  assert.equal(new Set(media.map((b) => b.listItemId)).size, 4);
  for (let i = 0; i < a.blocks.length; i += 2) { assert.ok(a.blocks[i]!.listItemId); assert.equal(a.blocks[i]!.listItemId, a.blocks[i + 1]!.listItemId); }
  assert.equal(media[0]!.ordered, undefined); assert.equal(media[1]!.value, undefined);
  assert.equal(media[2]!.value, 3); assert.equal(media[3]!.value, 3); assert.notEqual(media[2]!.listItemId, media[3]!.listItemId);
});

test('reader extraction: entity-encoded structured authors decode once into bounded credits', () => {
  const a = extractArticle('<title>Credits</title><script type="application/ld+json">{"@type":"Article","headline":"Credits","author":[{"name":"Jos&eacute; &amp; Co"},{"name":"https://authors.example/person"}]}</script><article><p>Story.</p></article>', 'https://journal.example/credits');
  assert.equal(a.byline, 'José & Co');
});

test('reader extraction: localized peripheral panels respect explicit bodies, sibling corrections, credits, ratings and source links', () => {
  const a = story('<p>Short deck.</p><section class="article-body"><h2>Most Popular</h2><p>Editorial comparison of popular techniques.</p><h2>About the Author</h2><p>The historical author is the subject of this section.</p><p>Story ending.</p></section><section><h3>About the Author</h3><p>A staff biography belongs to the publisher panel.</p></section><section><h2>Most Popular</h2><a href="/popular"><img src="/popular.jpg"><h3>A popular recommendation.</h3></a></section><div class="post-bottom"><div><p>Sign up for our free newsletter.</p></div><a href="/next"><img src="/next.jpg"><h3>Recommended next story.</h3></a><p class="correction">Correction: the estimate is six.</p><p>Rating: four stars.</p><p>Image credit: Ada.</p><p>Further information: <a href="/source">original measurements</a>.</p></div><div class="player-wrapper"><img src="/album.jpg" alt="Editorial album cover"><div class="merchrow"><img src="/shirt.jpg" alt="Merchandise"></div></div><div class="author-mini-bio"><img src="/portrait.jpg"></div><div class="topic-card"><a href="/topic"><img src="/topic.jpg">A different topic</a></div>');
  const text = a.blocks.map((b) => b.text).join('\n');
  for (const phrase of ['Short deck.', 'Editorial comparison', 'historical author', 'Story ending.', 'Correction:', 'Rating:', 'Image credit:', 'original measurements', 'Editorial album cover']) assert.ok(text.includes(phrase), phrase);
  assert.doesNotMatch(text, /staff biography|popular recommendation|Sign up|Recommended next story|Merchandise|different topic/);
  assert.doesNotMatch(JSON.stringify(a), /popular\.jpg|next\.jpg|shirt\.jpg|portrait\.jpg|topic\.jpg/);
});

test('reader extraction: inferred prose protects styling-only editorial sections and drops separate utility panels or empty shells', () => {
  const paragraph = 'Researchers compared the observation methods over many years. Their field notes describe the conditions under which the instruments were deployed and explain why each independent team repeated the trial before drawing a conclusion.';
  const a = story(`<p>A small standfirst.</p><div class="column"><div class="rich-text"><h2>About the Author</h2><p>${paragraph}</p><h2>Most Popular</h2><p>${paragraph}</p><p>Our conclusion.</p></div></div><section><h3>About the Author</h3><p>A staff writer contributes to the publication.</p></section><div><h2>Most Popular</h2></div><section><h2>Most Popular</h2><a href="/other"><img src="/other.jpg">Unrelated story card.</a></section><section><h2>Further reading</h2><p>Source material: <a href="/notes">field notes</a>.</p></section>`);
  const text = a.blocks.map((b) => b.text).join('\n');
  assert.equal(a.blocks.filter((b) => b.text === paragraph).length, 2);
  assert.equal(a.blocks.filter((b) => b.text === 'Most Popular').length, 1); assert.equal(a.blocks.filter((b) => b.text === 'About the Author').length, 1);
  for (const marker of ['small standfirst', 'Our conclusion.', 'Source material:', 'field notes']) assert.ok(text.includes(marker), marker);
  assert.doesNotMatch(text, /staff writer|Unrelated story card/);
});
