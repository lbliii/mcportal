/**
 * Clips: typed snippets the user asked to keep from a conversation or an article
 * (docs/plans/clips.md). Kept out of the profile, since tables and images would
 * bloat the one document every layout edit rewrites.
 *
 * Everything in a clip is untrusted plain text or checked image bytes. Text keeps
 * its line breaks (unlike portal items); markdown-lite is parsed into blocks and
 * never interpreted as HTML. SVG is only ever shown as an <img>, so nothing in it runs.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { httpUrl } from './profile.ts';
import { atomicWrite, defaultDataDir, KeyedMutex, safeFileId } from './store.ts';
import { AppError, type AppErrorOptions, type ErrorCode } from './lib/errors.ts';
import { parseMarkdownLite } from './lib/markdown.ts';
import { clean } from './lib/text.ts';
import { CLIP_KINDS, type ArticleBlock, type ClipKind } from './types.ts';

export { parseMarkdownLite };

export { CLIP_KINDS, type ClipKind };

export const CLIP_LIMITS = {
  /** Bytes of text per clip (all its text together). */
  text: 32_000,
  /** Bytes per image, decoded. */
  image: 500_000,
  columns: 50,
  rows: 500,
  cell: 2_000,
  turns: 20,
  tags: 10,
  title: 120,
  note: 1_000,
  perUser: 1_000,
  bytesPerUser: 50_000_000,
} as const;

export type ClipData =
  | { kind: 'quote'; text: string; attribution?: string }
  | { kind: 'exchange'; turns: Array<{ speaker: string; text: string }> }
  | { kind: 'note'; blocks: ArticleBlock[] }
  | { kind: 'table'; columns: string[]; rows: string[][] }
  | { kind: 'image'; mime: ImageMime; data: string }
  | { kind: 'link'; url: string };

export type ImageMime = 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';

export interface ClipSource {
  kind: 'conversation' | 'article' | 'web';
  url?: string;
  title?: string;
}

/** Everything about a clip except its content: what lists, portals and search return. */
export interface ClipSummary {
  id: string;
  kind: ClipKind;
  title: string;
  note?: string;
  tags: string[];
  source: ClipSource;
  /** One line for lists: the first words, the table's size, the image type. */
  preview: string;
  /** Stored size in bytes (counts toward the per-user cap). */
  bytes: number;
  createdAt: string;
  updatedAt: string;
}

export interface Clip extends ClipSummary {
  data: ClipData;
}

export interface ClipQuery {
  kind?: ClipKind;
  tag?: string;
  /** Words that must all appear (title, note, tags, text). */
  query?: string;
  limit?: number;
  /** Only clips created before this ISO time (paging). */
  before?: string;
}

export interface ClipPatch {
  title?: string;
  note?: string;
  tags?: string[];
}

/** A clip that fails validation, or a clip limit reached. Defaults to invalid_argument; pass a code when it's something else. */
export class ClipError extends AppError {
  override name = 'ClipError';

  constructor(message: string, code: ErrorCode = 'invalid_argument', options?: AppErrorOptions) {
    super(code, message, options);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const bytesOf = (s: string) => Buffer.byteLength(s, 'utf8');

/**
 * Multi-line untrusted text: no control characters except line breaks, tabs as
 * spaces, at most one blank line in a row. Refuses rather than truncates.
 */
export function cleanText(input: unknown, max: number = CLIP_LIMITS.text, what = 'text'): string {
  if (typeof input !== 'string') return '';
  const text = input
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, '  ')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (bytesOf(text) > max) throw new ClipError(`The ${what} is too long (${Math.ceil(bytesOf(text) / 1000)} KB; the limit is ${max / 1000} KB).`);
  return text;
}

export function normalizeTags(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : [];
  const tags: string[] = [];
  for (const entry of list) {
    const tag = String(entry).toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30);
    if (tag && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= CLIP_LIMITS.tags) break;
  }
  return tags;
}

function normalizeSource(raw: unknown): ClipSource {
  const input = isRecord(raw) ? raw : {};
  const url = httpUrl(input.url) ?? undefined;
  const kind = input.kind === 'article' || input.kind === 'web' ? input.kind : url ? 'web' : 'conversation';
  const title = clean(input.title, 200) || undefined;
  return { kind, ...(url ? { url } : {}), ...(title ? { title } : {}) };
}

function splitRow(line: string): string[] {
  const body = line.trim().replace(/^\|/, '').replace(/(?<!\\)\|$/, '');
  return body.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

/** A GitHub-style markdown table: header row, separator row, body rows. */
export function parseMarkdownTable(markdown: string): { columns: string[]; rows: string[][] } {
  const lines = markdown.split('\n').map((l) => l.trim()).filter((l) => l.startsWith('|') || l.includes('|'));
  if (lines.length < 2 || !/^\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?$/.test(lines[1]!)) {
    throw new ClipError('The table must be a markdown table (a header row, a --- row, then rows), or columns and rows.');
  }
  return { columns: splitRow(lines[0]!), rows: lines.slice(2).map(splitRow) };
}

// ---- images -----------------------------------------------------------------

const RASTER: Record<string, (b: Buffer) => boolean> = {
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** A single <svg> root, after an optional XML declaration and comments. No DOCTYPE (entities). */
export function isSvg(text: string): boolean {
  const body = text.replace(/^\ufeff/, '').replace(/^\s*<\?xml[^>]*\?>/, '').replace(/^(\s*<!--[\s\S]*?-->)*/, '').trim();
  return /^<svg[\s>]/i.test(body) && /<\/svg>$/i.test(body) && !/<!DOCTYPE/i.test(body);
}

/** An image from a data: URI, { mime, data } (base64), or raw SVG markup. Checked by content. */
export function normalizeImage(image: unknown, svg: unknown): { mime: ImageMime; data: string } {
  let mime = '';
  let base64 = '';
  if (typeof svg === 'string' && svg.trim()) {
    mime = 'image/svg+xml';
    base64 = Buffer.from(svg.trim(), 'utf8').toString('base64');
  } else if (typeof image === 'string') {
    const m = image.trim().match(/^data:([a-z+/.-]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    if (!m) throw new ClipError('image must be a data: URI (data:image/png;base64,…), { mime, data }, or pass svg as markup.');
    mime = m[1]!.toLowerCase();
    base64 = m[2]!;
  } else if (isRecord(image)) {
    mime = String(image.mime ?? '').toLowerCase();
    base64 = String(image.data ?? '');
  } else throw new ClipError('An image clip needs image (a data: URI or { mime, data }) or svg (markup).');
  base64 = base64.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) throw new ClipError('The image data is not valid base64.');
  const bytes = Buffer.from(base64, 'base64');
  if (!bytes.length) throw new ClipError('The image is empty.');
  if (bytes.length > CLIP_LIMITS.image) throw new ClipError(`The image is too big (${Math.ceil(bytes.length / 1000)} KB; the limit is ${CLIP_LIMITS.image / 1000} KB).`);
  if (mime === 'image/svg+xml') {
    if (!isSvg(bytes.toString('utf8'))) throw new ClipError('That is not an SVG image (it needs a single <svg> root).');
  } else {
    const actual = Object.keys(RASTER).find((t) => RASTER[t]!(bytes));
    if (!actual) throw new ClipError('Images must be PNG, JPEG, WebP or SVG.');
    mime = actual;   // trust the bytes, not the label
  }
  return { mime: mime as ImageMime, data: bytes.toString('base64') };
}

// ---- building clips ---------------------------------------------------------

function tableData(input: Record<string, unknown>): { columns: string[]; rows: string[][] } {
  const parsed = typeof input.table === 'string' ? parseMarkdownTable(input.table) : { columns: input.columns, rows: input.rows };
  if (!Array.isArray(parsed.columns) || !parsed.columns.length) throw new ClipError('A table clip needs columns (or a markdown table).');
  if (parsed.columns.length > CLIP_LIMITS.columns) throw new ClipError(`Tables can have at most ${CLIP_LIMITS.columns} columns.`);
  const rowsRaw = Array.isArray(parsed.rows) ? parsed.rows : [];
  if (rowsRaw.length > CLIP_LIMITS.rows) throw new ClipError(`Tables can have at most ${CLIP_LIMITS.rows} rows.`);
  const cell = (v: unknown) => {
    const text = clean(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v, CLIP_LIMITS.cell + 1);
    if (text.length > CLIP_LIMITS.cell) throw new ClipError(`Table cells can be at most ${CLIP_LIMITS.cell} characters.`);
    return text;
  };
  const columns = parsed.columns.map(cell);
  const rows = rowsRaw.map((r) => {
    const row = (Array.isArray(r) ? r : []).slice(0, columns.length).map(cell);
    while (row.length < columns.length) row.push('');
    return row;
  });
  return { columns, rows };
}

function clipData(kind: ClipKind, input: Record<string, unknown>): ClipData {
  switch (kind) {
    case 'quote': {
      const text = cleanText(input.text, CLIP_LIMITS.text, 'quote');
      if (!text) throw new ClipError('A quote clip needs text.');
      const attribution = clean(input.attribution, 200);
      return { kind, text, ...(attribution ? { attribution } : {}) };
    }
    case 'exchange': {
      const raw = Array.isArray(input.turns) ? input.turns : [];
      if (!raw.length) throw new ClipError('An exchange clip needs turns: [{ speaker, text }].');
      if (raw.length > CLIP_LIMITS.turns) throw new ClipError(`An exchange can have at most ${CLIP_LIMITS.turns} turns.`);
      const turns = raw.map((t) => {
        const turn = isRecord(t) ? t : {};
        return { speaker: clean(turn.speaker, 40) || 'unknown', text: cleanText(turn.text, CLIP_LIMITS.text, 'exchange') };
      }).filter((t) => t.text);
      if (!turns.length) throw new ClipError('An exchange clip needs turns with text.');
      return { kind, turns };
    }
    case 'note': {
      const markdown = cleanText(input.markdown ?? input.text, CLIP_LIMITS.text, 'note');
      const blocks = parseMarkdownLite(markdown);
      if (!blocks.length) throw new ClipError('A note clip needs markdown (or text).');
      return { kind, blocks };
    }
    case 'table':
      return { kind, ...tableData(input) };
    case 'image':
      return { kind, ...normalizeImage(input.image, input.svg) };
    case 'link': {
      const url = httpUrl(input.url);
      if (!url) throw new ClipError('A link clip needs an http(s) url.');
      return { kind, url };
    }
  }
}

/** All the words a clip can be found by. */
function textOf(data: ClipData): string {
  switch (data.kind) {
    case 'quote': return [data.text, data.attribution ?? ''].join('\n');
    case 'exchange': return data.turns.map((t) => `${t.speaker}: ${t.text}`).join('\n');
    case 'note': return data.blocks.map((b) => b.text).join('\n');
    case 'table': return [data.columns.join(' | '), ...data.rows.map((r) => r.join(' | '))].join('\n');
    case 'image': return '';
    case 'link': return data.url;
  }
}

function previewOf(data: ClipData): string {
  switch (data.kind) {
    case 'table': return `${data.columns.length} columns × ${data.rows.length} rows: ${data.columns.join(', ')}`;
    case 'image': return `${data.mime === 'image/svg+xml' ? 'SVG' : data.mime.slice(6).toUpperCase()} image, ${Math.ceil(Buffer.from(data.data, 'base64').length / 1000)} KB`;
    case 'exchange': return clean(`${data.turns.length} turns. ${data.turns[0]!.speaker}: ${data.turns[0]!.text}`, 160);
    default: return clean(textOf(data), 160);
  }
}

function defaultTitle(data: ClipData, source: ClipSource): string {
  switch (data.kind) {
    case 'quote': return clean(data.text, 60);
    case 'exchange': return clean(data.turns[0]!.text, 60);
    case 'note': return clean(data.blocks[0]!.text, 60);
    case 'table': return `Table: ${clean(data.columns.join(', '), 50)}`;
    case 'image': return source.title ? `Image from ${source.title}` : 'Image';
    case 'link': return source.title ?? new URL(data.url).hostname;
  }
}

export function newClipId(): string {
  return `c${randomBytes(6).toString('hex')}`;
}

/** Validate what the agent sent and build a clip. Throws ClipError with a readable message. */
export function buildClip(input: Record<string, unknown>, now = new Date(), id = newClipId()): Clip {
  const kind = input.kind as ClipKind;
  if (!CLIP_KINDS.includes(kind)) throw new ClipError(`kind must be one of ${CLIP_KINDS.join(', ')}`);
  const data = clipData(kind, input);
  const source = normalizeSource(input.source);
  const title = clean(input.title, CLIP_LIMITS.title) || defaultTitle(data, source) || kind;
  const note = cleanText(input.note, CLIP_LIMITS.note, 'note') || undefined;
  const at = now.toISOString();
  const clip: Clip = { id, kind, title, ...(note ? { note } : {}), tags: normalizeTags(input.tags), source, preview: previewOf(data), bytes: 0, createdAt: at, updatedAt: at, data };
  clip.bytes = bytesOf(JSON.stringify(clip));
  return clip;
}

/** Apply a title/note/tags change. Content never changes; clip it again instead. */
export function patchClip(clip: Clip, patch: ClipPatch, now = new Date()): Clip {
  const next: Clip = { ...clip, updatedAt: now.toISOString() };
  if (patch.title !== undefined) next.title = clean(patch.title, CLIP_LIMITS.title) || clip.title;
  if (patch.note !== undefined) {
    const note = cleanText(patch.note, CLIP_LIMITS.note, 'note');
    if (note) next.note = note;
    else delete next.note;
  }
  if (patch.tags !== undefined) next.tags = normalizeTags(patch.tags);
  next.bytes = bytesOf(JSON.stringify({ ...next, bytes: 0 }));
  return next;
}

export function searchTextOf(clip: Clip): string {
  return [clip.title, clip.note ?? '', clip.tags.join(' '), clip.source.title ?? '', textOf(clip.data)].join('\n').toLowerCase().slice(0, 40_000);
}

export function queryWords(query: string | undefined): string[] {
  return (query ?? '').toLowerCase().split(/\s+/).map((w) => w.replace(/^#/, '')).filter(Boolean).slice(0, 10);
}

export function summaryOf(clip: Clip): ClipSummary {
  const { data: _data, ...summary } = clip;
  return summary;
}

export function clampLimit(limit: unknown, fallback = 20, max = 50): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : fallback;
}

function overLimit(existing: ClipSummary[], adding: Clip): string | undefined {
  if (existing.length >= CLIP_LIMITS.perUser) return `You have ${CLIP_LIMITS.perUser} clips, the most MCPortal keeps. Delete some first.`;
  const bytes = existing.reduce((sum, c) => sum + c.bytes, 0);
  if (bytes + adding.bytes > CLIP_LIMITS.bytesPerUser) return `Your clips use ${Math.round(bytes / 1e6)} MB of the ${CLIP_LIMITS.bytesPerUser / 1e6} MB allowed. Delete some (large images first).`;
  return undefined;
}

// ---- stores -----------------------------------------------------------------

export interface ClipStore {
  /** Throws ClipError when the user is at a limit. */
  add(userId: string, clip: Clip): Promise<void>;
  get(userId: string, id: string): Promise<Clip | undefined>;
  /** Newest first, without content. */
  list(userId: string, query?: ClipQuery): Promise<ClipSummary[]>;
  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined>;
  delete(userId: string, id: string): Promise<boolean>;
  /** Every clip of the user (account deletion). Returns how many. */
  deleteAll(userId: string): Promise<number>;
  usage(userId: string): Promise<{ count: number; bytes: number }>;
}

/** Filtering shared by the in-process stores. */
export function filterClips(clips: Clip[], query: ClipQuery = {}): ClipSummary[] {
  const words = queryWords(query.query);
  const tag = query.tag ? normalizeTags([query.tag])[0] : undefined;
  return clips
    .filter((c) => (!query.kind || c.kind === query.kind)
      && (!tag || c.tags.includes(tag))
      && (!query.before || c.createdAt < query.before)
      && (!words.length || words.every((w) => searchTextOf(c).includes(w))))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
    .slice(0, clampLimit(query.limit, 20, CLIP_LIMITS.perUser))
    .map(summaryOf);
}

/** A whole user's clips in one place (memory or one file), behind the store interface. */
abstract class DocumentClipStore implements ClipStore {
  private mutex = new KeyedMutex();
  protected abstract load(userId: string): Promise<Clip[]>;
  protected abstract save(userId: string, clips: Clip[]): Promise<void>;
  protected now: () => Date = () => new Date();

  private edit<T>(userId: string, change: (clips: Clip[]) => { clips?: Clip[]; result: T }): Promise<T> {
    return this.mutex.run(userId, async () => {
      const { clips, result } = change(await this.load(userId));
      if (clips) await this.save(userId, clips);
      return result;
    });
  }

  add(userId: string, clip: Clip): Promise<void> {
    return this.edit(userId, (clips) => {
      const refused = overLimit(clips, clip);
      if (refused) throw new ClipError(refused, 'limit_exceeded');
      return { clips: [clip, ...clips.filter((c) => c.id !== clip.id)], result: undefined };
    });
  }

  async get(userId: string, id: string): Promise<Clip | undefined> {
    const clips = await this.mutex.run(userId, () => this.load(userId));
    return structuredClone(clips.find((c) => c.id === id));
  }

  async list(userId: string, query?: ClipQuery): Promise<ClipSummary[]> {
    return filterClips(await this.mutex.run(userId, () => this.load(userId)), query);
  }

  update(userId: string, id: string, patch: ClipPatch): Promise<Clip | undefined> {
    return this.edit(userId, (clips) => {
      const at = clips.findIndex((c) => c.id === id);
      if (at === -1) return { result: undefined };
      const next = patchClip(clips[at]!, patch, this.now());
      return { clips: clips.map((c, i) => (i === at ? next : c)), result: structuredClone(next) };
    });
  }

  delete(userId: string, id: string): Promise<boolean> {
    return this.edit(userId, (clips) => {
      const rest = clips.filter((c) => c.id !== id);
      return rest.length === clips.length ? { result: false } : { clips: rest, result: true };
    });
  }

  deleteAll(userId: string): Promise<number> {
    return this.edit(userId, (clips) => ({ clips: [], result: clips.length }));
  }

  async usage(userId: string): Promise<{ count: number; bytes: number }> {
    const clips = await this.mutex.run(userId, () => this.load(userId));
    return { count: clips.length, bytes: clips.reduce((sum, c) => sum + c.bytes, 0) };
  }
}

export class MemoryClipStore extends DocumentClipStore {
  private data = new Map<string, Clip[]>();

  protected async load(userId: string): Promise<Clip[]> {
    return structuredClone(this.data.get(userId) ?? []);
  }

  protected async save(userId: string, clips: Clip[]): Promise<void> {
    this.data.set(userId, structuredClone(clips));
  }
}

/**
 * `<dataDir>/clips/<user>.json`, written atomically. A subdirectory, so the
 * Postgres import (top-level *.json only) never mistakes it for a profile.
 */
export class FileClipStore extends DocumentClipStore {
  dir: string;

  constructor(dataDir = defaultDataDir()) {
    super();
    this.dir = path.join(dataDir, 'clips');
  }

  private file(userId: string): string {
    return path.join(this.dir, `${safeFileId(userId)}.json`);
  }

  protected async load(userId: string): Promise<Clip[]> {
    let raw: string;
    try {
      raw = await readFile(this.file(userId), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const parsed = JSON.parse(raw) as { clips?: unknown };
    return Array.isArray(parsed.clips) ? (parsed.clips as Clip[]) : [];
  }

  protected async save(userId: string, clips: Clip[]): Promise<void> {
    await atomicWrite(this.file(userId), `${JSON.stringify({ version: 1, clips })}\n`);
  }
}
