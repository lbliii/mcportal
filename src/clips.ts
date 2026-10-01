/**
 * Clips: typed snippets the user asked to keep from a conversation or an article
 * (docs/plans/clips.md). Kept out of the profile, since tables and images would
 * bloat the one document every layout edit rewrites.
 *
 * Everything in a clip is untrusted plain text or checked image bytes. Text keeps
 * its line breaks (unlike portal items); markdown-lite is parsed into blocks and
 * never interpreted as HTML. SVG is only ever shown as an <img>, so nothing in it runs.
 *
 * Stores (ClipStore, MemoryClipStore, FileClipStore) live in clip-stores.ts and are
 * re-exported from here.
 */
import { randomBytes } from 'node:crypto';
import { httpUrl } from './profile.ts';
import { AppError, type AppErrorOptions, type ErrorCode } from './lib/errors.ts';
import { parseMarkdownLite } from './lib/markdown.ts';
import { clean } from './lib/text.ts';
import { CLIP_KINDS, type ArticleBlock, type ClipKind } from './types.ts';

export { parseMarkdownLite };

export { CLIP_KINDS, type ClipKind };

export { FileClipStore, filterClips, MemoryClipStore, type ClipStore } from './clip-stores.ts';

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
  kind?: ClipKind | undefined;
  tag?: string | undefined;
  /** Words that must all appear (title, note, tags, text). */
  query?: string | undefined;
  limit?: number | undefined;
  /** Only clips created before this ISO time (paging). */
  before?: string | undefined;
}

export interface ClipPatch {
  title?: string | undefined;
  note?: string | undefined;
  tags?: string[] | undefined;
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
    if (!m) throw new ClipError('image must be a data: URI (data:image/png;base64,…), { mime, data }, or SVG markup.');
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
/**
 * The clip tool's input as buildClip takes it: one `content` text for every kind but an
 * exchange (turns), read by kind: a quote's text, a note's markdown, a markdown table, a
 * link's url, or an image as SVG markup or a data: URI.
 */
export function fromContent(input: Record<string, unknown>): Record<string, unknown> {
  const { content, ...rest } = input;
  if (rest.kind === 'exchange') return rest;
  if (!CLIP_KINDS.includes(rest.kind as ClipKind)) return rest;   // buildClip says which kinds there are
  if (typeof content !== 'string' || !content.trim()) throw new ClipError(`A ${rest.kind as string} clip needs content.`);
  switch (rest.kind) {
    case 'quote': return { ...rest, text: content };
    case 'note': return { ...rest, markdown: content };
    case 'table': return { ...rest, table: content };
    case 'link': return { ...rest, url: content.trim() };
    case 'image': return content.trimStart().startsWith('<') ? { ...rest, svg: content } : { ...rest, image: content.trim() };
  }
  return rest;
}

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

/** Table rows the model gets as text; the clip card shows them all. */
const MODEL_TABLE_ROWS = 100;

/** The clip's content as text for the model. */
export function clipText(data: ClipData): string {
  switch (data.kind) {
    case 'quote': return `${data.text}${data.attribution ? `\n— ${data.attribution}` : ''}`;
    case 'exchange': return data.turns.map((t) => `${t.speaker}: ${t.text}`).join('\n\n');
    case 'note': return data.blocks.map((b) => (b.type === 'h' ? `## ${b.text}` : b.type === 'li' ? `- ${b.text}` : b.type === 'quote' ? `> ${b.text}` : b.type === 'pre' ? `\`\`\`\n${b.text}\n\`\`\`` : b.text)).join('\n\n');
    case 'table': {
      const row = (cells: string[]) => `| ${cells.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`;
      const lines = [row(data.columns), row(data.columns.map(() => '---')), ...data.rows.slice(0, MODEL_TABLE_ROWS).map(row)];
      if (data.rows.length > MODEL_TABLE_ROWS) lines.push(`(${data.rows.length - MODEL_TABLE_ROWS} more rows; the clip card shows them all)`);
      return lines.join('\n');
    }
    case 'image': return `[${data.mime} image, ${Math.ceil(Buffer.from(data.data, 'base64').length / 1000)} KB: shown in the clip card]`;
    case 'link': return data.url;
  }
}

export function clampLimit(limit: unknown, fallback = 20, max = 50): number {
  const n = typeof limit === 'number' ? limit : Number(limit);
  return Number.isFinite(n) ? Math.min(max, Math.max(1, Math.round(n))) : fallback;
}
