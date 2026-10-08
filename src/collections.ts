/** Private desks, kept comparisons and trails. Layout changes never rewrite this data. */
import { randomBytes } from 'node:crypto';
import { fileAuthPersistence } from './auth/store.ts';
import { LOCATOR_SCHEMA, passageLocator, type PassageLocator } from './evidence.ts';
import { SharedDocument, memoryPersistence, type DocumentPersistence } from './lib/document.ts';
import { AppError } from './lib/errors.ts';
import { defaultDataDir } from './lib/files.ts';
import { canonicalReadingUrl } from './reading.ts';

export const COLLECTION_LIMITS = { count: 50, entries: 200, livePortals: 8, orientation: 16000, excerpt: 2000, bytes: 256000 };
export type CollectionKind = 'desk' | 'comparison' | 'trail';
export interface CollectionEntry {
  ref: string; title: string; source?: string; url?: string; docs?: string; locator?: PassageLocator;
  excerpt?: string; fetchedAt?: string; reason?: string; addedAt: string; completedAt?: string; completion?: 'finished' | 'skipped';
}
export interface Orientation { text: string; refs: string[]; createdAt: string }
export interface Collection {
  id: string; kind: CollectionKind; title: string; purpose: string; entries: CollectionEntry[];
  livePortals: string[]; orientation?: Orientation; createdAt: string; updatedAt: string;
}
export interface CollectionChange {
  action: 'create' | 'edit' | 'add' | 'replace' | 'remove' | 'reorder' | 'complete' | 'orientation' | 'delete';
  id?: string; kind?: CollectionKind; title?: string; purpose?: string; livePortals?: string[];
  entries?: Array<Omit<CollectionEntry, 'addedAt' | 'completedAt'>>; refs?: string[]; completed?: boolean; skipped?: boolean;
  orientation?: { text: string; refs: string[] };
}
export interface CollectionStore {
  list(userId: string): Promise<Collection[]>;
  get(userId: string, id: string): Promise<Collection | undefined>;
  change(userId: string, input: CollectionChange): Promise<Collection | undefined>;
  import(userId: string, raw: unknown[]): Promise<number>;
  deleteAll(userId: string): Promise<void>;
}
const invalid = (message: string) => new AppError('invalid_argument', message);
function text(raw: unknown, max: number, name: string, required = false): string {
  if (typeof raw !== 'string' || raw.length > max || (required && !raw.trim())) throw invalid(`${name} must be ${required ? 'nonempty and ' : ''}at most ${max} characters.`);
  return raw.trim();
}
function stamp(raw: unknown): string {
  if (typeof raw !== 'string' || !Number.isFinite(Date.parse(raw))) throw invalid('Invalid collection timestamp.');
  return new Date(raw).toISOString();
}
export function evidenceRef(raw: unknown): string {
  if (typeof raw !== 'string') throw invalid('Evidence needs a clip:ID or url:URL reference.');
  if (/^clip:[a-zA-Z0-9_-]{1,100}$/.test(raw)) return raw;
  if (raw.startsWith('url:')) return `url:${canonicalReadingUrl(raw.slice(4))}`;
  throw invalid('Evidence needs a clip:ID or url:URL reference.');
}
function refs(raw: unknown, max = COLLECTION_LIMITS.entries): string[] {
  if (!Array.isArray(raw) || raw.length > max) throw invalid(`Expected at most ${max} evidence references.`);
  const result = raw.map(evidenceRef);
  if (new Set(result).size !== result.length) throw invalid('Evidence references must be unique.');
  return result;
}
function live(raw: unknown): string[] {
  if (!Array.isArray(raw) || raw.length > COLLECTION_LIMITS.livePortals) throw invalid('A collection supports at most 8 live portals.');
  const result = raw.map(p => text(p, 80, 'Portal ID', true));
  if (new Set(result).size !== result.length) throw invalid('Live portals must be unique.');
  return result;
}
function entry(raw: CollectionEntry, now: string): CollectionEntry {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Invalid collection entry.');
  const ref = evidenceRef(raw.ref), locator = passageLocator(raw.locator);
  return { ref, title: text(raw.title, 300, 'Entry title', true), addedAt: raw.addedAt ? stamp(raw.addedAt) : now,
    ...(raw.source !== undefined ? { source: text(raw.source, 200, 'Source') } : {}),
    ...(raw.url !== undefined ? { url: canonicalReadingUrl(raw.url) } : {}),
    ...(raw.docs !== undefined ? { docs: text(raw.docs, 4096, 'Docs address', true) } : {}),
    ...(raw.fetchedAt ? { fetchedAt: stamp(raw.fetchedAt) } : {}),
    ...(!ref.startsWith('clip:') && raw.excerpt !== undefined ? { excerpt: text(raw.excerpt, COLLECTION_LIMITS.excerpt, 'Excerpt') } : {}),
    ...(raw.reason !== undefined ? { reason: text(raw.reason, 1000, 'Reading reason') } : {}),
    ...(raw.completedAt ? { completedAt: stamp(raw.completedAt), completion: raw.completion === 'skipped' ? 'skipped' as const : 'finished' as const } : {}), ...(locator ? { locator } : {}) };
}
function orientation(raw: { text: string; refs: string[]; createdAt?: string }, entries: CollectionEntry[], now: string): Orientation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('An orientation needs text and evidence references.');
  const cited = refs(raw.refs), available = new Set(entries.map(e => e.ref));
  if (!cited.length || cited.some(ref => !available.has(ref))) throw invalid('Every orientation reference must name current collection evidence.');
  return { text: text(raw.text, COLLECTION_LIMITS.orientation, 'Orientation', true), refs: cited, createdAt: raw.createdAt ? stamp(raw.createdAt) : now };
}
/** Import validates shape but retains stale citations so the UI can explain removed evidence. */
export function importedCollection(raw: unknown): Collection {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Invalid collection.');
  const c = raw as Collection;
  if (!['desk', 'comparison', 'trail'].includes(c.kind) || !/^col_[a-f0-9]{24}$/.test(c.id) || !Array.isArray(c.entries) || c.entries.length > COLLECTION_LIMITS.entries) throw invalid('Invalid collection kind, ID or entries.');
  const entries = c.entries.map(e => entry(e, stamp(c.createdAt)));
  refs(entries.map(e => e.ref));
  const result: Collection = { id: c.id, kind: c.kind, title: text(c.title, 200, 'Collection title', true), purpose: text(c.purpose, 1000, 'Purpose'), entries, livePortals: live(c.livePortals), createdAt: stamp(c.createdAt), updatedAt: stamp(c.updatedAt) };
  if (c.orientation) result.orientation = { text: text(c.orientation.text, COLLECTION_LIMITS.orientation, 'Orientation', true), refs: refs(c.orientation.refs), createdAt: stamp(c.orientation.createdAt) };
  checkSize(result); return result;
}
function checkSize(c: Collection) {
  if (Buffer.byteLength(JSON.stringify(c)) > COLLECTION_LIMITS.bytes) throw new AppError('limit_exceeded', 'This collection exceeds 256 KB. Remove some retained excerpts first.');
  if (c.kind === 'comparison' && c.entries.length > 3) throw invalid('A comparison supports at most three sources.');
}
const refSchema = { type: 'string', maxLength: 4100 };
const refsSchema = { type: 'array', maxItems: COLLECTION_LIMITS.entries, items: refSchema };
export const COLLECTION_CHANGE_SCHEMA = { type: 'object', required: ['action'], additionalProperties: false, properties: {
  action: { type: 'string', enum: ['create', 'edit', 'add', 'replace', 'remove', 'reorder', 'complete', 'orientation', 'delete'] }, id: { type: 'string', maxLength: 100 },
  kind: { type: 'string', enum: ['desk', 'comparison', 'trail'] }, title: { type: 'string', maxLength: 200 }, purpose: { type: 'string', maxLength: 1000 },
  livePortals: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 80 } }, refs: refsSchema, completed: { type: 'boolean' }, skipped: { type: 'boolean' },
  entries: { type: 'array', maxItems: 200, items: { type: 'object', required: ['ref', 'title'], additionalProperties: false, properties: { ref: refSchema, title: { type: 'string', maxLength: 300 }, source: { type: 'string', maxLength: 200 }, url: { type: 'string', maxLength: 4096 }, docs: { type: 'string', maxLength: 4096 }, excerpt: { type: 'string', maxLength: 2000 }, reason: { type: 'string', maxLength: 1000 }, fetchedAt: { type: 'string', maxLength: 40 }, locator: LOCATOR_SCHEMA } } },
  orientation: { type: 'object', required: ['text', 'refs'], additionalProperties: false, properties: { text: { type: 'string', maxLength: 16000 }, refs: refsSchema } },
} };

interface Document { collections: Array<{ owner: string; data: Collection }> }
/** File and Postgres use the same bounded contract; Postgres persistence locks concurrent writes. */
export class DocumentCollectionStore implements CollectionStore {
  private data: SharedDocument<Document>;
  constructor(persistence: DocumentPersistence = memoryPersistence()) {
    this.data = new SharedDocument(persistence, 'collections', stored => {
      if (stored.collections !== undefined && !Array.isArray(stored.collections)) throw new AppError('internal', 'Unreadable collections document.');
      return { collections: (stored.collections ?? []).map(c => ({ owner: text(c.owner, 200, 'Collection owner', true), data: importedCollection(c.data) })) };
    }, { maxAgeMs: 0 });
  }
  async list(userId: string) { return structuredClone((await this.data.get()).collections.filter(c => c.owner === userId).map(c => c.data).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))); }
  async get(userId: string, id: string) { return (await this.list(userId)).find(c => c.id === id); }
  async change(userId: string, input: CollectionChange) {
    return this.data.update(doc => {
      const now = new Date().toISOString();
      const fields: Record<CollectionChange['action'], string[]> = { create: ['kind', 'title', 'purpose', 'livePortals', 'entries', 'orientation'], edit: ['kind', 'title', 'purpose', 'livePortals'], add: ['entries'], replace: ['entries'], remove: ['refs'], reorder: ['refs'], complete: ['refs', 'completed', 'skipped'], orientation: ['orientation'], delete: [] };
      if (!Object.hasOwn(fields, input.action)) throw invalid('Unknown collection action.');
      for (const [key, value] of Object.entries(input)) if (value !== undefined && key !== 'action' && key !== 'id' && !fields[input.action].includes(key)) throw invalid(`${key} is not used by collection action ${input.action}.`);
      if (input.action !== 'create') text(input.id, 100, 'Collection ID', true);
      else if (input.id !== undefined) throw invalid('Create assigns a new collection ID.');
      let record = doc.collections.find(c => c.owner === userId && c.data.id === input.id);
      if (input.action === 'create') {
        if (doc.collections.filter(c => c.owner === userId).length >= COLLECTION_LIMITS.count) throw new AppError('limit_exceeded', 'You have 50 collections. Remove one before creating another.');
        const kind = input.kind ?? 'desk';
        if (!['desk', 'comparison', 'trail'].includes(kind)) throw invalid('Unknown collection kind.');
        record = { owner: userId, data: { id: `col_${randomBytes(12).toString('hex')}`, kind, title: text(input.title, 200, 'Collection title', true), purpose: input.purpose === undefined ? '' : text(input.purpose, 1000, 'Purpose'), entries: [], livePortals: [], createdAt: now, updatedAt: now } };
        doc.collections.push(record);
      } else if (!record) throw new AppError('not_found', 'This collection is unavailable.');
      if (input.action === 'delete') { doc.collections = doc.collections.filter(c => c !== record); return undefined; }
      const c = record.data;
      if (input.action === 'edit' || input.action === 'create') {
        if (input.title !== undefined) c.title = text(input.title, 200, 'Collection title', true);
        if (input.purpose !== undefined) c.purpose = text(input.purpose, 1000, 'Purpose');
        if (input.livePortals !== undefined) c.livePortals = live(input.livePortals);
        if (input.kind !== undefined) { if (!['desk', 'comparison', 'trail'].includes(input.kind)) throw invalid('Unknown collection kind.'); c.kind = input.kind; }
      }
      if (input.action === 'add' || input.action === 'replace' || input.action === 'create') {
        if (input.action !== 'create' && input.entries === undefined) throw invalid('Provide entries to keep in this collection.');
        if (input.action === 'replace') c.entries = [];
        if (input.entries !== undefined && (!Array.isArray(input.entries) || input.entries.length > COLLECTION_LIMITS.entries)) throw invalid('Too many collection entries.');
        for (const raw of input.entries ?? []) {
          const next = entry(raw as CollectionEntry, now);
          if (!c.entries.some(e => e.ref === next.ref)) c.entries.push(next);
        }
        if (c.entries.length > COLLECTION_LIMITS.entries) throw new AppError('limit_exceeded', 'A collection supports at most 200 entries.');
      }
      if (input.action === 'remove') { const removed = refs(input.refs); c.entries = c.entries.filter(e => !removed.includes(e.ref)); }
      if (input.action === 'reorder') {
        const order = refs(input.refs);
        if (order.length !== c.entries.length || order.some(r => !c.entries.some(e => e.ref === r))) throw invalid('Reordering must include each current entry exactly once.');
        c.entries = order.map(r => c.entries.find(e => e.ref === r)!);
      }
      if (input.action === 'complete') {
        const completed = refs(input.refs);
        if (typeof input.completed !== 'boolean' || completed.some(r => !c.entries.some(e => e.ref === r))) throw invalid('Completion needs current entry references and completed true or false.');
        for (const e of c.entries) if (completed.includes(e.ref)) { if (input.completed) { e.completedAt = now; e.completion = input.skipped ? 'skipped' : 'finished'; } else { delete e.completedAt; delete e.completion; } }
      }
      if (input.orientation !== undefined && (input.action === 'orientation' || input.action === 'create')) c.orientation = orientation(input.orientation, c.entries, now);
      if (input.action === 'orientation' && input.orientation === undefined) throw invalid('Provide the orientation and its evidence references.');
      c.updatedAt = now; checkSize(c);
      return structuredClone(c);
    });
  }
  async import(userId: string, raw: unknown[]) {
    if (!Array.isArray(raw) || raw.length > COLLECTION_LIMITS.count) throw invalid('An import supports at most 50 collections.');
    const incoming = raw.map(importedCollection);
    return this.data.update(doc => {
      const existing = doc.collections.filter(c => c.owner === userId), ids = new Set(existing.map(c => c.data.id));
      let count = 0;
      for (const data of incoming) if (!ids.has(data.id)) {
        if (existing.length + count >= COLLECTION_LIMITS.count) throw new AppError('limit_exceeded', 'Imported collections would exceed the account limit.');
        doc.collections.push({ owner: userId, data }); ids.add(data.id); count++;
      }
      return count;
    });
  }
  async deleteAll(userId: string) { await this.data.update(doc => { doc.collections = doc.collections.filter(c => c.owner !== userId); }); }
}
export class FileCollectionStore extends DocumentCollectionStore {
  constructor(dir = defaultDataDir()) { super(fileAuthPersistence(dir, 'collections/data.json')); }
}
