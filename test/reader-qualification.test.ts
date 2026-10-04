import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { extractArticle, READER_LIMITS } from '../src/adapters/reader.ts';
import { auditSample, qualityFlags, sourceShape } from '../scripts/reader-audit.ts';

const base = 'https://holdout.example/story';
const fixture = (name: string) => readFile(new URL(`./fixtures/reader-qualification/${name}.html`, import.meta.url), 'utf8');
const content = (result: ReturnType<typeof extractArticle>) => result.blocks.map((block) => block.text).join('\n');

test('qualification: all sibling story sections survive while nested publisher components leave', async () => {
  const result = extractArticle(await fixture('sibling-story'), base);
  const text = content(result);
  for (const marker of ['DECK:', 'OPENING:', 'MIDDLE:', 'RELATEDPROSE:', 'SHAREPROSE:', 'ENDING:', 'CORRECTION:', 'RATING:', 'EDITORIALLINK:']) assert.ok(text.includes(marker), marker);
  assert.ok(!text.includes('WIDGET'), 'component context removes biography/signup/recommendation without a global word cutoff');
  assert.deepEqual(result.blocks.filter((block) => block.type === 'h').map((block) => block.text), ['Related measurements', 'Share of the sample', 'What comes next']);
  assert.ok(result.blocks.some((block) => block.spans?.some((span) => span.href === 'https://holdout.example/measurements')));
});

test('qualification: nested inline marks coexist and authored breaks keep plain-text continuity', async () => {
  const result = extractArticle(await fixture('inline-lists'), base);
  const marked = result.blocks.find((block) => block.text.startsWith('MARKS:'))!.spans?.find((span) => span.text.includes('marked sample'));
  assert.ok(marked?.strong && marked.em && marked.code);
  assert.equal(marked.href, 'https://holdout.example/notes');
  const breaks = result.blocks.find((block) => block.text.startsWith('BREAKS:'))!;
  assert.ok(breaks.spans?.filter((span) => span.breakBefore).length === 2);
  for (const line of ['First observation', 'new observation', 'Third observation']) assert.ok(breaks.text.includes(line));
  assert.ok(!content(result).includes('&eacute;'));
  assert.match(content(result), /élan — B … C © D ≂̸ E/);
});

test('qualification: ordered starts, explicit values, list groups and parent suffix are preserved', async () => {
  const result = extractArticle(await fixture('inline-lists'), base);
  const items = result.blocks.filter((block) => block.type === 'li');
  const outer = items.find((block) => block.text.startsWith('OUTERFIRST:'))!;
  const inner = items.find((block) => block.text.startsWith('INNERFIRST:'))!;
  const innerSecond = items.find((block) => block.text.startsWith('INNERSECOND:'))!;
  const outerSecond = items.find((block) => block.text.startsWith('OUTERSECOND:'))!;
  const separate = items.find((block) => block.text.startsWith('NEWGROUP:'))!;
  assert.ok(outer.ordered && inner.ordered && separate.ordered);
  assert.equal(outer.level, 0); assert.equal(inner.level, 1);
  assert.equal(outer.listStart, 3); assert.equal(inner.listStart, -1); assert.equal(separate.listStart, 0);
  assert.equal(innerSecond.value, 4); assert.equal(outerSecond.value, 9);
  assert.ok(outer.listId && inner.listId && separate.listId);
  assert.equal(outer.listId, outerSecond.listId);
  assert.equal(inner.listId, innerSecond.listId);
  assert.notEqual(outer.listId, inner.listId); assert.notEqual(outer.listId, separate.listId);
  assert.ok(content(result).includes('OUTERTAIL:'), 'text following a nested list remains editorial content');
  assert.ok(content(result).includes('PLATFORMS:'), 'ordinary editorial link lists survive');
});

test('qualification: source quotation identity joins paragraphs without merging neighboring quotes', async () => {
  const result = extractArticle(await fixture('quotes'), base);
  const quotes = result.blocks.filter((block) => block.type === 'quote');
  const first = quotes.find((block) => block.text.includes('QUOTEONE:'))!;
  const second = quotes.find((block) => block.text.includes('QUOTETWO:'))!;
  const third = quotes.find((block) => block.text.includes('QUOTETHREE:'))!;
  assert.ok(first.quoteId); assert.equal(first.quoteId, second.quoteId); assert.notEqual(first.quoteId, third.quoteId);
  for (const marker of ['BEFORE:', 'BETWEEN:', 'AFTER:', 'FIRSTCREDIT:']) assert.ok(content(result).includes(marker), marker);
});

test('qualification: article graph metadata wins over unrelated site objects and later section titles survive', async () => {
  const result = extractArticle(await fixture('metadata'), base);
  assert.ok(result.byline);
  assert.ok(result.byline.includes('Mira Vale') && result.byline.includes('Jo Elm'));
  assert.ok(!/Wrong Person|Wrong Article Author/.test(result.byline));
  assert.equal(result.publishedAt, '2026-09-30T12:00:00.000Z');
  assert.equal(result.updatedAt, '2026-10-01T13:00:00.000Z');
  assert.equal(result.blocks.filter((block) => block.type === 'h' && block.text === 'The observatory’s shared sky').length, 1, 'only the leading headline is redundant');
  assert.ok(content(result).includes('LEAD:') && content(result).includes('LAST:'));
});

test('qualification: absent, invalid and unrelated metadata stays absent', () => {
  const result = extractArticle('<title>Small story</title><meta property="article:published_time" content="not-a-date"><script type="application/ld+json">{"@type":"Organization","author":{"name":"Wrong Person"}}</script><article><p>MISSING: There is no credited author or date.</p></article>', base);
  assert.equal(result.byline, undefined); assert.equal(result.publishedAt, undefined); assert.equal(result.updatedAt, undefined);
  assert.equal(result.siteName, 'holdout.example');
  assert.ok(content(result).includes('MISSING:'));
});

test('qualification: docs mode preserves related guidance, signature, code, table and callout', async () => {
  const result = extractArticle(await fixture('docs'), base, READER_LIMITS, { mode: 'docs' });
  for (const marker of ['DOCLEAD:', 'DOCRELATED:', 'DOCSIGNATURE:', 'DOCWARNING:', 'DOCEND:']) assert.ok(content(result).includes(marker), marker);
  assert.equal(result.blocks.find((block) => block.id === 'sample.run')?.type, 'h');
  assert.equal(result.blocks.find((block) => block.type === 'pre')?.text, 'result = sample.run(values)\nprint(result)');
  const table = result.blocks.find((block) => block.type === 'table')!;
  assert.deepEqual(table.columns, ['Argument', 'Default']); assert.deepEqual(table.rows, [['depth', '3'], ['mode', 'safe']]);
  assert.equal(result.blocks.find((block) => block.type === 'callout')?.tone, 'warning');
});

test('qualification: separate figures with identical captions keep identity and an embed has a safe fallback', async () => {
  const result = extractArticle(await fixture('figures'), base);
  const figures = result.blocks.filter((block) => block.figure);
  assert.deepEqual(figures.map((block) => block.figure!.url), ['https://holdout.example/images/first.png', 'https://holdout.example/images/second.png']);
  assert.ok(figures.every((block) => block.text.includes('SAMECAPTION:')));
  assert.ok(figures[0]!.text.includes('Image: Mira Vale'), 'credit remains readable with the figure');
  assert.equal(figures[0]!.figure!.width, 800); assert.equal(figures[0]!.figure!.height, 600);
  assert.ok(content(result).includes('VISUALLEAD:') && content(result).includes('VISUALEND:'));
  assert.ok(result.blocks.some((block) => block.media?.kind === 'video' && block.media.url.startsWith('https://www.youtube.com/')));
  assert.ok(!JSON.stringify(result).includes('javascript:'));
});

test('qualification: malformed source preserves complete paragraphs without raw executable content', async () => {
  const result = extractArticle(await fixture('malformed'), base);
  for (const marker of ['RECOVERFIRST:', 'RECOVERSECOND:', 'RECOVERTHIRD:']) assert.ok(content(result).includes(marker), marker);
  assert.ok(!/IGNORESCRIPT|IGNORESTYLE|<strong>/.test(content(result)));
});

test('qualification: hostile source output honors input, block, table and character caps', () => {
  const html = '<article>' + '<div>'.repeat(4000) + Array.from({ length: 1500 }, (_, n) => `<p>ROW${n}: ${'word '.repeat(100)}</p>`).join('') + '</article>';
  const result = extractArticle(html, base, { blocks: 12, totalChars: 1800 });
  assert.ok(result.blocks.length <= 12);
  assert.ok(result.blocks.reduce((sum, block) => sum + block.text.length, 0) <= 1800);
  assert.ok(result.blocks.every((block) => block.text.length <= READER_LIMITS.blockChars));
  const clipped = extractArticle('<article><p>FIRST: Keep me.</p>' + ' '.repeat(READER_LIMITS.inputBytes) + '<p>BEYONDCAP: Do not parse me.</p></article>', base);
  assert.ok(content(clipped).includes('FIRST:')); assert.ok(!content(clipped).includes('BEYONDCAP:'));
});


test('qualification: table dimensions stay bounded without manufacturing executable markup', () => {
  const row = '<tr>' + Array.from({ length: 55 }, (_, n) => `<td>cell-${n}</td>`).join('') + '</tr>';
  const result = extractArticle('<main><table>' + row.repeat(600) + '</table></main>', base, READER_LIMITS, { mode: 'docs' });
  const table = result.blocks.find((block) => block.type === 'table')!;
  assert.ok(table.columns!.length <= READER_LIMITS.tableColumns);
  assert.ok(table.rows!.length <= READER_LIMITS.tableRows);
  assert.ok(table.rows!.every((cells) => cells.length <= READER_LIMITS.tableColumns && cells.every((cell) => cell.length <= READER_LIMITS.cellChars)));
});

test('qualification: audit diagnostics distinguish source hints from article guarantees', () => {
  const shape = sourceShape('<nav><figure><img src="/ui.png"></figure></nav><article><p>Good prose.</p></article>');
  assert.equal(shape.counts.figure, 1);
  assert.deepEqual(qualityFlags('Story', [{ type: 'p', text: 'Good prose.' }], shape, 'article'), ['source-figure-without-rendered-figure']);
  assert.ok(qualityFlags('Story', [], shape, 'article').includes('empty-content'));
  assert.ok(!qualityFlags('Story', [{ type: 'p', text: 'Lead' }, { type: 'h', text: 'Story' }], sourceShape(''), 'article').includes('possible-leading-duplicate-title'));
  assert.ok(qualityFlags('Story', [{ type: 'h', text: 'Story' }], sourceShape(''), 'article').includes('possible-leading-duplicate-title'));
});


test('qualification: live audit records blocked, truncated and failed fetches explicitly', async () => {
  const sample = { source: 'Synthetic', url: base, mode: 'article' as const, corpus: 'holdout' as const };
  const response = { url: base, contentType: 'text/html', text: '<title>Story</title><article><p>A retained paragraph.</p></article>', truncated: false };
  const blocked = await auditSample(sample, 1000, async () => ({ ...response, status: 403 }));
  assert.equal(blocked.outcome, 'blocked'); assert.equal(blocked.httpStatus, 403);
  const truncated = await auditSample(sample, 1000, async () => ({ ...response, status: 200, truncated: true }));
  assert.equal(truncated.outcome, 'truncated'); assert.equal(truncated.fetchTruncated, true);
  assert.equal(truncated.manualCompletenessVerified, false);
  const failed = await auditSample(sample, 1000, async () => { throw Object.assign(new Error('upstream secret'), { code: 'fetch_timeout' }); });
  assert.equal(failed.outcome, 'fetch-error'); assert.equal(failed.errorCode, 'fetch_timeout');
  assert.ok(!JSON.stringify(failed).includes('upstream secret'), 'errors never echo upstream text');
});

test('qualification: a main-only story keeps repeated sibling content wrappers and a short deck', () => {
  const result = extractArticle('<title>The field report</title><main><div class="standfirst"><p>MAINDECK: Several teams share an instrument.</p></div><section class="post-content"><p>MAINOPENING: The first team starts a careful observation and logs every change in the sky.</p><p>MAINMIDDLE: Longer discussion of the measurements compares three independent trials and explains why each difference matters.</p></section><section class="post-content"><p>MAINENDING: The final team repeats the test tomorrow.</p></section><div class="related-posts"><p>MAINWIDGET: Read about a different project.</p></div></main>', base);
  for (const marker of ['MAINDECK:', 'MAINOPENING:', 'MAINMIDDLE:', 'MAINENDING:']) assert.ok(content(result).includes(marker), marker);
  assert.ok(!content(result).includes('MAINWIDGET:'));
});
