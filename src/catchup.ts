import { randomBytes } from 'node:crypto';
import { capturedStory, type CapturedStory, type CatchupSession } from './experiences.ts';
import { AppError } from './lib/errors.ts';
import { canonicalReadingUrl } from './reading.ts';
import { seenHash, tracksSeen } from './seen.ts';
import { need, type ToolContext } from './tools/kit.ts';
import { portalFor } from './tools/room.ts';

export interface CatchupInput { action: 'open' | 'start' | 'skip' | 'finish' | 'end'; sessionId?: string; index?: number; count?: number; portalIds?: string[] }
export const CATCHUP_SCHEMA = { type: 'object', required: ['action'], additionalProperties: false, properties: { action: { type: 'string', enum: ['open','start','skip','finish','end'] }, sessionId: { type: 'string', maxLength: 100 }, index: { type: 'integer', minimum: 0, maximum: 30 }, count: { type: 'integer', minimum: 1, maximum: 30 }, portalIds: { type: 'array', maxItems: 40, items: { type: 'string', maxLength: 80 } } } };
/** Freeze only currently retrieved unseen stories. No arrivals are admitted after the start. */
export async function catchup(input: CatchupInput, ctx: ToolContext): Promise<CatchupSession | null> {
  const store = need(ctx.experiences, 'Reading sessions are not available.');
  if (input.action === 'open') return (await store.get(ctx.userId)).state.catchup;
  const profile = await ctx.store.get(ctx.userId), all = profile.columns.flatMap(c => c.panels);
  if (input.action === 'start') {
    const current = (await store.get(ctx.userId)).state.catchup;
    if (current && !current.finishedAt) return current;
    if (input.count !== undefined && (!Number.isSafeInteger(input.count) || input.count < 1 || input.count > 30)) throw new AppError('invalid_argument', 'Choose 1–30 stories.');
    if (input.portalIds?.some(id => !all.some(p => p.id === id))) throw new AppError('not_found', 'Choose sources from your current room.');
    const specs = all.filter(p => p.source !== 'upcoming' && p.source !== 'changes' && tracksSeen(p.source) && (!input.portalIds || input.portalIds.includes(p.id)));
    const portals = await Promise.all(specs.map(p => portalFor(p, profile, ctx)));
    const seen = await ctx.seen?.get(ctx.userId, specs.map(p => p.id)) ?? new Map();
    const candidates = new Map<string, CapturedStory>();
    const failures: string[] = [];
    for (const portal of portals) {
      if (portal.error) { failures.push(`${portal.title}: ${portal.error}`.slice(0,500)); continue; }
      for (const item of portal.items) {
        if (seen.get(portal.portalId)?.has(seenHash(item.id))) continue;
        let key = `${portal.portalId}:${item.id}`;
        if (item.url) { try { key = canonicalReadingUrl(item.url); } catch { continue; } }
        const mark = { portalId: portal.portalId, itemId: item.id }, existing = candidates.get(key);
        if (existing) { if (existing.marks.length < 40) existing.marks.push(mark); continue; }
        const spec = specs.find(p => p.id === portal.portalId);
        try { candidates.set(key, capturedStory({ portalId: portal.portalId, source: portal.title, sourceKind: portal.source, item, marks: [mark], ...(spec?.source === 'docs' ? { docs: spec.config.url } : {}) })); } catch { if (failures.length < 40 && !failures.includes(`${portal.title}: some retrieved items were unreadable`)) failures.push(`${portal.title}: some retrieved items were unreadable`); }
      }
    }
    const stories = [...candidates.values()].sort((a,b) => (b.item.publishedAt || '').localeCompare(a.item.publishedAt || '') || a.item.id.localeCompare(b.item.id)).slice(0,input.count || 10);
    const startedAt = new Date().toISOString();
    const session: CatchupSession = { id: `session_${randomBytes(12).toString('hex')}`, startedAt, stories, failures, cursor: 0, outcomes: [], ...(!stories.length ? { finishedAt: startedAt, acknowledgedAt: startedAt } : {}) };
    return store.update(ctx.userId, state => {
      if (state.catchup && !state.catchup.finishedAt) return { result: state.catchup };
      return { state: { ...state, catchup: session }, result: session };
    });
  }
  if (!['skip','finish','end'].includes(input.action)) throw new AppError('invalid_argument', 'Unknown catch-up action.');
  const session = await store.update(ctx.userId, state => {
    const s = state.catchup;
    if (!s || s.id !== input.sessionId) throw new AppError('not_found', 'This reading session is unavailable.');
    if (!s.finishedAt) {
      if (s.cursor !== input.index) throw new AppError('conflict', 'This session advanced on another device. Reopen catch-up.');
      if (input.action === 'end') { while (s.cursor < s.stories.length) { s.outcomes.push('skipped'); s.cursor++; } }
      else { s.outcomes.push(input.action === 'skip' ? 'skipped' : 'finished'); s.cursor++; }
      if (s.cursor === s.stories.length) s.finishedAt = new Date().toISOString();
    }
    return { state, result: structuredClone(s) };
  });
  if (session.finishedAt && !session.acknowledgedAt) {
    const known = new Set(all.map(p => p.id)), marks = new Map<string,string[]>();
    for (const story of session.stories) for (const m of story.marks) if (known.has(m.portalId)) marks.set(m.portalId, [...(marks.get(m.portalId) || []), m.itemId]);
    await need(ctx.seen, 'Seen state is not available.').mark(ctx.userId, [...marks].map(([portalId,itemIds]) => ({ portalId,itemIds: [...new Set(itemIds)] })));
    return store.update(ctx.userId, state => { if (state.catchup?.id !== session.id) return { result: session }; state.catchup.acknowledgedAt = new Date().toISOString(); return { state, result: structuredClone(state.catchup) }; });
  }
  return session;
}
