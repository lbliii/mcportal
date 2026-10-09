/** Synthetic, account-owned Recall corpus. No network content or personal data. */
import { buildClip } from '../../src/clips.ts';
import type { LibraryQuery, LibrarySources } from '../../src/library.ts';
import { defaultProfile, validateProfile } from '../../src/profile.ts';

export const OWNER = 'github-42', OTHER = 'github-7';
export const DATE = new Date('2026-10-01T12:00:00Z');
export const page = (name: string) => `https://recall.example/${name}`;
export const ref = (name: string) => `url:${page(name)}`;
export const clipRef = (name: string) => `clip:c${name}`;

export const documents = [
  { id: 'heartbeat', title: 'NemoClaw heartbeat persistence', note: 'Keep a durable checkpoint between scheduled runs.', body: 'A heartbeat wakes the agent periodically. Persist the checkpoint before acknowledging the work.' },
  { id: 'restore', title: 'Postgres recovery runbook', note: 'Restore an isolated snapshot and verify the recovered rows.', body: 'Practice recovery in an isolated database. Record the restore duration and check every index.' },
  { id: 'v2', title: 'Widget v2 migration', body: 'Widget v2 requires the new authorization header.' },
  { id: 'v20', title: 'Widget v20 migration', body: 'Widget v20 uses a different wire format.' },
  { id: 'version', title: 'Engine 5.1.0 release notes', body: 'Engine 5.1.0 fixes the scheduler.' },
  { id: 'other-version', title: 'Engine 15.1.0 release notes', body: 'Engine 15.1.0 changes the scheduler.' },
  { id: 'schema', title: 'JSON schema compatibility', note: 'Preserve omitted fields from older writers.', body: 'An omitted field keeps its previous value.' },
  { id: 'bookmark', title: 'A bookmarked field guide', body: 'The hidden-only phrase vermilion otter appears only on the original page.' },
  { id: 'history', title: 'Reading history on pagination', body: 'Use a stable sort key before applying an offset.' },
  { id: 'selectors?version=1', title: 'Protocol version one', body: 'Version one is a distinct representation.' },
  { id: 'selectors?version=2', title: 'Protocol version two', body: 'Version two is a distinct representation.' },
  { id: 'utf8', title: 'Café Unicode normalization', body: 'Normalize Unicode consistently when comparing labels.' },
  { id: 'replication', title: 'Replication lag diagnostics', note: 'Check the replay position before promoting a replica.', body: 'A replica can be healthy while lagging behind the writer.' },
  { id: 'lease', title: 'Worker lease renewal', body: 'Reject results from an expired lease.' },
] as const;

export const quotes = [
  { id: 'checkpoint', title: 'Durable checkpoint', source: 'heartbeat', text: 'Persist the checkpoint before acknowledging the work.', locator: true, tags: ['agents'] },
  { id: 'recovery', title: 'Recovery checklist', source: 'restore', text: 'Record the restore duration and check every index.', locator: true, note: 'Use this in the disaster rehearsal.' },
  { id: 'v2', title: 'Widget v2 authorization', source: 'v2', text: 'Widget v2 requires the new authorization header.' },
  { id: 'v20', title: 'Widget v20 authorization', source: 'v20', text: 'Widget v20 uses a different wire format.' },
  { id: 'engine', title: 'Engine patch', source: 'version', text: 'Engine 5.1.0 fixes the scheduler.' },
  { id: 'engine-other', title: 'Engine patch', source: 'other-version', text: 'Engine 15.1.0 changes the scheduler.' },
  { id: 'identifier', title: 'Configuration setting', text: 'Set MCPORTAL_DATA_DIR to an account-owned directory.' },
  { id: 'identifier-other', title: 'Configuration setting', text: 'Set MCPORTAL_DATA_DIRECTORY to an account-owned directory.' },
  { id: 'percent', title: 'Capacity target', text: 'The required target is 100% coverage.' },
  { id: 'number', title: 'Capacity target', text: 'The observation covers 100 days.' },
  { id: 'deep', title: 'Long retained note', text: 'Ordinary retained prose. '.repeat(60) + 'The azure kestrel marks a durable boundary.' },
  { id: 'cutoff', title: 'Very long retained text', text: 'Ordinary retained prose. '.repeat(1900) + 'The unindexed-tail phrase tangerine ibis.' },
  { id: 'source-title', title: 'A kept explanation', source: 'schema', text: 'An omitted field keeps its previous value.' },
  { id: 'duplicate', title: 'A second checkpoint quote', source: 'heartbeat', text: 'Persist the checkpoint before acknowledging the work.' },
  { id: 'lease', title: 'Stale worker result', source: 'lease', text: 'Reject results from an expired lease.', locator: true },
  { id: 'replica', title: 'Promotion checklist', source: 'replication', text: 'A replica can be healthy while lagging behind the writer.', locator: true },
] satisfies Array<{ id: string; title: string; text: string; source?: string; locator?: boolean; note?: string; tags?: string[] }>;

export interface RecallCase {
  id: string;
  split: 'development' | 'validation';
  type: 'identifier' | 'version' | 'title' | 'recall' | 'quote' | 'note' | 'duplicate' | 'coverage';
  query: LibraryQuery;
  expected: string[];
  forbidden?: string[];
  passage?: { ref: string; url: string; text: string };
  coverage: 'metadata' | 'retained-text' | 'unindexed' | 'private';
}

const d = (id: string, type: RecallCase['type'], query: string | LibraryQuery, expected: string[], extra: Partial<RecallCase> = {}): RecallCase => ({
  id, split: 'development', type, query: typeof query === 'string' ? { query } : query, expected, coverage: 'metadata', ...extra,
});

/** Freeze before changing ranking. Validation results must not inform this iteration's tuning. */
export const cases: RecallCase[] = [
  d('d01', 'title', 'NemoClaw heartbeat', [ref('heartbeat')]),
  d('d02', 'recall', 'Where did I read about heartbeat persistence?', [ref('heartbeat')]),
  d('d03', 'recall', 'heartbeat persistence', [ref('heartbeat')]),
  d('d04', 'recall', 'Find the article about Postgres recovery', [ref('restore')]),
  d('d05', 'title', '"JSON schema compatibility"', [ref('schema')]),
  d('d06', 'identifier', 'MCPORTAL_DATA_DIR', [clipRef('identifier')], { coverage: 'retained-text', forbidden: [clipRef('identifier-other')] }),
  d('d07', 'version', 'Widget v2', [ref('v2'), clipRef('v2')], { forbidden: [ref('v20'), clipRef('v20')] }),
  d('d08', 'version', '5.1.0', [ref('version'), clipRef('engine')], { forbidden: [ref('other-version'), clipRef('engine-other')] }),
  d('d09', 'identifier', '100%', [clipRef('percent')], { coverage: 'retained-text', forbidden: [clipRef('number')] }),
  d('d10', 'quote', 'Persist the checkpoint', [clipRef('checkpoint'), clipRef('duplicate')], { coverage: 'retained-text', passage: { ref: clipRef('checkpoint'), url: page('heartbeat'), text: quotes[0]!.text } }),
  d('d11', 'quote', 'azure kestrel', [clipRef('deep')], { coverage: 'retained-text' }),
  d('d12', 'note', 'disaster rehearsal', [clipRef('recovery')]),
  d('d13', 'note', 'omitted fields', [ref('schema')]),
  d('d14', 'duplicate', { query: 'heartbeat', kind: 'saved' }, [ref('heartbeat')]),
  d('d15', 'duplicate', { query: 'checkpoint', kind: 'quote' }, [clipRef('checkpoint'), clipRef('duplicate')]),
  d('d16', 'coverage', 'vermilion otter', [], { coverage: 'unindexed' }),
  d('d17', 'coverage', 'tangerine ibis', [], { coverage: 'unindexed' }),
  d('d18', 'coverage', 'confidential zephyr', [], { coverage: 'private' }),
  d('d19', 'coverage', 'nonexistent platypus', [], { coverage: 'unindexed' }),
  d('d20', 'title', { query: 'pagination', kind: 'reading' }, [ref('history')]),
  d('d21', 'quote', 'JSON schema compatibility', [ref('schema'), clipRef('source-title')], { coverage: 'retained-text' }),
  d('d22', 'quote', 'duration index', [clipRef('recovery')], { coverage: 'retained-text', passage: { ref: clipRef('recovery'), url: page('restore'), text: quotes[1]!.text } }),
  d('d23', 'recall', 'checkpoint agents', [clipRef('checkpoint')], { coverage: 'retained-text' }),
  d('d24', 'coverage', { query: 'heartbeat', site: 'elsewhere.example' }, [], { coverage: 'unindexed' }),
  d('d25', 'duplicate', 'Protocol version two', [ref('selectors?version=2')], { forbidden: [ref('selectors?version=1')] }),
  d('d26', 'coverage', 'invisible unopened', [], { coverage: 'unindexed' }),
  d('d27', 'recall', 'recover the database after a catastrophe', [ref('restore')]),
  d('d28', 'note', { query: 'checkpoint', tag: 'agents' }, [clipRef('checkpoint')]),
  d('v01', 'identifier', 'MCPORTAL_DATA_DIRECTORY', [clipRef('identifier-other')], { split: 'validation', coverage: 'retained-text', forbidden: [clipRef('identifier')] }),
  d('v02', 'version', 'Widget v20', [ref('v20'), clipRef('v20')], { split: 'validation', forbidden: [ref('v2'), clipRef('v2')] }),
  d('v03', 'version', '15.1.0', [ref('other-version'), clipRef('engine-other')], { split: 'validation', forbidden: [ref('version'), clipRef('engine')] }),
  d('v04', 'title', 'Café Unicode', [ref('utf8')], { split: 'validation' }),
  d('v05', 'recall', 'Can you find my page about replication lag?', [ref('replication')], { split: 'validation' }),
  d('v06', 'quote', 'expired lease', [clipRef('lease')], { split: 'validation', coverage: 'retained-text', passage: { ref: clipRef('lease'), url: page('lease'), text: quotes[14]!.text } }),
  d('v07', 'note', 'replay position', [ref('replication')], { split: 'validation' }),
  d('v08', 'duplicate', 'Protocol version one', [ref('selectors?version=1')], { split: 'validation', forbidden: [ref('selectors?version=2')] }),
  d('v09', 'coverage', 'private cobalt', [], { split: 'validation', coverage: 'private' }),
  d('v10', 'coverage', 'untouched source body', [], { split: 'validation', coverage: 'unindexed' }),
  d('v11', 'quote', 'lagging behind the writer', [clipRef('replica')], { split: 'validation', coverage: 'retained-text', passage: { ref: clipRef('replica'), url: page('replication'), text: quotes[15]!.text } }),
  d('v12', 'recall', 'how to prevent old workers from publishing late answers', [clipRef('lease')], { split: 'validation', coverage: 'retained-text' }),
];

export type CorpusStores = { [K in keyof Required<LibrarySources>]: NonNullable<LibrarySources[K]> };

export async function seedCorpus(stores: CorpusStores): Promise<void> {
  const saved = documents.filter(d => d.id !== 'history').map(d => ({ url: page(d.id), title: d.title, savedAt: DATE.toISOString(), ...('note' in d ? { note: d.note } : {}) }));
  await stores.store.put(OWNER, validateProfile({ ...defaultProfile(), onboarded: true, columns: [{ panels: [{ id: 'saved', source: 'saved', title: 'Saved', config: {} }] }], saved }));
  await stores.store.put(OTHER, validateProfile({ ...defaultProfile(), columns: [{ panels: [{ id: 'saved', source: 'saved', title: 'Saved', config: {} }] }], saved: [{ url: page('private'), title: 'Confidential zephyr', savedAt: DATE.toISOString() }] }));
  for (const q of quotes) {
    const source = q.source ? documents.find(d => d.id === q.source)! : undefined;
    const content = q.id === 'cutoff' ? { kind: 'exchange', turns: [{ speaker: 'user', text: q.text.slice(0, 25000) }, { speaker: 'assistant', text: q.text.slice(25000) }] } : { kind: 'quote', text: q.text };
    await stores.clips.add(OWNER, buildClip({ ...content, title: q.title, ...('note' in q ? { note: q.note } : {}), ...('tags' in q ? { tags: q.tags } : {}), source: source ? { kind: 'article', url: page(source.id), title: source.title, ...('locator' in q && q.locator ? { locator: { block: 1, text: q.text } } : {}) } : { kind: 'conversation' } }, DATE, `c${q.id}`));
  }
  await stores.clips.add(OTHER, buildClip({ kind: 'note', title: 'Private cobalt', markdown: 'confidential zephyr private cobalt' }, DATE, 'cprivate'));
  // Newer unrelated entries push target clips beyond the linked clips.list page cap.
  for (let i = 0; i < 110; i++) await stores.clips.add(OWNER, buildClip({ kind: 'note', title: `Garden journal ${i}`, markdown: `Orchard observations ${i}: moss, sunlight and rainfall.` }, new Date(DATE.getTime() + 1000 + i), `cnoise${i}`));
  await stores.reading.record(OWNER, { url: page('heartbeat') + '#checkpoint', title: 'NemoClaw heartbeat persistence', status: 'opened', progress: .4 });
  await stores.reading.record(OWNER, { url: page('history'), title: 'Reading history on pagination', status: 'opened' });
  await stores.reading.record(OWNER, { url: page('unopened'), title: 'Invisible unopened', status: 'seen' });
}
