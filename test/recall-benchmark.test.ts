import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cases, OWNER, OTHER, clipRef, ref } from '../evals/recall/corpus.ts';
import { measureCase, openCorpus, type Backend } from '../evals/recall/run.ts';
import { matchesTerm, recallWords } from '../src/lib/search.ts';

test('Recall query wording preserves quoted titles and literal identifier punctuation', () => {
  assert.equal(recallWords('Where did I read about heartbeat persistence?'), 'heartbeat persistence');
  assert.equal(recallWords('Find the article about Postgres recovery'), 'Postgres recovery');
  assert.equal(recallWords('"Find the article"'), 'Find the article');
  assert.equal(recallWords('100%'), '100%');
  assert.equal(recallWords('https://example.com/docs?v=2'), 'https://example.com/docs?v=2');
  assert.equal(recallWords('MCPORTAL_DATA_DIR'), 'MCPORTAL_DATA_DIR');
  assert.ok(matchesTerm('v2.', 'v2'));
  assert.ok(matchesTerm('(5.1.0)', '5.1.0'));
  for (const longer of ['v20', 'v2.1', 'v2-beta', 'av2', 'év2']) assert.equal(matchesTerm(longer, 'v2'), false, longer);
  assert.equal(matchesTerm('MCPORTAL_DATA_DIRECTORY', 'mcportal_data_dir'), false);
  assert.ok(matchesTerm('/etc/config.json', 'config.json'));
  assert.equal(matchesTerm('100 days', '100%'), false);
  assert.ok(matchesTerm('literal a.b+[x]', 'a.b+[x]'));
});

for (const backend of ['files', 'postgres', 'linked-files', 'linked-postgres'] as Backend[]) {
  test(`Recall development benchmark and isolation (${backend})`, { skip: backend.endsWith('postgres') && !process.env.TEST_DATABASE_URL ? 'set TEST_DATABASE_URL for Postgres evaluation' : false }, async () => {
    const h = await openCorpus(backend);
    try {
      for (const c of cases.filter(c => c.split === 'development')) {
        const result = await h.search(OWNER, { ...c.query, limit: 50 });
        const measured = await measureCase(c, result, h.stores, 0);
        if (c.expected.length) assert.equal(measured.retrievalAt5, c.id !== 'd27', `${c.id}: synonym-only recall remains a disclosed limitation`);
        else assert.equal(measured.negativeCorrect, true, c.id);
        assert.deepEqual(measured.forbiddenReturned, [], c.id);
        if (c.passage) assert.equal(measured.passageAt5, true, c.id);
      }
      const foreign = await h.search(OTHER, { query: 'confidential zephyr' });
      assert.ok(foreign.total > 0, 'private fixture is present and searchable by its owner');
      assert.equal((await h.search(OTHER, { query: 'heartbeat' })).total, 0);
      const all = await h.search(OWNER, { query: 'garden', limit: 50 });
      const first = await h.search(OWNER, { query: 'garden', limit: 7 });
      const next = await h.search(OWNER, { query: 'garden', offset: 7, limit: 43 });
      assert.deepEqual([...first.hits, ...next.hits], all.hits, 'pagination preserves ranking');
      const normalized = await h.search(OWNER, { query: 'Where did I read about heartbeat persistence?' });
      assert.equal(normalized.search?.query, 'heartbeat persistence');
      assert.match(normalized.search!.coverage, /Original page bodies are not searched/);
      assert.ok(normalized.hits.find(x => x.ref === ref('heartbeat'))!.matched.includes('Saved title'));
      const noted = await h.search(OWNER, { query: 'disaster rehearsal' });
      assert.ok(noted.hits.find(x => x.ref === clipRef('recovery'))!.matched.includes('Clip note'));
      const history = await h.search(OWNER, { query: 'pagination', kind: 'reading' });
      assert.ok(history.hits[0]!.matched.includes('Reading title'));
      const sourced = await h.search(OWNER, { query: 'JSON schema compatibility', kind: 'quote' });
      assert.ok(sourced.hits[0]!.matched.includes('Source title'));
      const mixed = await h.search(OWNER, { query: 'long kestrel' });
      assert.ok(mixed.hits[0]!.matched.includes('Clip title'));
      assert.ok(mixed.hits[0]!.matched.includes('Indexed clip text or metadata'));
    } finally { await h.close(); }
  });
}
