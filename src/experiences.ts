/** Durable reading sessions. The account's layout and article-reading state stay separate. */
import { fileAuthPersistence } from './auth/store.ts';
import { SharedDocument, memoryPersistence, type DocumentPersistence } from './lib/document.ts';
import { AppError } from './lib/errors.ts';
import { defaultDataDir } from './lib/files.ts';
import { canonicalReadingUrl } from './reading.ts';
import { clean } from './lib/text.ts';
import type { Item, SourceKind } from './types.ts';
import { validateWatchState, pruneWatches, type WatchState } from './watches-state.ts';
import { SOURCES } from './profile.ts';

export interface CapturedStory { portalId: string; source: string; sourceKind: SourceKind; docs?: string; item: Item; marks: Array<{ portalId: string; itemId: string }> }
export interface CatchupSession { id: string; startedAt: string; stories: CapturedStory[]; cursor: number; outcomes: Array<'finished' | 'skipped'>; failures: string[]; finishedAt?: string; acknowledgedAt?: string }
export interface ExperienceState extends WatchState { version: 1; catchup: CatchupSession | null }
export interface ExperienceRecord { state: ExperienceState; rev: number }
export interface ExperienceStore {
  owners(): Promise<string[]>;
  purgeExpired(now?: number): Promise<number>;
  get(userId: string): Promise<ExperienceRecord>;
  update<R>(userId: string, change: (state: ExperienceState) => { state?: ExperienceState; result: R }): Promise<R>;
  replaceIf(userId: string, state: ExperienceState, rev: number): Promise<number>;
  import(userId: string, state: unknown): Promise<void>;
  deleteAll(userId: string): Promise<void>;
}
export const emptyExperiences = (): ExperienceState => ({ version: 1, catchup: null, watches: [], inbox: [] });
const invalid = (message: string) => new AppError('invalid_argument', message);
const date = (s: unknown) => { if (typeof s !== 'string' || !Number.isFinite(Date.parse(s))) throw invalid('Invalid session timestamp.'); return new Date(s).toISOString(); };
const address = (s: unknown) => { canonicalReadingUrl(s); return new URL(String(s)).href; };
function bounded(s: unknown, n: number, name: string): string { if (typeof s !== 'string' || s.length > n || !s.trim()) throw invalid(`Invalid session ${name}.`); return s; }
export function capturedStory(raw: CapturedStory): CapturedStory {
  if (!raw || !raw.item || !SOURCES.includes(raw.sourceKind) || !Array.isArray(raw.marks) || raw.marks.length < 1 || raw.marks.length > 40 || !Array.isArray(raw.item.meta) || raw.item.meta.length > 12) throw invalid('Invalid captured story.');
  const item: Item = { id: bounded(raw.item.id, 4096, 'item ID'), title: bounded(raw.item.title, 300, 'title'), meta: raw.item.meta.map(m => clean(m, 150)),
    ...(raw.item.url !== undefined ? { url: address(raw.item.url) } : {}), ...(raw.item.summary ? { summary: clean(raw.item.summary, 1000) } : {}),
    ...(raw.item.publishedAt ? { publishedAt: date(raw.item.publishedAt) } : {}), ...(raw.item.video ? { video: true } : {}),
    ...(raw.item.image ? { image: { url: address(raw.item.image.url), kind: raw.item.image.kind === 'avatar' ? 'avatar' as const : 'thumb' as const } } : {}),
    ...(typeof raw.item.score === 'number' && Number.isFinite(raw.item.score) ? { score: raw.item.score } : {}),
  };
  if (raw.item.clip) {
    if (!['quote','note','exchange','table','image','link'].includes(raw.item.clip.kind)) throw invalid('Invalid captured clip kind.');
    item.clip = { id: bounded(raw.item.clip.id, 100, 'clip ID'), kind: raw.item.clip.kind };
  }
  if (raw.item.share) {
    if (!['clip', 'link'].includes(raw.item.share.kind)) throw invalid('Invalid captured share kind.');
    item.share = { id: bounded(raw.item.share.id, 100, 'share ID'), kind: raw.item.share.kind };
  }
  return { portalId: bounded(raw.portalId, 80, 'portal ID'), source: bounded(raw.source, 200, 'source'), sourceKind: raw.sourceKind, item,
    marks: raw.marks.map(m => ({ portalId: bounded(m.portalId, 80, 'portal ID'), itemId: bounded(m.itemId, 4096, 'item ID') })), ...(raw.docs ? { docs: bounded(raw.docs, 4096, 'docs address') } : {}) };
}
export function validateExperiences(raw: unknown): ExperienceState {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Invalid reading experiences document.');
  const state = raw as ExperienceState;
  if (state.version !== 1 || Object.keys(raw).some(k => !['version','catchup','watches','inbox'].includes(k))) throw new AppError('failed_precondition', 'Update MCPortal to read this experiences document.');
  if (Buffer.byteLength(JSON.stringify(raw)) > 2000000) throw new AppError('limit_exceeded', 'Reading experiences exceed 2 MB. Remove some watches or findings.');
  const watches = validateWatchState(state);
  if (state.catchup === null) return { ...emptyExperiences(), ...watches };
  const s = state.catchup;
  if (!s || !Array.isArray(s.stories) || s.stories.length > 30 || !Array.isArray(s.outcomes) || s.outcomes.some(o => o !== 'finished' && o !== 'skipped') || !Number.isSafeInteger(s.cursor) || s.cursor < 0 || s.cursor > s.stories.length || s.outcomes.length !== s.cursor || !Array.isArray(s.failures) || s.failures.length > 40) throw invalid('Invalid catch-up session.');
  const session: CatchupSession = { id: bounded(s.id, 100, 'ID'), startedAt: date(s.startedAt), stories: s.stories.map(capturedStory), cursor: s.cursor, outcomes: [...s.outcomes], failures: s.failures.map(f => bounded(f, 500, 'source failure')),
    ...(s.finishedAt ? { finishedAt: date(s.finishedAt) } : {}), ...(s.acknowledgedAt ? { acknowledgedAt: date(s.acknowledgedAt) } : {}) };
  if (session.finishedAt && session.cursor !== session.stories.length) throw invalid('A finished session must account for its captured set.');
  if (session.acknowledgedAt && !session.finishedAt) throw invalid('An acknowledged session must be finished.');
  if (Buffer.byteLength(JSON.stringify(session)) > 256000) throw new AppError('limit_exceeded', 'Catch-up session exceeds 256 KB.');
  return { version: 1, catchup: session, ...watches };
}
interface Document { records: Array<{ owner: string; state: ExperienceState; rev: number }> }
export class DocumentExperienceStore implements ExperienceStore {
  private data: SharedDocument<Document>;
  constructor(persistence: DocumentPersistence = memoryPersistence()) {
    this.data = new SharedDocument(persistence, 'reading experiences', stored => {
      if (stored.records !== undefined && !Array.isArray(stored.records)) throw invalid('Unreadable reading experiences document.');
      return { records: (stored.records || []).map(r => { if (!Number.isSafeInteger(r.rev) || r.rev < 0) throw invalid('Invalid experiences revision.'); return { owner: bounded(r.owner, 200, 'owner'), state: validateExperiences(r.state), rev: r.rev }; }) };
    }, { maxAgeMs: 0 });
  }
  async purgeExpired(now = Date.now()): Promise<number> {
    return this.data.update(doc => { let removed = 0; for (const r of doc.records) { const count = r.state.inbox.length + r.state.watches.reduce((n,w) => n+w.events.length,0); pruneWatches(r.state,now); const after = r.state.inbox.length + r.state.watches.reduce((n,w) => n+w.events.length,0); removed += count-after; if (after !== count) r.rev++; } return removed; });
  }
  async owners(): Promise<string[]> { return (await this.data.get()).records.map(r => r.owner); }
  async get(userId: string): Promise<ExperienceRecord> { const r = (await this.data.get()).records.find(r => r.owner === userId); return r ? structuredClone({ state: r.state, rev: r.rev }) : { state: emptyExperiences(), rev: 0 }; }
  async update<R>(userId: string, change: (state: ExperienceState) => { state?: ExperienceState; result: R }): Promise<R> {
    return this.data.update(doc => {
      let r = doc.records.find(r => r.owner === userId);
      const next = change(structuredClone(r?.state || emptyExperiences()));
      if (next.state) {
        const state = validateExperiences(next.state); pruneWatches(state);
        if (!r) { r = { owner: userId, state, rev: 0 }; doc.records.push(r); }
        r.state = state; r.rev++;
      }
      return next.result;
    });
  }
  async replaceIf(userId: string, state: ExperienceState, rev: number) {
    return this.data.update(doc => {
      let r = doc.records.find(r => r.owner === userId);
      if ((r?.rev || 0) !== rev) throw new AppError('conflict', 'The reading session changed on another device. Reload it.');
      const valid = validateExperiences(state);
      if (!r) { r = { owner: userId, state: valid, rev: 0 }; doc.records.push(r); }
      r.state = valid; return ++r.rev;
    });
  }
  async import(userId: string, raw: unknown) {
    const incoming = validateExperiences(raw);
    await this.update(userId, before => {
      const ids = new Set(before.watches.map(w => w.id));
      const fresh = incoming.watches.filter(w => !ids.has(w.id));
      if (before.watches.length + fresh.length > 20) throw new AppError('limit_exceeded', 'Imported watches exceed the account limit.');
      // Imported subscriptions resume explicitly, after their owner reviews their location and endpoints.
      for (const w of fresh) { w.paused = true; delete w.lease; }
      const findingIds = new Set(before.inbox.map(f => f.id));
      return { state: { ...before, catchup: before.catchup || incoming.catchup, watches: [...before.watches,...fresh], inbox: [...before.inbox,...incoming.inbox.filter(f => !findingIds.has(f.id))].slice(-40) }, result: undefined };
    });
  }
  async deleteAll(userId: string) { await this.data.update(doc => { doc.records = doc.records.filter(r => r.owner !== userId); }); }
}
export class FileExperienceStore extends DocumentExperienceStore { constructor(dir = defaultDataDir()) { super(fileAuthPersistence(dir, 'experiences/data.json')); } }
