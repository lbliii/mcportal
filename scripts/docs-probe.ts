/**
 * Live check of docs sites (needs network): which table of contents each one has,
 * how big it is, and how its pages read. Run it from a laptop and from the server
 * before a site goes into a starter pack; some sites treat cloud servers differently.
 *
 *   node scripts/docs-probe.ts                          # the starter pack and its alternates
 *   node scripts/docs-probe.ts docs.stripe.com zod.dev  # any sites
 *   node scripts/docs-probe.ts --json …                 # machine-readable
 */
import { fetchDocPage, loadDocs, resolveDocs, type DocSite } from '../src/adapters/docs.ts';
import { safeFetch } from '../src/lib/safe-fetch.ts';

const DEFAULT_SITES = [
  // the Developer docs pack
  'docs.stripe.com', 'docs.railway.com', 'docs.python.org/3', 'nextjs.org/docs',
  // alternates
  'react.dev', 'docs.expo.dev', 'developers.cloudflare.com', 'docs.pydantic.dev/latest',
  'docs.astral.sh/uv', 'docs.djangoproject.com/en/stable', 'modelcontextprotocol.io',
  // known gaps
  'docs.astro.build', 'tailwindcss.com', 'fastapi.tiangolo.com',
];
const SAMPLE_PAGES = 2;

interface Row {
  site: string;
  toc?: string;
  title?: string;
  sections?: number;
  pages?: number;
  symbols?: number;
  samples: Array<{ url: string; route?: string; words?: number; error?: string }>;
  error?: string;
  ms: number;
}

/** A few pages spread through the site, skipping nested indexes. */
function samplePages(site: DocSite): Array<{ title: string; url: string }> {
  const pages = site.sections.flatMap((s) => s.pages).filter((p) => !p.index);
  if (!pages.length) return [];
  const step = Math.max(1, Math.floor(pages.length / SAMPLE_PAGES));
  return Array.from({ length: Math.min(SAMPLE_PAGES, pages.length) }, (_, i) => pages[Math.min(pages.length - 1, i * step + Math.floor(step / 2))]!);
}

async function probe(input: string): Promise<Row> {
  const started = Date.now();
  const row: Row = { site: input, samples: [], ms: 0 };
  try {
    const site = await resolveDocs(input, safeFetch);
    Object.assign(row, {
      toc: `${site.toc.kind} ${site.toc.url}`,
      title: site.title,
      sections: site.sections.length,
      pages: site.sections.reduce((n, s) => n + s.pages.length, 0),
      symbols: site.symbols?.length,
    });
    // A site of nested indexes (Cloudflare): sample the first one's pages instead.
    const nested = site.sections.flatMap((s) => s.pages).every((p) => p.index) && site.sections[0]?.pages[0];
    const sampled = nested ? await loadDocs({ kind: 'llms', url: nested.url }, safeFetch) : site;
    if (nested) row.toc += ` → ${nested.url}`;
    for (const page of samplePages(sampled)) {
      try {
        const read = await fetchDocPage(page.url, safeFetch, { title: page.title });
        row.samples.push({ url: page.url, route: read.route, words: read.wordCount });
      } catch (error) {
        row.samples.push({ url: page.url, error: (error as Error).message });
      }
    }
  } catch (error) {
    row.error = (error as Error).message;
  }
  row.ms = Date.now() - started;
  return row;
}

const args = process.argv.slice(2);
const json = args.includes('--json');
const sites = args.filter((a) => a !== '--json');
const rows: Row[] = [];
for (const site of sites.length ? sites : DEFAULT_SITES) {
  const row = await probe(site);
  rows.push(row);
  if (!json) {
    const head = row.error
      ? `✖ ${row.site}: ${row.error}`
      : `✔ ${row.site}: "${row.title}" via ${row.toc} · ${row.sections} sections, ${row.pages} pages${row.symbols ? `, ${row.symbols} symbols` : ''}`;
    console.log(`${head} (${row.ms} ms)`);
    for (const s of row.samples) console.log(`    ${s.error ? '✖' : '·'} ${s.url} → ${s.error ?? `${s.route}, ${s.words} words`}`);
  }
}
if (json) console.log(JSON.stringify(rows, null, 2));
const failed = rows.filter((r) => r.error || r.samples.some((s) => s.error));
if (!json) console.log(`\n${rows.length - failed.length}/${rows.length} sites fully readable.`);
