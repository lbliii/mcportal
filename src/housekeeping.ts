/**
 * Retention on a schedule. What MCPortal keeps only for a while (expired handoffs and
 * highlights, resolved reports, old audit entries, lapsed invites, unused app
 * registrations) is removed by these tasks, not only when the same user happens to
 * write again, so the privacy policy's "how long" holds on a quiet server too.
 */
import type { Accounts } from './accounts.ts';
import type { OAuthServer } from './auth/oauth.ts';
import type { ExperienceStore } from './experiences.ts';
import type { EditionStore } from './editions.ts';
import type { HandoffStore } from './handoffs.ts';
import { errorMessage } from './lib/errors.ts';
import type { Logger } from './lib/log.ts';
import type { Social } from './social.ts';

export interface HousekeepingTask {
  name: string;
  /** Removes what's past its time; returns how many records went, when it knows. */
  run(): Promise<number | void>;
}

/** The retention tasks for the stores a server has (a local one has no accounts, sign-ins or reports). */
export function retentionTasks(s: {
  experiences?: ExperienceStore | undefined;
  handoffs?: HandoffStore | undefined;
  editions?: EditionStore | undefined;
  social?: Pick<Social, 'purgeReports'> | undefined;
  accounts?: Pick<Accounts, 'prune'> | undefined;
  oauth?: Pick<OAuthServer, 'pruneStored'> | undefined;
}): HousekeepingTask[] {
  const tasks: Array<HousekeepingTask | false | undefined> = [
    s.experiences && { name: 'watches', run: () => s.experiences!.purgeExpired() },
    s.handoffs?.purgeExpired && { name: 'handoffs', run: () => s.handoffs!.purgeExpired!() },
    s.editions?.purgeExpired && { name: 'editions', run: () => s.editions!.purgeExpired!() },
    s.social && { name: 'reports', run: () => s.social!.purgeReports() },
    s.accounts && { name: 'accounts', run: () => s.accounts!.prune() },
    s.oauth && { name: 'signins', run: () => s.oauth!.pruneStored() },
  ];
  return tasks.filter((t): t is HousekeepingTask => Boolean(t));
}

export const HOUSEKEEPING = { firstAfterMs: 60_000, everyMs: 6 * 3_600_000 } as const;

/** Run every task once. One failing doesn't stop the others; each is logged with its count. */
export async function housekeep(tasks: HousekeepingTask[], log: Logger): Promise<Record<string, number>> {
  const removed: Record<string, number> = {};
  for (const task of tasks) {
    try {
      removed[task.name] = (await task.run()) ?? 0;
    } catch (error) {
      log.warn('housekeeping.failed', { task: task.name, error: errorMessage(error) });
    }
  }
  log.info('housekeeping.done', removed);
  return removed;
}

/** A minute after startup, then every 6 hours. The timers don't keep the process alive. Returns a stop function. */
export function startHousekeeping(tasks: HousekeepingTask[], log: Logger, timing: { firstAfterMs: number; everyMs: number } = HOUSEKEEPING): () => void {
  let every: ReturnType<typeof setInterval> | undefined;
  const first = setTimeout(() => {
    void housekeep(tasks, log);
    every = setInterval(() => void housekeep(tasks, log), timing.everyMs);
    every.unref();
  }, timing.firstAfterMs);
  first.unref();
  return () => { clearTimeout(first); if (every) clearInterval(every); };
}
