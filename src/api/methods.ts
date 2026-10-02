/**
 * The hosted state API's methods: the storage and social interfaces the tools use
 * (ProfileStore, ClipStore, ReadingStore, SeenStore, HandoffStore, SocialService,
 * ProfileDirectory), as a linked local MCPortal calls them.
 *
 * The rule for each: the server checks what the store would otherwise trust its
 * caller with, the same way the tool does. So clips are rebuilt here (buildClip, with
 * an id the server picks), shares name a clip or saved item the server looks up, seen
 * marks are limited to portals in the room, and featured sources must be portals in
 * the room. Other people's account ids never leave: they're "@handle" here (publicRef).
 * Where a tool's inputSchema already describes a method's params, it's reused.
 *
 * Left out on purpose: anything that deletes everything or imports (deleteAll,
 * import), moderation and admin, and account deletion. Those stay on their pages.
 */
import { clipInput } from '../portability.ts';
import { buildClip, CLIP_LIMITS, newClipId, type ClipKind } from '../clips.ts';
import { AppError } from '../lib/errors.ts';
import { clean } from '../lib/text.ts';
import { httpUrl, validateProfile, type Profile } from '../profile.ts';
import { validateReadingUpdate, type ReadingUpdate } from '../reading.ts';
import { tracksSeen } from '../seen.ts';
import { AUDIENCES } from '../social.ts';
import { SERVER_INFO } from '../mcp.ts';
import { findTool } from '../tools/index.ts';
import { need, type ToolContext } from '../tools/kit.ts';
import { CLIP_KINDS } from '../types.ts';
import { MIN_CLIENT_VERSION, type ApiMethod } from './calls.ts';

const NO_PARAMS = { type: 'object', additionalProperties: false, properties: {} };
const id = { type: 'string', maxLength: 100 };
const handle = { type: 'string', maxLength: 40 };
const pageQuery = { type: 'object', additionalProperties: false, properties: { limit: { type: 'integer', minimum: 1, maximum: 100 }, before: { type: 'string', maxLength: 40 } } };
const portalIds = { type: 'array', maxItems: 64, items: { type: 'string', maxLength: 80 } };

/** A tool's own argument schema, for a method whose params are the same. */
function toolSchema(name: string): Record<string, unknown> {
  const tool = findTool(name);
  if (!tool) throw new Error(`no tool ${name}`);
  return tool.inputSchema;
}

function params<T>(schema: Record<string, unknown>, run: (p: T, ctx: ToolContext) => Promise<unknown>, access: 'read' | 'write' = 'read', cost = 1): ApiMethod {
  return { access, cost, params: schema, run: (p, ctx) => run(p as T, ctx) };
}

const clipsOf = (ctx: ToolContext) => need(ctx.clips, 'Clips are not available on this server.');
const readingOf = (ctx: ToolContext) => need(ctx.reading, 'Reading history is not available on this server.');
const seenOf = (ctx: ToolContext) => need(ctx.seen, 'Seen tracking is not available on this server.');
const handoffsOf = (ctx: ToolContext) => need(ctx.handoffs, 'Handoffs are not available on this server.');
const socialOf = (ctx: ToolContext) => need(ctx.social, 'Sharing is not available on this server.');
const profilesOf = (ctx: ToolContext) => need(ctx.publicProfiles, 'Public profiles are not available on this server.');

const portalsOf = (profile: Profile) => profile.columns.flatMap((c) => c.panels);

/**
 * Account ids never leave the server: other people are referred to by "@handle"
 * where a public profile would carry their id (the caller's own id stays, so tools
 * can tell "me" from "them").
 */
function publicRef<P extends { accountId: string; handle: string }>(profile: P, ctx: ToolContext): P {
  return profile.accountId === ctx.userId ? profile : { ...profile, accountId: `@${profile.handle}` };
}

/** An "@handle" from publicRef back to the account, as the caller may see it; or the caller's own id. */
async function accountOf(ref: string, ctx: ToolContext): Promise<string> {
  if (ref === ctx.userId) return ref;
  if (!ref.startsWith('@')) throw new AppError('invalid_argument', 'Name other people by @handle.');
  return (await socialOf(ctx).resolve(ctx.userId, ref)).accountId;
}

export const API_METHODS: Record<string, ApiMethod> = {
  /** Who the token belongs to, and the versions, for link_status and update nudges. */
  me: params(NO_PARAMS, async (_p, ctx) => ({
    accountId: ctx.userId,
    login: ctx.actor?.login ?? null,
    handle: (await ctx.publicProfiles?.get(ctx.userId))?.handle ?? null,
    server: { version: SERVER_INFO.version, minClientVersion: MIN_CLIENT_VERSION },
  }), 'read', 0),

  // ---- the room (ProfileStore), with revisions
  'room.get': params<{ ifNoneMatch?: number }>(
    { type: 'object', additionalProperties: false, properties: { ifNoneMatch: { type: 'integer', minimum: 0 } } },
    async ({ ifNoneMatch }, ctx) => {
      const { profile, rev } = await ctx.store.versioned(ctx.userId);
      const notice = ctx.store.takeNotice?.(ctx.userId);
      if (ifNoneMatch === rev && !notice) return { unchanged: true, rev };
      return { profile, rev, ...(notice ? { notice } : {}) };
    }),
  /** The whole room, validated here; with ifMatch, only if nothing changed it since. */
  'room.put': params<{ profile: unknown; ifMatch?: number }>(
    { type: 'object', required: ['profile'], additionalProperties: false, properties: { profile: { type: 'object' }, ifMatch: { type: 'integer', minimum: 0 } } },
    async ({ profile, ifMatch }, ctx) => {
      const valid = validateProfile(profile);
      if (ifMatch !== undefined) return { rev: await ctx.store.replaceIf(ctx.userId, valid, ifMatch) };
      await ctx.store.put(ctx.userId, valid);
      return { rev: (await ctx.store.versioned(ctx.userId)).rev };
    }, 'write'),

  // ---- clips
  /** Rebuilt from its content, exactly like a new clip, with an id this server picks. */
  'clips.add': params<{ clip: Record<string, unknown> }>(
    { type: 'object', required: ['clip'], additionalProperties: false, properties: { clip: { type: 'object' } } },
    async ({ clip }, ctx) => {
      if (!CLIP_KINDS.includes(clip.kind as ClipKind)) throw new AppError('invalid_argument', 'Unknown clip kind.');
      return clipsOf(ctx).add(ctx.userId, buildClip(clipInput(clip), new Date(), newClipId()));
    }, 'write'),
  'clips.get': params<{ id: string }>({ type: 'object', required: ['id'], additionalProperties: false, properties: { id } },
    async (p, ctx) => (await clipsOf(ctx).get(ctx.userId, p.id)) ?? null),
  'clips.list': params<{ kind?: ClipKind; tag?: string; query?: string; limit?: number; before?: string }>(
    { type: 'object', additionalProperties: false, properties: {
      kind: { type: 'string', enum: CLIP_KINDS }, tag: { type: 'string', maxLength: 60 }, query: { type: 'string', maxLength: 300 },
      limit: { type: 'integer', minimum: 1, maximum: 50 }, before: { type: 'string', maxLength: 40 },
    } },
    async (query, ctx) => {
      if (query.before !== undefined && Number.isNaN(Date.parse(query.before))) throw new AppError('invalid_argument', 'before must be a clip\'s createdAt.');
      return clipsOf(ctx).list(ctx.userId, query);
    }),
  'clips.update': params<{ id: string; patch: { title?: string; note?: string; tags?: string[] } }>(
    { type: 'object', required: ['id', 'patch'], additionalProperties: false, properties: { id, patch: { type: 'object', additionalProperties: false, properties: {
      title: { type: 'string', maxLength: CLIP_LIMITS.title }, note: { type: 'string', maxLength: CLIP_LIMITS.note }, tags: { type: 'array', maxItems: CLIP_LIMITS.tags, items: { type: 'string', maxLength: 60 } },
    } } } },
    async (p, ctx) => (await clipsOf(ctx).update(ctx.userId, p.id, p.patch)) ?? null, 'write'),
  'clips.delete': params<{ id: string }>({ type: 'object', required: ['id'], additionalProperties: false, properties: { id } },
    (p, ctx) => clipsOf(ctx).delete(ctx.userId, p.id), 'write'),
  'clips.usage': params(NO_PARAMS, (_p, ctx) => clipsOf(ctx).usage(ctx.userId)),

  // ---- reading history
  'reading.get': params<{ url: string }>({ type: 'object', required: ['url'], additionalProperties: false, properties: { url: { type: 'string', maxLength: 4096 } } },
    async (p, ctx) => (await readingOf(ctx).get(ctx.userId, p.url)) ?? null),
  'reading.record': params<ReadingUpdate>(toolSchema('record_reading'),
    (update, ctx) => readingOf(ctx).record(ctx.userId, validateReadingUpdate(update)), 'write'),
  'reading.list': params<{ unfinished?: boolean; limit?: number }>(
    { type: 'object', additionalProperties: false, properties: { unfinished: { type: 'boolean' }, limit: { type: 'integer', minimum: 1, maximum: 100 } } },
    (options, ctx) => readingOf(ctx).list(ctx.userId, options)),

  // ---- seen sets: only portals in the room that track them, as mark_seen does
  'seen.get': params<{ portalIds: string[] }>({ type: 'object', required: ['portalIds'], additionalProperties: false, properties: { portalIds } },
    async (p, ctx) => Object.fromEntries([...(await seenOf(ctx).get(ctx.userId, p.portalIds))].map(([portal, items]) => [portal, [...items]]))),
  'seen.mark': params<{ marks: Array<{ portalId: string; itemIds: string[] }> }>(
    { type: 'object', required: ['marks'], additionalProperties: false, properties: { marks: (toolSchema('mark_seen').properties as Record<string, unknown>).portals } },
    async (p, ctx) => {
      const tracked = new Set(portalsOf(await ctx.store.get(ctx.userId)).filter((s) => tracksSeen(s.source)).map((s) => s.id));
      const marks = p.marks.filter((m) => tracked.has(m.portalId) && m.itemIds.length);
      await seenOf(ctx).mark(ctx.userId, marks);
      return { marked: marks.reduce((n, m) => n + m.itemIds.length, 0) };
    }, 'write'),
  /** Forget seen sets of portals no longer in the room (the room is read here, not sent). */
  'seen.prune': params(NO_PARAMS, async (_p, ctx) => {
    await seenOf(ctx).keepOnly(ctx.userId, portalsOf(await ctx.store.get(ctx.userId)).map((s) => s.id));
    return null;
  }, 'write'),

  // ---- handoffs
  'handoffs.create': params<Record<string, unknown>>(toolSchema('create_handoff'), (input, ctx) => handoffsOf(ctx).create(ctx.userId, input as never), 'write'),
  'handoffs.get': params<{ code: string }>({ type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', maxLength: 20 } } },
    async (p, ctx) => (await handoffsOf(ctx).get(ctx.userId, p.code)) ?? null),
  'handoffs.list': params(NO_PARAMS, (_p, ctx) => handoffsOf(ctx).list(ctx.userId)),
  'handoffs.markOpened': params<{ code: string }>({ type: 'object', required: ['code'], additionalProperties: false, properties: { code: { type: 'string', maxLength: 20 } } },
    async (p, ctx) => { await handoffsOf(ctx).markOpened(ctx.userId, p.code); return null; }, 'write'),

  // ---- public profiles: anyone's by handle, only your own otherwise
  'profiles.mine': params(NO_PARAMS, async (_p, ctx) => (await profilesOf(ctx).get(ctx.userId)) ?? null),
  'profiles.byHandle': params<{ handle: string }>({ type: 'object', required: ['handle'], additionalProperties: false, properties: { handle } },
    async (p, ctx) => {
      const found = await profilesOf(ctx).byHandle(p.handle);
      return found ? { ...found, profile: publicRef(found.profile, ctx) } : null;
    }),
  /** Featured sources must be portals in the room, as set_public_profile picks them. */
  'profiles.set': params<{ handle?: string; displayName?: string; bio?: string; spaceTitle?: string; accent?: string; sources?: Array<{ title?: string; source: string; config: unknown }> }>(
    { type: 'object', additionalProperties: false, properties: {
      handle, displayName: { type: 'string', maxLength: 50 }, bio: { type: 'string', maxLength: 160 }, spaceTitle: { type: 'string', maxLength: 60 }, accent: { type: 'string', maxLength: 20 },
      sources: { type: 'array', maxItems: 12, items: { type: 'object', required: ['source', 'config'], additionalProperties: false, properties: { title: { type: 'string', maxLength: 80 }, source: { type: 'string', maxLength: 20 }, config: {} } } },
    } },
    async (input, ctx) => {
      if (input.sources) {
        const room = new Set(portalsOf(await ctx.store.get(ctx.userId)).map((s) => `${s.source}|${JSON.stringify(s.config)}`));
        const stray = input.sources.find((s) => !room.has(`${s.source}|${JSON.stringify(s.config)}`));
        if (stray) throw new AppError('invalid_argument', `Only portals in the room can be featured (${clean(stray.title ?? stray.source, 60)} isn't one).`);
      }
      return profilesOf(ctx).set(ctx.userId, input);
    }, 'write'),
  'profiles.remove': params(NO_PARAMS, async (_p, ctx) => (await profilesOf(ctx).remove(ctx.userId)) ?? null, 'write'),

  // ---- social, always as the token's account
  'social.resolve': params<{ handle: string }>({ type: 'object', required: ['handle'], additionalProperties: false, properties: { handle } },
    async (p, ctx) => publicRef(await socialOf(ctx).resolve(ctx.userId, p.handle), ctx)),
  /** A clip or saved item the server looks up itself, as the share tool does; never content from the request. */
  'social.share': params<{ clipId?: string; savedUrl?: string; note?: string; audience?: string }>(
    { type: 'object', additionalProperties: false, properties: { clipId: id, savedUrl: { type: 'string', maxLength: 2000 }, note: { type: 'string', maxLength: 500 }, audience: { type: 'string', enum: AUDIENCES } } },
    async (p, ctx) => {
      const social = socialOf(ctx);
      if (p.clipId) {
        const clip = await clipsOf(ctx).get(ctx.userId, p.clipId);
        if (!clip) throw new AppError('not_found', `No clip with id "${clean(p.clipId, 40)}".`);
        return social.share(ctx.userId, { kind: 'clip', title: clip.title, url: clip.source.url, clip, note: p.note, audience: p.audience });
      }
      const url = httpUrl(p.savedUrl);
      const saved = url ? (await ctx.store.get(ctx.userId)).saved.find((s) => s.url === url) : undefined;
      if (!saved) throw new AppError('invalid_argument', 'Share a saved item (savedUrl) or a clip (clipId).');
      return social.share(ctx.userId, { kind: 'link', title: saved.title, url: saved.url, note: p.note, audience: p.audience });
    }, 'write'),
  'social.unshare': params<{ id: string }>({ type: 'object', required: ['id'], additionalProperties: false, properties: { id } },
    (p, ctx) => socialOf(ctx).unshare(ctx.userId, p.id), 'write'),
  'social.get': params<{ id: string }>({ type: 'object', required: ['id'], additionalProperties: false, properties: { id } },
    async (p, ctx) => (await socialOf(ctx).get(ctx.userId, p.id)) ?? null),
  'social.feed': params<{ query?: { limit?: number; before?: string } }>({ type: 'object', additionalProperties: false, properties: { query: pageQuery } },
    (p, ctx) => socialOf(ctx).feed(ctx.userId, p.query)),
  'social.sharesOf': params<{ accountId: string; query?: { limit?: number; before?: string } }>(
    { type: 'object', required: ['accountId'], additionalProperties: false, properties: { accountId: id, query: pageQuery } },
    async (p, ctx) => socialOf(ctx).sharesOf(ctx.userId, await accountOf(p.accountId, ctx), p.query)),
  'social.follow': params<{ handle: string }>({ type: 'object', required: ['handle'], additionalProperties: false, properties: { handle } },
    async (p, ctx) => publicRef(await socialOf(ctx).follow(ctx.userId, p.handle), ctx), 'write'),
  'social.unfollow': params<{ handle: string }>({ type: 'object', required: ['handle'], additionalProperties: false, properties: { handle } },
    (p, ctx) => socialOf(ctx).unfollow(ctx.userId, p.handle), 'write'),
  'social.mute': params<{ handle: string; on: boolean }>({ type: 'object', required: ['handle', 'on'], additionalProperties: false, properties: { handle, on: { type: 'boolean' } } },
    async (p, ctx) => publicRef(await socialOf(ctx).mute(ctx.userId, p.handle, p.on), ctx), 'write'),
  'social.block': params<{ handle: string; on: boolean }>({ type: 'object', required: ['handle', 'on'], additionalProperties: false, properties: { handle, on: { type: 'boolean' } } },
    async (p, ctx) => publicRef(await socialOf(ctx).block(ctx.userId, p.handle, p.on), ctx), 'write'),
  'social.uses': params(NO_PARAMS, (_p, ctx) => socialOf(ctx).uses(ctx.userId)),
  'social.connections': params(NO_PARAMS, (_p, ctx) => socialOf(ctx).connections(ctx.userId)),
  'social.stats': params<{ accountId: string }>({ type: 'object', required: ['accountId'], additionalProperties: false, properties: { accountId: id } },
    async (p, ctx) => socialOf(ctx).stats(ctx.userId, await accountOf(p.accountId, ctx))),
  'social.report': params<{ target: { shareId?: string; handle?: string }; reason: string }>(
    { type: 'object', required: ['target', 'reason'], additionalProperties: false, properties: {
      target: { type: 'object', additionalProperties: false, properties: { shareId: id, handle } }, reason: { type: 'string', maxLength: 500 },
    } },
    (p, ctx) => socialOf(ctx).report(ctx.userId, p.target, p.reason), 'write'),
};
