import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { Accounts, makeBootstrap } from '../../src/accounts.ts';
import { AuthStore } from '../../src/auth/store.ts';
import { FileClipStore } from '../../src/clips.ts';
import { memoryPersistence } from '../../src/lib/document.ts';
import { searchLibrary, type LibraryResult } from '../../src/library.ts';
import { StateClient } from '../../src/link/client.ts';
import { linkedStores } from '../../src/link/stores.ts';
import { FileReadingStore } from '../../src/reading.ts';
import { FileProfileStore } from '../../src/store.ts';
import type { Queryable } from '../../src/db/schema.ts';
import { startApp, type Running } from '../../test/helpers.ts';
import { cases, documents, OWNER, OTHER, page, seedCorpus, type RecallCase, type CorpusStores } from './corpus.ts';

export type Backend = 'files' | 'postgres' | 'linked-files' | 'linked-postgres';
export async function openCorpus(backend: Backend) {
  const dir = await mkdtemp(path.join(tmpdir(), 'mcportal-recall-eval-'));
  let admin: Queryable | undefined, db: Queryable | undefined, app: Running | undefined;
  const schema = `recall_eval_${process.pid}_${Date.now()}`;
  const close = async () => {
    try { await app?.close(); } finally {
      try { await db?.end?.(); } finally {
        try { await admin?.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); } finally { await admin?.end?.(); await rm(dir, { recursive: true, force: true }); }
      }
    }
  };
  try {
    let stores: CorpusStores;
    if (backend.endsWith('postgres')) {
      if (!process.env.TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL is required for the Postgres benchmark; no silent skip.');
      const pg = await import('../../src/db.ts');
      admin = await pg.connect(process.env.TEST_DATABASE_URL);
      await admin.query(`CREATE SCHEMA ${schema}`);
      db = await pg.connect(process.env.TEST_DATABASE_URL, { searchPath: schema });
      await pg.ensureSchema(db);
      stores = { store: new pg.PgProfileStore(db), clips: new pg.PgClipStore(db), reading: new pg.PgReadingStore(db) };
    } else stores = { store: new FileProfileStore(dir), clips: new FileClipStore(dir), reading: new FileReadingStore(dir) };
    await seedCorpus(stores);
    let search = (user: string, query: RecallCase['query']) => searchLibrary(user, query, stores);
    if (backend.startsWith('linked-')) {
      const persistence = memoryPersistence(), auth = new AuthStore(persistence);
      app = await startApp({ github: { clientId: 'fixture', clientSecret: 'fixture' }, limits: { perMinute: 10000, perDay: 100000, globalPerDay: 1000000 } }, undefined, {
        ...stores, authPersistence: persistence, accounts: new Accounts(memoryPersistence(), makeBootstrap([], [])),
      });
      const sessions = new Map<string, ReturnType<typeof linkedStores>>();
      for (const user of [OWNER, OTHER]) {
        const tokens = await auth.issueTokens({ userId: user, githubId: Number(user.slice(7)), login: user }, 'mcpc_recall_benchmark', 'http://localhost/mcp', 'mcportal');
        const client = new StateClient({ server: app.base, auth: { token: async () => tokens.access_token, refresh: async () => undefined } });
        sessions.set(user, linkedStores(client, user));
      }
      search = (user, query) => {
        const session = sessions.get(user);
        if (!session) throw new Error('Unknown fixture account');
        return session.library.search(user, query);
      };
    }
    return { stores, search, close };
  } catch (error) { await close(); throw error; }
}

export interface CaseResult {
  id: string; type: RecallCase['type']; coverage: RecallCase['coverage']; expected: string[]; topFive: string[];
  retrievalAt5: boolean | null; negativeCorrect: boolean | null; forbiddenReturned: string[];
  passageAt5: boolean | null; sourceAt5: boolean | null; latencyMs: number; total: number;
}

export async function measureCase(c: RecallCase, result: LibraryResult, sources: CorpusStores, latencyMs: number): Promise<CaseResult> {
  const top = result.hits.slice(0, 5), refs = top.map(h => h.ref);
  let sourceAt5: boolean | null = null, passageAt5: boolean | null = null;
  if (c.passage) {
    const expected = c.passage;
    const hit = top.find(h => h.ref === expected.ref);
    const clip = hit?.clipId ? await sources.clips.get(OWNER, hit.clipId) : undefined;
    sourceAt5 = hit?.url === expected.url && clip?.source.url === expected.url;
    const body = documents.find(d => page(d.id) === expected.url)?.body ?? '';
    const text = hit?.locator?.text;
    // This evaluates the retained locator against a declared source fixture. Real
    // reader navigation/scroll behavior is validated separately by browser tests.
    passageAt5 = sourceAt5 && text === expected.text && clip?.source.locator?.text === text && body.split(text).length === 2;
  }
  return {
    id: c.id, type: c.type, coverage: c.coverage, expected: c.expected, topFive: refs,
    retrievalAt5: c.expected.length ? c.expected.some(r => refs.includes(r)) : null,
    negativeCorrect: c.expected.length ? null : result.total === 0,
    forbiddenReturned: result.hits.filter(h => c.forbidden?.includes(h.ref)).map(h => h.ref),
    sourceAt5, passageAt5, latencyMs: Math.round(latencyMs * 1000) / 1000, total: result.total,
  };
}

export function summarize(rows: CaseResult[]) {
  const metric = (key: 'retrievalAt5' | 'negativeCorrect' | 'sourceAt5' | 'passageAt5') => ({ passed: rows.filter(r => r[key] === true).length, total: rows.filter(r => r[key] !== null).length });
  const times = rows.map(r => r.latencyMs).sort((a, b) => a - b);
  return { retrievalAt5: metric('retrievalAt5'), negativeCorrect: metric('negativeCorrect'), sourceAt5: metric('sourceAt5'), passageAt5: metric('passageAt5'), forbidden: rows.reduce((n, r) => n + r.forbiddenReturned.length, 0), medianMs: times[Math.floor(times.length / 2)] ?? 0, p95Ms: times[Math.min(times.length - 1, Math.ceil(times.length * .95) - 1)] ?? 0 };
}

export async function benchmark(backend: Backend, split: RecallCase['split']) {
  const harness = await openCorpus(backend);
  try {
    const rows: CaseResult[] = [];
    // Warm startup/auth/cache once; each query is then measured five times and
    // reported at its median. These numbers are single-process fixture latency.
    await harness.search(OWNER, { query: 'warmup' });
    for (const c of cases.filter(c => c.split === split)) {
      const times: number[] = [];
      let result!: LibraryResult;
      for (let i = 0; i < 5; i++) {
        const start = performance.now(); result = await harness.search(OWNER, { ...c.query, limit: 50 }); times.push(performance.now() - start);
      }
      rows.push(await measureCase(c, result, harness.stores, times.sort((a, b) => a - b)[2]!));
    }
    return { backend, split, summary: summarize(rows), byType: Object.fromEntries([...new Set(rows.map(r => r.type))].map(type => [type, summarize(rows.filter(r => r.type === type))])), cases: rows };
  } finally { await harness.close(); }
}

export async function corpusHash() {
  return createHash('sha256').update(await readFile(new URL('./corpus.ts', import.meta.url))).digest('hex');
}
