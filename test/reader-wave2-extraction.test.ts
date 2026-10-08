import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractArticle, READER_LIMITS } from '../src/adapters/reader.ts';
const fixture = (name: string) => readFile(new URL(`./fixtures/reader-wave2/${name}.html`, import.meta.url), 'utf8');
const base = 'https://field.example/review';
const text = (a: ReturnType<typeof extractArticle>) => a.blocks.map((block) => block.text).join('\n');

test('wave2 extraction: exact OG headline variant dedupes after matching JSON-LD supplies a shorter headline', async () => {
  const result = extractArticle(await fixture('components'), base);
  assert.equal(result.title, 'A careful field review');
  assert.equal(result.byline, 'Ada Grove');
  assert.doesNotMatch(text(result), /extended festival subtitle/);
  assert.ok(result.blocks.find((b) => b.text.startsWith('FIELDSECTION:')));
  const distinct = extractArticle('<meta property="og:title" content="A careful field review"><article><h1>A careful field review of a different topic</h1><p>An original introduction.</p></article>', base);
  assert.equal(distinct.blocks[0]!.text, 'A careful field review of a different topic', 'prefix similarity never establishes duplicate identity');
});

test('wave2 extraction: input-backed quiz results and SVG-only share toolbar leave without clipping later editorial text', async () => {
  const result = extractArticle(await fixture('components'), base);
  assert.doesNotMatch(text(result), /WIDGET|Share:|Related articles|Field topic|Reviews|Features/);
  for (const marker of ['FIELDLEAD:', 'FIELDSECTION:', 'FIELDEND:', 'Field Rating', '8.5 out of 10']) assert.ok(text(result).includes(marker), marker);
  assert.equal(result.blocks.filter((b) => b.figure).length, 1);
  assert.equal(result.blocks.find((b) => b.figure)?.figure?.caption, 'FIELDCAPTION: The baseline with its original scale.');
  assert.equal(result.blocks.find((b) => b.figure)?.figure?.credit, 'Ada Grove');
});

test('wave2 extraction: editorial share/related/newsletter/quiz sections and grouped illustrated list paragraphs survive', async () => {
  const result = extractArticle(await fixture('editorial'), base);
  for (const marker of ['EDITORIALLEAD:', 'EDITORIALQUIZ:', 'EDITORIALQUIZEND:', 'EDITORIALSHARE:', 'EDITORIALRELATED:', 'EDITORIALNEWSLETTER:', 'GROUPLEAD:', 'GROUPSECOND:', 'GROUPCHART:', 'GROUPCAPTION:', 'GROUPTAIL:', 'GROUPNEXT:', 'EDITORIALEND:']) assert.ok(text(result).includes(marker), marker);
  assert.ok(result.blocks.some((b) => b.type === 'h' && b.text === 'Publication methods'), 'later exact title section survives');
  const grouped = result.blocks.filter((b) => /GROUP(?:LEAD|SECOND|CHART|TAIL):/.test(b.text));
  assert.equal(new Set(grouped.map((b) => b.listItemId)).size, 1);
  assert.equal(grouped[0]!.value, 4);
  assert.equal(result.blocks.find((b) => b.text.startsWith('GROUPNEXT:'))!.value, 8);
});

test('wave2 extraction: names alone or a single control never establish a removable interactive panel', () => {
  for (const attrs of ['class="quiz"', 'class="survey"', 'class="poll"', 'class="social-buttons"']) {
    const result = extractArticle(`<article><section ${attrs}><h2>Editorial heading</h2><input type="radio"><p>CONTROL: A retained editorial observation with only a single input.</p></section></article>`, base);
    assert.ok(text(result).includes('CONTROL:'), attrs);
  }
  const unlabelled = extractArticle('<article><div><input type="radio"><input type="radio"><p>UNLABELLED: No component identity to justify deleting this content.</p></div></article>', base);
  assert.ok(text(unlabelled).includes('UNLABELLED:'));
});

test('wave2 extraction: docs preserve component examples, code, callouts, and tables', () => {
  const html = '<title>Widget API</title><main><div class="quiz"><input type="radio"><input type="radio"><h2>Share:</h2><p>DOCEXAMPLE: A quiz component result example.</p></div><div class="social-buttons"><h2>Sharing tools</h2><p>DOCSHARE: Use a <a href="https://www.facebook.com/dialog/share">share endpoint</a>.</p></div><pre><code class="language-js">const quiz = { enabled: true };</code></pre><div class="admonition warning"><p class="admonition-title">Warning</p><p>DOCCALLOUT: Controls require event handlers.</p></div><table><tr><th>Parameter</th><th>Default</th></tr><tr><td>enabled</td><td>true</td></tr></table></main>';
  const result = extractArticle(html, base, READER_LIMITS, { mode: 'docs' });
  for (const marker of ['DOCEXAMPLE:', 'DOCSHARE:', 'DOCCALLOUT:']) assert.ok(text(result).includes(marker));
  assert.ok(result.blocks.find((b) => b.type === 'pre' && b.lang === 'js'));
  assert.ok(result.blocks.find((b) => b.type === 'callout' && b.label === 'Warning'));
  assert.deepEqual(result.blocks.find((b) => b.type === 'table')?.columns, ['Parameter', 'Default']);
});

test('wave2 extraction: deeply nested quiz controls remain bounded and preserve sibling content without executable URLs', () => {
  const html = '<article><div class="quiz"><input type="radio"><input type="radio">' + '<div>'.repeat(2000) + '<p>WIDGETDEEP: hidden result</p>' + '</div>'.repeat(2000) + '</div><p>SECURETAIL: <a href="javascript:alert(1)">A safe result</a>.</p></article>';
  const result = extractArticle(html, base, { blocks: 2, totalChars: 100 });
  assert.doesNotMatch(text(result), /WIDGETDEEP/);
  assert.ok(text(result).includes('SECURETAIL:'));
  assert.ok(result.blocks.length <= 2);
  assert.ok(result.blocks.every((b) => b.text.length <= READER_LIMITS.blockChars && !b.spans?.some((s) => s.href?.startsWith('javascript:'))));
});


test('wave2 extraction: input examples do not delete explicit body containers carrying a quiz class', () => {
  for (const body of ['class="article-body quiz"', 'class="quiz" itemprop="articleBody"']) {
    const result = extractArticle(`<article><div ${body}><input type="radio"><input type="radio"><p>EXPLICITLEAD: This editorial article explains how researchers design a quiz instrument to measure knowledge and compare recall between groups.</p><p>EXPLICITEND: These controls are illustrative examples within the declared body, followed by the conclusion and discussion of the measured differences.</p></div></article>`, base);
    for (const marker of ['EXPLICITLEAD:', 'EXPLICITEND:']) assert.ok(text(result).includes(marker), body);
  }
  const enclosing = extractArticle('<article><section class="quiz"><input type="radio"><input type="radio"><div itemprop="articleBody"><p>EXPLICITNESTED: A widget-looking outer class cannot swallow a declared body subtree.</p></div></section></article>', base);
  assert.ok(text(enclosing).includes('EXPLICITNESTED:'));
});
