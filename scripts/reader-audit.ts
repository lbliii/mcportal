/** Bounded live qualification. Run: node scripts/reader-audit.ts --only holdout --output reports/reader-qualification-live.json */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractArticle, READER_LIMITS } from '../src/adapters/reader.ts';
import { parseAttrs, tokenize } from '../src/lib/html.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';
import type { ArticleBlock, Fetcher } from '../src/types.ts';

export interface Sample { source: string; url: string; mode: 'article' | 'docs'; corpus: 'original' | 'holdout' }
const HOLDOUTS: Sample[] = [
  { source: 'NASA Science', url: 'https://science.nasa.gov/missions/webb/nasas-webb-hubble-combine-to-create-most-colorful-view-of-universe/', mode: 'article', corpus: 'holdout' },
  { source: 'The Guardian', url: 'https://www.theguardian.com/food/2026/oct/03/nitrite-free-bacon-sales-consumers-health-risks', mode: 'article', corpus: 'holdout' },
  { source: 'Ars Technica', url: 'https://arstechnica.com/science/2026/10/research-roundup-6-cool-science-stories-we-almost-missed-6/', mode: 'article', corpus: 'holdout' },
  { source: 'MDN', url: 'https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/map', mode: 'docs', corpus: 'holdout' },
];

/** Whole-response template hints are diagnostics, never an expected number of article blocks. */
export function sourceShape(html: string) {
  const counts: Record<string, number> = {};
  const containers = new Map<string, number>();
  for (const token of tokenize(html.slice(0, READER_LIMITS.inputBytes))) {
    if (token.kind !== 'open') continue;
    if (['article', 'main', 'p', 'br', 'strong', 'em', 'ol', 'ul', 'blockquote', 'figure', 'figcaption', 'iframe', 'pre', 'table'].includes(token.name)) counts[token.name] = (counts[token.name] ?? 0) + 1;
    if (['article', 'main', 'div', 'section'].includes(token.name)) {
      const attrs = parseAttrs(token.attrs);
      for (const hint of `${attrs.class ?? ''} ${attrs.id ?? ''}`.split(/\s+/)) {
        if (/^[a-zA-Z][\w-]{0,60}$/.test(hint) && /article|body|content|related|newsletter|signup|byline|author|caption/i.test(hint)) containers.set(hint, (containers.get(hint) ?? 0) + 1);
      }
    }
  }
  return { counts, containerHints: [...containers].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([hint, count]) => ({ hint, count })) };
}

const normalize = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();
export function qualityFlags(title: string, blocks: ArticleBlock[], shape: ReturnType<typeof sourceShape>, mode: Sample['mode']): string[] {
  const flags: string[] = [];
  if (!blocks.length) flags.push('empty-content');
  if (blocks[0]?.type === 'h' && normalize(blocks[0].text) === normalize(title)) flags.push('possible-leading-duplicate-title');
  if (blocks.some((block) => /(?:subscribe to (?:our|the)|sign up for (?:our|the)|recaptcha|privacy policy and terms|about the author|most popular|related articles)/i.test(block.text))) flags.push('possible-publisher-ui');
  if (blocks.some((block) => /&(?:[a-z][a-z0-9]{1,31}|#x?[0-9a-f]+);/i.test(block.text))) flags.push('possible-undecoded-entity');
  if ((shape.counts.br ?? 0) > 0 && !blocks.some((block) => block.spans?.some((span) => span.breakBefore))) flags.push('source-br-without-rendered-breaks');
  if (((shape.counts.strong ?? 0) + (shape.counts.em ?? 0)) > 0 && !blocks.some((block) => block.spans?.some((span) => span.strong || span.em))) flags.push('source-emphasis-without-rendered-marks');
  if ((shape.counts.figure ?? 0) > 0 && !blocks.some((block) => block.figure)) flags.push('source-figure-without-rendered-figure');
  if (mode === 'docs' && (shape.counts.pre ?? 0) > 0 && !blocks.some((block) => block.type === 'pre')) flags.push('docs-code-missing');
  if (mode === 'docs' && (shape.counts.table ?? 0) > 0 && !blocks.some((block) => block.type === 'table')) flags.push('docs-table-missing');
  return flags;
}

function option(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
}
function boundedOption(name: string, fallback: number, max: number): number {
  const value = option(name);
  if (value === undefined) return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > max) throw new Error(`${name} must be an integer between 1 and ${max}`);
  return number;
}
async function samples(): Promise<Sample[]> {
  const only = option('--only') ?? 'all';
  if (!['all', 'original', 'holdout'].includes(only)) throw new Error('--only must be all, original or holdout');
  if (only === 'holdout') return HOLDOUTS;
  const input: unknown = JSON.parse(await readFile(new URL('../reports/reader-audit-2026-10-03/sample-summary.json', import.meta.url), 'utf8'));
  if (!Array.isArray(input)) throw new Error('Expected audit sample array');
  const original: Sample[] = input.map((row: unknown) => {
    if (!row || typeof row !== 'object' || !('source' in row) || typeof row.source !== 'string' || !('url' in row) || typeof row.url !== 'string') throw new Error('Invalid audit sample');
    const url = new URL(row.url);
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Invalid audit URL');
    return { source: row.source, url: url.href, mode: 'article', corpus: 'original' };
  });
  return only === 'original' ? original : [...original, ...HOLDOUTS];
}
export async function auditSample(sample: Sample, timeoutMs: number, fetcher: Fetcher = safeFetch): Promise<Record<string, unknown>> {
  const started = performance.now();
  try {
    const response = await fetcher(sample.url, { timeoutMs, maxBytes: READER_LIMITS.inputBytes, truncate: true, headers: { accept: 'text/html,application/xhtml+xml;q=0.9' } });
    const common = { ...sample, httpStatus: response.status, finalUrl: response.url, fetchTruncated: response.truncated, inputBytes: Buffer.byteLength(response.text), durationMs: Math.round(performance.now() - started) };
    if (response.status < 200 || response.status >= 300) {
      return { ...common, outcome: [401, 403, 429].includes(response.status) ? 'blocked' : 'http-error' };
    }
    if (response.contentType && !/html|xml|text\/plain/i.test(response.contentType)) {
      return { ...common, outcome: 'unsupported-content-type' };
    }
    const shape = sourceShape(response.text);
    const article = extractArticle(response.text, response.url, READER_LIMITS, { mode: sample.mode });
    const blocks = article.blocks;
    const outputChars = blocks.reduce((sum, block) => sum + block.text.length, 0);
    const atOutputLimit = blocks.length >= READER_LIMITS.blocks || outputChars >= READER_LIMITS.totalChars || blocks.some((block) => block.text.length >= READER_LIMITS.blockChars);
    const inputParserCapped = response.text.length > READER_LIMITS.inputBytes;
    return { ...common, outcome: response.truncated || inputParserCapped || atOutputLimit ? 'truncated' : blocks.length ? 'extracted' : 'empty', inputParserCapped, outputAtLimit: atOutputLimit,
      metadata: { title: article.title, siteName: article.siteName ?? null, byline: article.byline ?? null, publishedAt: article.publishedAt ?? null, updatedAt: article.updatedAt ?? null },
      counts: { words: article.wordCount, outputChars, blocks: blocks.length, headings: blocks.filter((block) => block.type === 'h').length, paragraphs: blocks.filter((block) => block.type === 'p').length, listItems: blocks.filter((block) => block.type === 'li').length, quotes: blocks.filter((block) => block.type === 'quote').length, figures: blocks.filter((block) => block.figure).length, media: blocks.filter((block) => block.media).length, tables: blocks.filter((block) => block.type === 'table').length, code: blocks.filter((block) => block.type === 'pre').length, markedSpans: blocks.flatMap((block) => block.spans ?? []).filter((span) => span.strong || span.em).length, breaks: blocks.flatMap((block) => block.spans ?? []).filter((span) => span.breakBefore).length },
      sourceShape: shape, qualityFlags: qualityFlags(article.title, blocks, shape, sample.mode), manualCompletenessVerified: false };
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown';
    return { ...sample, outcome: code === 'fetch_blocked' ? 'blocked' : 'fetch-error', errorCode: code, durationMs: Math.round(performance.now() - started) };
  }
}

async function run() {
  const timeoutMs = boundedOption('--timeout-ms', 8000, 15_000);
  const limit = boundedOption('--limit', 24, 32);
  const corpus = (await samples()).slice(0, limit);
  const startedAt = new Date().toISOString();
  const results: Record<string, unknown>[] = new Array(corpus.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(3, corpus.length) }, async () => {
    for (;;) {
      const index = next++;
      const sample = corpus[index];
      if (!sample) return;
      results[index] = await auditSample(sample, timeoutMs);
    }
  }));
  const output = { startedAt, finishedAt: new Date().toISOString(), limits: { samples: limit, timeoutMs, concurrency: 3, ...READER_LIMITS }, method: 'safeFetch then extractArticle, bypassing cache; whole-response hints and heuristic flags need human review; counts are not completeness evidence; no publisher HTML or article body is saved', results };
  const outputPath = option('--output');
  if (outputPath) await writeFile(resolve(outputPath), JSON.stringify(output, null, 2) + '\n');
  else process.stdout.write(JSON.stringify(output, null, 2) + '\n');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await run();
}
