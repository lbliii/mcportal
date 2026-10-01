/**
 * Data portability (identity plan): your room is yours to move.
 *
 *   mcportal   one versioned JSON file: layout and sources, saved items, pinned
 *              items, clips and the public profile. Import it into any MCPortal.
 *   bookmarks  saved items as a Netscape bookmarks file (browsers, bookmark managers)
 *   clips      clips as Markdown files with front matter, images alongside, in a .tar.gz
 *   opml       sources as OPML (any feed reader)
 *
 * Imports only ever add: portals that aren't there yet, saved items by URL, clips
 * that aren't already kept. Everything in an import is untrusted and re-validated.
 */
import { gzipSync } from 'node:zlib';
import { buildClip, ClipError, CLIP_KINDS, type Clip, type ClipStore } from './clips.ts';
import { clipText } from './clip-tools.ts';
import { buildOpml } from './opml.ts';
import { LIMITS, normalizePinnedItems, normalizeSaved, ProfileError, validateProfile, type PortalSpec, type Profile } from './profile.ts';
import type { PublicProfile } from './public-profiles.ts';
import type { SharedItem, Social } from './social.ts';
import type { ReadingStore, ReadingState } from './reading.ts';
import type { ProfileStore } from './store.ts';
import { addPortalTo } from './tools.ts';
import type { ArticleBlock } from './types.ts';

export const EXPORT_FORMATS = ['mcportal', 'bookmarks', 'clips', 'opml'] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];
export const EXPORT_VERSION = 1;

export interface ExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
  /** One line for the user: what's in it. */
  summary: string;
}

export interface PortalExport {
  format: 'mcportal-export';
  version: number;
  exportedAt: string;
  profile: Profile;
  clips: Clip[];
  reading?: ReadingState[];
  publicProfile: Pick<PublicProfile, 'handle' | 'displayName' | 'bio'> | null;
  /** Your shares (with the content as shared) and who you follow, by handle. Not imported. */
  shares?: Array<Omit<SharedItem, 'author' | 'mine'>>;
  following?: string[];
}

export interface ExportSources {
  store: ProfileStore;
  reading?: ReadingStore;
  clips?: ClipStore;
  publicProfile?: PublicProfile;
  social?: Social;
}

async function allClips(clips: ClipStore | undefined, userId: string): Promise<Clip[]> {
  if (!clips) return [];
  const summaries = await clips.list(userId, { limit: 100_000 });
  const full = await Promise.all(summaries.map((s) => clips.get(userId, s.id)));
  return full.filter((c): c is Clip => Boolean(c));
}

const stamp = (now: Date) => now.toISOString().slice(0, 10);

export async function buildExport(format: ExportFormat, userId: string, from: ExportSources, now = new Date()): Promise<ExportFile> {
  const profile = await from.store.get(userId);
  if (format === 'opml') {
    const { opml, count } = buildOpml(profile, now);
    return { filename: `mcportal-subscriptions-${stamp(now)}.opml`, contentType: 'text/x-opml; charset=utf-8', body: Buffer.from(opml), summary: `${count} source(s) as OPML` };
  }
  if (format === 'bookmarks') {
    return { filename: `mcportal-bookmarks-${stamp(now)}.html`, contentType: 'text/html; charset=utf-8', body: Buffer.from(bookmarksHtml(profile)), summary: `${profile.saved.length} saved item(s) as a bookmarks file` };
  }
  const clips = await allClips(from.clips, userId);
  if (format === 'clips') {
    return { filename: `mcportal-clips-${stamp(now)}.tar.gz`, contentType: 'application/gzip', body: clipsArchive(clips, now), summary: `${clips.length} clip(s) as Markdown` };
  }
  const p = from.publicProfile;
  const data: PortalExport = {
    format: 'mcportal-export',
    version: EXPORT_VERSION,
    exportedAt: now.toISOString(),
    profile,
    clips,
    reading: await from.reading?.list(userId, { limit: 1000 }) ?? [],
    publicProfile: p ? { handle: p.handle, ...(p.displayName ? { displayName: p.displayName } : {}), ...(p.bio ? { bio: p.bio } : {}) } : null,
  };
  if (from.social) {
    data.shares = (await from.social.sharesOf(userId, userId, { limit: 100_000 })).map(({ author: _a, mine: _m, ...s }) => s);
    data.following = (await from.social.connections(userId)).following;
  }
  const portals = profile.columns.reduce((n, c) => n + c.panels.length, 0);
  return {
    filename: `mcportal-export-${stamp(now)}.json`,
    contentType: 'application/json; charset=utf-8',
    body: Buffer.from(`${JSON.stringify(data, null, 2)}\n`),
    summary: `${portals} portal(s), ${profile.saved.length} saved item(s) and ${clips.length} clip(s)`,
  };
}

// ---- bookmarks ----------------------------------------------------------------

const html = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function bookmarksHtml(profile: Profile): string {
  const items = profile.saved.map((s) => {
    const added = Math.floor(Date.parse(s.savedAt) / 1000);
    return `        <DT><A HREF="${html(s.url)}" ADD_DATE="${added}">${html(s.title)}</A>${s.note ? `\n        <DD>${html(s.note)}` : ''}`;
  });
  return [
    '<!DOCTYPE NETSCAPE-Bookmark-file-1>',
    '<!-- Saved items exported from MCPortal. -->',
    '<META HTTP-EQUIV="Content-Type" CONTENT="text/html; charset=UTF-8">',
    '<TITLE>Bookmarks</TITLE>',
    '<H1>Bookmarks</H1>',
    '<DL><p>',
    '    <DT><H3>MCPortal saved</H3>',
    '    <DL><p>',
    ...items,
    '    </DL><p>',
    '</DL><p>',
    '',
  ].join('\n');
}

// ---- clips as Markdown ----------------------------------------------------------

const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/svg+xml': 'svg' };

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'clip';
}

/** One clip as Markdown with YAML front matter (JSON strings are valid YAML scalars). */
export function clipMarkdown(clip: Clip, imagePath?: string): string {
  const y = (v: string) => JSON.stringify(v);
  const front = [
    '---',
    `id: ${y(clip.id)}`,
    `kind: ${clip.kind}`,
    `title: ${y(clip.title)}`,
    `tags: [${clip.tags.map(y).join(', ')}]`,
    `source: ${y(clip.source.kind)}`,
    clip.source.url ? `source_url: ${y(clip.source.url)}` : '',
    clip.source.title ? `source_title: ${y(clip.source.title)}` : '',
    `created: ${clip.createdAt}`,
    `updated: ${clip.updatedAt}`,
    '---',
  ].filter(Boolean);
  const body = clip.data.kind === 'image'
    ? `![${clip.title.replace(/[[\]]/g, '')}](${imagePath})`
    : clip.data.kind === 'quote'
      ? clipText(clip.data).split('\n').map((l) => `> ${l}`).join('\n')
      : clipText(clip.data);
  return [...front, '', `# ${clip.title}`, '', ...(clip.note ? [`*${clip.note.replace(/\*/g, '\\*')}*`, ''] : []), body, ''].join('\n');
}

/** A ustar archive, written by hand to stay dependency-free. Names must fit in 100 bytes. */
export function tar(files: Array<{ name: string; body: Buffer; mtime: number }>): Buffer {
  const blocks: Buffer[] = [];
  for (const file of files) {
    const header = Buffer.alloc(512);
    const field = (value: string, offset: number, length: number) => header.write(value, offset, length, 'utf8');
    const octal = (n: number, length: number) => `${n.toString(8).padStart(length - 1, '0')}\0`;
    field(file.name, 0, 100);
    field(octal(0o644, 8), 100, 8);
    field(octal(0, 8), 108, 8);
    field(octal(0, 8), 116, 8);
    field(octal(file.body.length, 12), 124, 12);
    field(octal(Math.floor(file.mtime / 1000), 12), 136, 12);
    field('        ', 148, 8);
    field('0', 156, 1);
    field('ustar\0', 257, 6);
    field('00', 263, 2);
    let sum = 0;
    for (const byte of header) sum += byte;
    field(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8);
    blocks.push(header, file.body, Buffer.alloc((512 - (file.body.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function clipsArchive(clips: Clip[], now = new Date()): Buffer {
  const dir = 'mcportal-clips';
  const files: Array<{ name: string; body: Buffer; mtime: number }> = [];
  for (const clip of clips) {
    const base = `${clip.createdAt.slice(0, 10)}-${slug(clip.title)}-${clip.id}`;
    let imagePath: string | undefined;
    if (clip.data.kind === 'image') {
      imagePath = `assets/${clip.id}.${EXT[clip.data.mime] ?? 'bin'}`;
      files.push({ name: `${dir}/${imagePath}`, body: Buffer.from(clip.data.data, 'base64'), mtime: Date.parse(clip.createdAt) });
    }
    files.push({ name: `${dir}/${base}.md`, body: Buffer.from(clipMarkdown(clip, imagePath)), mtime: Date.parse(clip.updatedAt) });
  }
  files.push({ name: `${dir}/README.md`, body: Buffer.from(`# MCPortal clips\n\nExported ${now.toISOString()}. One Markdown file per clip, with its details in the front matter; images are in assets/.\n`), mtime: now.getTime() });
  return gzipSync(tar(files));
}

// ---- import -------------------------------------------------------------------

export interface ImportResult {
  portalsAdded: number;
  portalsSkipped: string[];
  layoutAdopted: boolean;
  savedAdded: number;
  clipsAdded: number;
  clipsSkipped: number;
  clipErrors: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Note blocks back to markdown-lite, so imported notes go through the same parser. */
function blocksToMarkdown(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks.filter(isRecord).map((b) => {
    const text = String(b.text ?? '');
    return b.type === 'h' ? `## ${text}` : b.type === 'li' ? `- ${text}` : b.type === 'quote' ? text.split('\n').map((l) => `> ${l}`).join('\n') : b.type === 'pre' ? `\`\`\`\n${text}\n\`\`\`` : text;
  }).join('\n\n');
}

/** An exported clip as `clip` tool input, so it's validated exactly like a new one. */
function clipInput(raw: Record<string, unknown>): Record<string, unknown> {
  const data = isRecord(raw.data) ? raw.data : {};
  const base = { kind: raw.kind, title: raw.title, note: raw.note, tags: raw.tags, source: raw.source };
  switch (raw.kind) {
    case 'quote': return { ...base, text: data.text, attribution: data.attribution };
    case 'exchange': return { ...base, turns: data.turns };
    case 'note': return { ...base, markdown: blocksToMarkdown(data.blocks as ArticleBlock[]) };
    case 'table': return { ...base, columns: data.columns, rows: data.rows };
    case 'image': return { ...base, image: { mime: data.mime, data: data.data } };
    case 'link': return { ...base, url: data.url };
    default: return base;
  }
}

const portalKey = (p: PortalSpec) => `${p.source}:${JSON.stringify({ ...p.config, limit: undefined })}`;

/** Parse and check an export file's envelope. Throws with a readable message. */
export function parseExport(text: string): PortalExport {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProfileError('That is not an MCPortal export (it isn\'t JSON).');
  }
  if (!isRecord(data) || data.format !== 'mcportal-export') throw new ProfileError('That is not an MCPortal export (no "format": "mcportal-export").');
  if (typeof data.version !== 'number' || data.version > EXPORT_VERSION) throw new ProfileError(`This export is version ${String(data.version)}; this MCPortal reads up to version ${EXPORT_VERSION}. Update MCPortal first.`);
  return data as unknown as PortalExport;
}

/** Add an export to a room. Never removes or rearranges anything. */
export async function importExport(data: PortalExport, userId: string, to: { store: ProfileStore; reading?: ReadingStore; clips?: ClipStore }): Promise<ImportResult> {
  const result: ImportResult = { portalsAdded: 0, portalsSkipped: [], layoutAdopted: false, savedAdded: 0, clipsAdded: 0, clipsSkipped: 0, clipErrors: [] };
  const before = await to.store.get(userId);
  let incoming: Profile | undefined;
  try {
    incoming = isRecord(data.profile) ? validateProfile(data.profile) : undefined;
  } catch (error) {
    if (!(error instanceof ProfileError)) throw error;
    result.portalsSkipped.push(`the layout (${error.message})`);
  }
  let profile = before;
  if (incoming && !before.onboarded) {
    // A brand-new room takes the exported layout as it is.
    profile = { ...incoming, saved: before.saved, onboarded: true };
    result.layoutAdopted = true;
    result.portalsAdded = incoming.columns.reduce((n, c) => n + c.panels.length, 0);
  } else if (incoming) {
    const have = new Set(before.columns.flatMap((c) => c.panels).map(portalKey));
    for (const spec of incoming.columns.flatMap((c) => c.panels)) {
      if (have.has(portalKey(spec))) continue;
      const added = addPortalTo(profile, { ...spec, id: spec.id });
      if ('error' in added) {
        result.portalsSkipped.push(`${spec.title ?? spec.id} (${added.error})`);
        continue;
      }
      profile = added.profile;
      if (spec.source === 'pinned' && incoming.pins[spec.id]) {
        profile = { ...profile, pins: { ...profile.pins, [added.portalId]: { items: normalizePinnedItems(incoming.pins[spec.id]!.items), pinnedAt: incoming.pins[spec.id]!.pinnedAt } } };
      }
      have.add(portalKey(spec));
      result.portalsAdded++;
    }
  }
  if (incoming) {
    const urls = new Set(profile.saved.map((s) => s.url));
    const fresh = incoming.saved.filter((s) => !urls.has(s.url));
    const merged = normalizeSaved([...profile.saved, ...fresh].sort((a, b) => (a.savedAt < b.savedAt ? 1 : -1)));
    result.savedAdded = merged.filter((s) => !urls.has(s.url)).length;
    profile = { ...profile, saved: merged.slice(0, LIMITS.saved) };
  }
  if (profile !== before) await to.store.put(userId, profile);

  if (to.clips && Array.isArray(data.clips)) {
    const existing = await to.clips.list(userId, { limit: 100_000 });
    const seen = new Set(existing.map((c) => `${c.kind}|${c.title}|${c.createdAt}`));
    for (const raw of data.clips) {
      if (!isRecord(raw) || !CLIP_KINDS.includes(raw.kind as never)) continue;
      const created = typeof raw.createdAt === 'string' && !Number.isNaN(Date.parse(raw.createdAt)) ? new Date(raw.createdAt) : new Date();
      try {
        const clip = buildClip(clipInput(raw), created);
        if (seen.has(`${clip.kind}|${clip.title}|${clip.createdAt}`)) {
          result.clipsSkipped++;
          continue;
        }
        await to.clips.add(userId, clip);
        seen.add(`${clip.kind}|${clip.title}|${clip.createdAt}`);
        result.clipsAdded++;
      } catch (error) {
        if (!(error instanceof ClipError)) throw error;
        result.clipErrors.push(`${String(raw.title ?? raw.kind).slice(0, 60)}: ${error.message}`);
        if (/clips, the most|MB allowed/.test(error.message)) break;
      }
    }
  }
  if (to.reading && Array.isArray(data.reading)) await to.reading.import(userId, data.reading);
  return result;
}

export function describeImport(r: ImportResult): string {
  const parts = [
    r.layoutAdopted ? `took the exported layout (${r.portalsAdded} portals)` : `${r.portalsAdded} portal(s) added`,
    `${r.savedAdded} saved item(s) added`,
    `${r.clipsAdded} clip(s) added${r.clipsSkipped ? ` (${r.clipsSkipped} already here)` : ''}`,
  ];
  const problems = [...r.portalsSkipped.map((p) => `portal skipped: ${p}`), ...r.clipErrors.slice(0, 5).map((c) => `clip skipped: ${c}`)];
  return `Imported: ${parts.join(', ')}.${problems.length ? `\n${problems.join('\n')}` : ''}`;
}

/** Local MCPortal: write the export into `<data dir>/exports/` and say where. */
export async function deliverToFile(format: ExportFormat, userId: string, from: ExportSources, dataDir: string): Promise<{ kind: 'file'; where: string; summary: string }> {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const path = await import('node:path');
  const file = await buildExport(format, userId, from);
  const dir = path.join(dataDir, 'exports');
  await mkdir(dir, { recursive: true });
  const where = path.join(dir, file.filename);
  await writeFile(where, file.body, { mode: 0o600 });
  return { kind: 'file', where, summary: file.summary };
}
