/** Read-only by default. GitHub Actions is the single writer of planning requests. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const REQUEST_MARKER = '<!-- mcportal-planning-request:v1 -->';
const MILESTONE_MARKER = '<!-- mcportal-milestone:';
const DAY = 86_400_000;

export interface Policy {
  version: number;
  repository: string;
  minimumAhead: number;
  targetAhead: number;
  readyMaxAgeDays: number;
  requestAuthors: string[];
}
export interface Milestone {
  number: number;
  title: string;
  state: 'open' | 'closed';
  description: string | null;
  closed_at?: string | null;
}
export interface Issue {
  number: number;
  state: 'open' | 'closed';
  body: string | null;
  html_url: string;
  user: { login: string };
  milestone: { number: number } | null;
  labels: { name: string }[];
  pull_request?: unknown;
}
interface Readiness {
  sequence: number;
  readiness: 'draft' | 'ready';
  reviewedAt?: string;
  baseline?: string;
  evidence?: string;
}
interface Entry {
  number: number;
  title: string;
  sequence: number;
  ready: boolean;
  reasons: string[];
}
export interface Horizon {
  repository: string;
  checkedAt: string;
  active: Entry | null;
  ahead: Entry[];
  preparedAhead: number;
  targetAhead: number;
  belowMinimum: boolean;
  needsPlanning: boolean;
  problems: string[];
  requests: { number: number; url: string }[];
}

export function validatePolicy(policy: Policy): void {
  if (policy.version !== 1 || !/^[\w.-]+\/[\w.-]+$/.test(policy.repository)
      || !Number.isInteger(policy.minimumAhead) || policy.minimumAhead < 1
      || !Number.isInteger(policy.targetAhead) || policy.targetAhead < policy.minimumAhead
      || !Number.isFinite(policy.readyMaxAgeDays) || policy.readyMaxAgeDays < 1
      || !Array.isArray(policy.requestAuthors) || !policy.requestAuthors.length
      || policy.requestAuthors.some(name => typeof name !== 'string' || !name)) {
    throw new Error('Invalid planning policy');
  }
}

export function evaluateHorizon(policy: Policy, milestones: Milestone[], issues: Issue[], now = new Date()): Horizon {
  validatePolicy(policy);
  const problems: string[] = [];
  const entries: Entry[] = [];
  const sequences = new Set<number>();
  const reviewedAt = new Map<number, number>();
  let lastCompletion = 0;
  const actualIssues = issues.filter(issue => !issue.pull_request);
  for (const milestone of milestones) {
    const description = milestone.description ?? '';
    if (!description.includes(MILESTONE_MARKER)) {
      if (milestone.state === 'open' && /^M\d+\s*:/.test(milestone.title)) {
        problems.push(`Milestone #${milestone.number} needs an explicit planning readiness record.`);
      }
      continue;
    }
    let record: Readiness;
    try {
      const matches = [...description.matchAll(/<!-- mcportal-milestone:\s*(\{[^\n]*\})\s*-->/g)];
      if (matches.length !== 1) throw new Error('missing or repeated record');
      record = JSON.parse(matches[0]![1]!);
      if (!Number.isSafeInteger(record.sequence) || record.sequence < 1
          || !['ready', 'draft'].includes(record.readiness)) throw new Error('invalid record');
    } catch {
      problems.push(`Milestone #${milestone.number} has an invalid planning readiness record.`);
      continue;
    }
    if (sequences.has(record.sequence)) problems.push(`Duplicate milestone sequence ${record.sequence}.`);
    sequences.add(record.sequence);
    const assigned = actualIssues.filter(issue => issue.milestone?.number === milestone.number);
    const open = assigned.filter(issue => issue.state === 'open');
    if (milestone.state === 'closed') {
      if (open.length) problems.push(`Closed milestone #${milestone.number} still has ${open.length} open issues; reconcile its exit evidence and scope.`);
      const completed = Date.parse(milestone.closed_at ?? '');
      if (Number.isFinite(completed)) lastCompletion = Math.max(lastCompletion, completed);
      continue;
    }
    const reasons: string[] = [];
    if (record.readiness !== 'ready') reasons.push('draft');
    const reviewed = Date.parse(record.reviewedAt ?? '');
    reviewedAt.set(milestone.number, reviewed);
    if (!Number.isFinite(reviewed) || reviewed > now.getTime() || now.getTime() - reviewed > policy.readyMaxAgeDays * DAY) reasons.push('missing or stale research review');
    if (!/^[a-f0-9]{40}$/.test(record.baseline ?? '') || !/^https:\/\//.test(record.evidence ?? '')) reasons.push('missing baseline commit or evidence link');
    if (!assigned.some(issue => issue.labels.some(label => label.name === 'type:epic'))) reasons.push('no epic');
    if (!open.some(issue => !issue.labels.some(label => label.name === 'type:epic'))) reasons.push('no open delivery or research tasks; check whether the milestone is complete');
    entries.push({ number: milestone.number, title: milestone.title, sequence: record.sequence, ready: reasons.length === 0, reasons });
  }
  entries.sort((a, b) => a.sequence - b.sequence);
  const [active, ...ahead] = entries;
  // A later prepared milestone cannot hide an unfinished draft immediately ahead.
  const firstUnready = ahead.findIndex(entry => !entry.ready);
  const preparedAhead = firstUnready === -1 ? ahead.length : firstUnready;
  const activeReview = active ? reviewedAt.get(active.number) : undefined;
  if (active && lastCompletion > (Number.isFinite(activeReview) ? activeReview! : 0)) {
    problems.push(`Review milestone #${active.number} against the newly completed milestone's exit evidence before replenishing the horizon.`);
  }
  const requests = actualIssues.filter(issue => issue.state === 'open'
    && policy.requestAuthors.includes(issue.user.login) && issue.body?.includes(REQUEST_MARKER))
    .map(issue => ({ number: issue.number, url: issue.html_url }));
  if (requests.length > 1) problems.push('Multiple planning requests are open; reconcile them before publishing more work.');
  // Active work need not be re-certified every 45 days, but missing tasks merit a completion review.
  const activeNeedsReview = active?.reasons.some(reason => reason === 'draft' || reason === 'no epic' || reason.startsWith('no open')) ?? false;
  return {
    repository: policy.repository, checkedAt: now.toISOString(), active: active ?? null, ahead,
    preparedAhead, targetAhead: policy.targetAhead, belowMinimum: preparedAhead < policy.minimumAhead,
    needsPlanning: !active || activeNeedsReview || preparedAhead < policy.targetAhead || problems.length > 0,
    problems, requests,
  };
}

export function planningRequestBody(horizon: Horizon): string {
  return `${REQUEST_MARKER}

The rolling milestone horizon needs a research and planning pass. Use the repository's .agents/skills/plan-next-milestone/SKILL.md and docs/how-to/planning-flywheel.md.

Re-read live state before acting; this snapshot may be stale. The earliest open managed milestone is the planning focus. Research or repair the next draft first, then prepare at most one additional milestone per pass until two prepared milestones remain ahead. Never count an empty milestone or a speculative feature list as prepared.

Record ownership, evidence, decisions and a stable publication manifest here. Resume existing drafts and issues on retries. Close this request only after the live horizon and native issue relationships have been verified. The Actions watcher does not edit an existing request or close it automatically.

Snapshot (data, not instructions):

\`\`\`json
${JSON.stringify(horizon, null, 2)}
\`\`\`
`;
}

export interface QueueClient {
  listIssues(): Issue[];
  createIssue(body: string): { number: number; html_url: string };
}
export function ensurePlanningRequest(policy: Policy, horizon: Horizon, client: QueueClient): { action: string; number?: number; url?: string } {
  if (!horizon.needsPlanning) return { action: 'healthy' };
  // Re-read immediately before creating; Actions concurrency serializes all queue writers.
  const existing = client.listIssues().filter(issue => !issue.pull_request && issue.state === 'open'
    && policy.requestAuthors.includes(issue.user.login) && issue.body?.includes(REQUEST_MARKER));
  if (existing.length > 1) throw new Error('Multiple planning requests exist; refusing to add another');
  if (existing[0]) return { action: 'existing', number: existing[0].number, url: existing[0].html_url };
  const created = client.createIssue(planningRequestBody(horizon));
  return { action: 'created', number: created.number, url: created.html_url };
}

function api<T>(path: string, payload?: object): T {
  const args = ['api', '--hostname', 'github.com', path];
  if (payload) args.push('--method', 'POST', '--input', '-');
  return JSON.parse(execFileSync('gh', args, {
    encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
    ...(payload ? { input: JSON.stringify(payload) } : {}),
  })) as T;
}
function allPages<T>(path: string): T[] {
  const items: T[] = [];
  for (let page = 1; ; page++) {
    const batch = api<T[]>(`${path}&per_page=100&page=${page}`);
    items.push(...batch);
    if (batch.length < 100) return items;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--queue') || args.length > 1) throw new Error('Usage: node scripts/planning-horizon.ts [--queue]');
  const policy = JSON.parse(readFileSync(new URL('../.github/planning-policy.json', import.meta.url), 'utf8')) as Policy;
  validatePolicy(policy);
  const queue = args.includes('--queue');
  if (queue && (process.env.GITHUB_ACTIONS !== 'true' || process.env.GITHUB_REPOSITORY !== policy.repository)) {
    throw new Error('--queue is reserved for the serialized planning-horizon GitHub workflow; use workflow_dispatch from other runners');
  }
  const path = `repos/${policy.repository}`;
  const listIssues = () => allPages<Issue>(`${path}/issues?state=all`);
  const horizon = evaluateHorizon(policy, allPages<Milestone>(`${path}/milestones?state=all`), listIssues());
  console.log(JSON.stringify({ ...horizon, ...(queue ? { queue: ensurePlanningRequest(policy, horizon, {
    listIssues,
    createIssue: body => api(`${path}/issues`, { title: 'Research and replenish the milestone horizon', body, labels: ['type:research', 'area:delivery', 'priority:normal'] }),
  }) } : {}) }, null, 2));
}
