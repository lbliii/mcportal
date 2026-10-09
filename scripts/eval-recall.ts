/** Frozen synthetic retrieval benchmark. Never fetches source pages. */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, cpus, platform, arch } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Accounts, makeBootstrap } from '../src/accounts.ts';
import { AuthStore } from '../src/auth/store.ts';
import { buildClip, clipText, type ClipKind } from '../src/clips.ts';
import { connect, ensureSchema, PgProfileStore, PgClipStore, PgReadingStore, type Queryable } from '../src/db.ts';
import { FileClipStore } from '../src/clips.ts';
import { FileReadingStore } from '../src/reading.ts';
import { FileProfileStore } from '../src/store.ts';
import { defaultProfile } from '../src/profile.ts';
import { searchLibrary, type LibraryQuery, type LibrarySources, type LibraryResult } from '../src/library.ts';
import { memoryPersistence } from '../src/lib/document.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { StateClient } from '../src/link/client.ts';
import { linkedStores } from '../src/link/stores.ts';
import { startApp } from '../test/helpers.ts';
import type { PassageLocator } from '../src/evidence.ts';

interface Case { id: string; split: string; type: string; query: string; expected: string | null; indexed: boolean; passage?: string; options?: LibraryQuery }
interface Corpus {
  saved: Array<{ key: string; url: string; title: string; note: string }>;
  clips: Array<{ key: string; kind: ClipKind; title: string; text: string; url?: string; tags?: string[]; note?: string; locator?: PassageLocator }>;
  history: Array<{ url: string; title: string; status: 'opened' | 'seen' }>;
  privateClip: { title: string; text: string };
}
const directory = new URL('../evals/recall/', import.meta.url);
const raw = await readFile(new URL('corpus.json', directory), 'utf8');
const queryRaw = await readFile(new URL('queries.json', directory), 'utf8');
const corpus = JSON.parse(raw) as Corpus;
const cases = JSON.parse(queryRaw) as Case[];
const date = new Date('2026-10-09T12:00:00Z');
const user = 'github-42';
const refs = new Map<string, string>();
async function seed(stores: LibrarySources) {
  await stores.store.put(user, { ...defaultProfile(date), saved: corpus.saved.map(({ key, ...s }) => {
    refs.set(key, `url:${s.url}`); return { ...s, savedAt: date.toISOString() };
  }) });
  for (const [i, c] of corpus.clips.entries()) {
    const text = c.text.replace('PLACEHOLDER', 'Background paragraph. '.repeat(90));
    const clip = buildClip({ kind: c.kind, title: c.title, text, markdown: text, tags: c.tags, note: c.note,
      source: c.url ? { kind: 'article', url: c.url, ...(c.locator ? { locator: c.locator } : {}) } : { kind: 'manual' } }, date, `cl_benchmark_${i}`);
    const saved = await stores.clips!.add(user, clip);
    refs.set(c.key, `clip:${saved.id}`);
  }
  for (const [i, h] of corpus.history.entries()) {
    await stores.reading!.record(user, h); refs.set(`history:${i}`, `url:${h.url.split('#')[0]}`);
  }
  await stores.clips!.add('github-7', buildClip({ kind: 'note', title: corpus.privateClip.title, markdown: corpus.privateClip.text }, date, 'cl_private'));
}
async function measure(mode: string, search: (q: LibraryQuery) => Promise<LibraryResult>, sources: LibrarySources) {
  const results: Array<{ id: string; split: string; type: string; indexed: boolean; topFive: boolean; topOne: boolean; passageReturned: boolean | null; ms: number; refs: string[] }> = [];
  for (const c of cases) {
    const begin = performance.now();
    const result = await search({ ...c.options, query: c.query, limit: 5 });
    const ms = performance.now() - begin;
    const expected = c.expected ? refs.get(c.expected) : undefined;
    const found = expected ? result.hits.find(h => h.ref === expected) : undefined;
    let passageReturned: boolean | null = null;
    if (c.passage) {
      // A separate authorized get_clip is required: an index hit is not itself a passage return.
      const clip = found?.clipId ? await sources.clips!.get(user, found.clipId) : undefined;
      passageReturned = Boolean(clip && clipText(clip.data).includes(c.passage));
    }
    results.push({ id: c.id, split: c.split, type: c.type, indexed: c.indexed,
      topFive: expected ? Boolean(found) : result.total === 0, topOne: expected ? result.hits[0]?.ref === expected : result.total === 0,
      passageReturned, ms: Number(ms.toFixed(3)), refs: result.hits.map(h => h.ref) });
  }
  const groups = [...new Set(results.map(r => `${r.split}/${r.type}`))].map(group => {
    const rows = results.filter(r => `${r.split}/${r.type}` === group);
    return { group, passed: rows.filter(r => r.topFive).length, total: rows.length, passages: rows.filter(r => r.passageReturned === true).length, passageCases: rows.filter(r => r.passageReturned !== null).length };
  });
  const times = results.map(r => r.ms).sort((a, b) => a - b);
  return { mode, groups, p50Ms: times[Math.floor(times.length * .5)], p95Ms: times[Math.floor(times.length * .95)], results };
}
const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-recall-eval-'));
const sources = { store: new FileProfileStore(dir), clips: new FileClipStore(dir), reading: new FileReadingStore(dir) };
let db: Queryable | undefined, admin: Queryable | undefined;
const schema = `recall_eval_${process.pid}_${Date.now()}`;
try {
  await seed(sources);
  const modes = [await measure('files', q => searchLibrary(user, q, sources), sources)];
  const authPersistence = memoryPersistence();
  const app = await startApp({ github: { clientId: 'fixture', clientSecret: 'fixture' } }, createFixtureFetcher(), {
    ...sources, authPersistence, accounts: new Accounts(memoryPersistence(), makeBootstrap([], [])),
  });
  try {
    const tokens = await new AuthStore(authPersistence).issueTokens({ userId: user, githubId: 42, login: 'fixture' }, 'mcpc_fixture', 'http://localhost/mcp', 'mcportal');
    const linked = linkedStores(new StateClient({ server: app.base, auth: { token: async () => tokens.access_token, refresh: async () => undefined } }), user);
    modes.push(await measure('linked-files', q => linked.library.search(user, q), linked));
  } finally { await app.close(); }
  if (process.env.TEST_DATABASE_URL) {
    admin = await connect(process.env.TEST_DATABASE_URL);
    await admin.query(`CREATE SCHEMA ${schema}`);
    db = await connect(process.env.TEST_DATABASE_URL, { searchPath: schema });
    await ensureSchema(db);
    const pg = { store: new PgProfileStore(db), clips: new PgClipStore(db), reading: new PgReadingStore(db) };
    await seed(pg);
    modes.push(await measure('postgres', q => searchLibrary(user, q, pg), pg));
  }
  const report = { at: new Date().toISOString(), node: process.version, os: `${platform()} ${arch()}`, cpu: cpus()[0]?.model,
    corpusSha256: createHash('sha256').update(raw).digest('hex'), queriesSha256: createHash('sha256').update(queryRaw).digest('hex'),
    corpus: { saved: corpus.saved.length, clips: corpus.clips.length, history: corpus.history.length, privateClips: 1 },
    protocol: '40 synthetic cases frozen before ranking changes; 24 development, 16 heldout; sequential cold-first then warm reads. Passage return requires authorized clip retrieval; source pages are never fetched. Negative correctness is separate from indexed coverage. No human-study claim.',
    modes };
  const output = process.argv[2];
  if (output) await writeFile(output, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, modes: modes.map(m => ({ mode: m.mode, passed: m.results.filter(r => r.topFive).length, total: m.results.length, p50Ms: m.p50Ms, p95Ms: m.p95Ms, failures: m.results.filter(r => !r.topFive).map(r => r.id) })) }, null, 2));
} finally {
  await db?.end?.();
  if (admin) { await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end?.(); }
  await rm(dir, { recursive: true, force: true });
}
