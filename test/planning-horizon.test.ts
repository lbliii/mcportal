import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { test } from 'node:test';
import { evaluateHorizon, ensurePlanningRequest, REQUEST_MARKER, type Policy, type Issue, type Milestone } from '../scripts/planning-horizon.ts';

const NOW = new Date('2026-10-08T12:00:00Z');
const policy: Policy = { version: 1, repository: 'lbliii/mcportal', minimumAhead: 1, targetAhead: 2, readyMaxAgeDays: 45, requestAuthors: ['github-actions[bot]', 'lbliii'] };
function milestone(number: number, changes: Record<string, unknown> = {}): Milestone {
  return { number, title: `M${number}: Outcome`, state: 'open', description: `Outcome and exit evidence.\n<!-- mcportal-milestone: ${JSON.stringify({ sequence: number, readiness: 'ready', reviewedAt: '2026-10-08T10:00:00Z', baseline: 'a'.repeat(40), evidence: 'https://github.com/lbliii/mcportal/issues/1', ...changes })} -->` };
}
function issue(number: number, milestoneNumber: number | null, epic = false): Issue {
  return { number, state: 'open', body: 'Acceptance criteria and validation.', html_url: `https://github.com/lbliii/mcportal/issues/${number}`, user: { login: 'lbliii' }, milestone: milestoneNumber === null ? null : { number: milestoneNumber }, labels: epic ? [{ name: 'type:epic' }] : [{ name: 'type:task' }] };
}
function inventory(count = 4) {
  const milestones = Array.from({ length: count }, (_, index) => milestone(index + 1));
  const issues = milestones.flatMap(m => [issue(m.number * 10, m.number, true), issue(m.number * 10 + 1, m.number)]);
  return { milestones, issues };
}
function complete(data: ReturnType<typeof inventory>, number: number) {
  data.milestones.find(m => m.number === number)!.state = 'closed';
  for (const item of data.issues.filter(i => i.milestone?.number === number)) item.state = 'closed';
}

test('existing four-milestone plan is healthy; milestone closure advances focus and refills only a deficit', () => {
  const data = inventory();
  let result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.active?.number, 1);
  assert.equal(result.preparedAhead, 3);
  assert.equal(result.needsPlanning, false);
  complete(data, 1);
  result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.active?.number, 2);
  assert.equal(result.preparedAhead, 2);
  assert.equal(result.needsPlanning, false);
  complete(data, 2);
  result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.active?.number, 3);
  assert.equal(result.preparedAhead, 1);
  assert.equal(result.needsPlanning, true);
  assert.equal(result.belowMinimum, false);
  complete(data, 3);
  assert.equal(evaluateHorizon(policy, data.milestones, data.issues, NOW).belowMinimum, true);
});

test('completion requests a newly active milestone evidence review even with two already prepared', () => {
  const data = inventory();
  complete(data, 1);
  data.milestones[0]!.closed_at = '2026-10-08T11:00:00Z';
  let result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.preparedAhead, 2);
  assert.equal(result.needsPlanning, true);
  assert.match(result.problems[0]!, /Review milestone #2/);
  data.milestones[1] = milestone(2, { reviewedAt: NOW.toISOString() });
  result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.needsPlanning, false);
});

test('draft or stale next milestone cannot be hidden by later ready milestones', () => {
  const data = inventory();
  for (const changes of [{ readiness: 'draft' }, { reviewedAt: '2026-01-01T00:00:00Z' }, { reviewedAt: '2027-01-01T00:00:00Z' }, { evidence: null }, { baseline: 'main' }]) {
    data.milestones[1] = milestone(2, changes);
    const result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
    assert.equal(result.preparedAhead, 0);
    assert.equal(result.needsPlanning, true);
  }
});

test('PRs and empty milestones do not satisfy the delivery breakdown', () => {
  const data = inventory();
  data.issues = data.issues.filter(i => i.milestone?.number !== 2);
  data.issues.push({ ...issue(999, 2, true), pull_request: { url: 'example' } });
  data.issues.push({ ...issue(1000, 2), pull_request: { url: 'example' } });
  const result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.preparedAhead, 0);
  assert.equal(result.ahead[0]!.reasons.length, 2);
});

test('last completed task requests an exit review without closing or advancing the milestone', () => {
  const data = inventory();
  data.issues.filter(i => i.milestone?.number === 1).forEach(i => { i.state = 'closed'; });
  const result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.active?.number, 1);
  assert.equal(result.needsPlanning, true);
  assert.equal(data.milestones[0]!.state, 'open');
});

test('reopened milestone returns to the focus; unrelated unmarked milestones are ignored', () => {
  const data = inventory();
  complete(data, 1);
  data.milestones[0]!.state = 'open';
  data.milestones.push({ number: 99, title: 'Unrelated release', description: null, state: 'open' });
  const result = evaluateHorizon(policy, data.milestones.reverse(), data.issues, NOW);
  assert.equal(result.active?.number, 1);
  assert.equal(result.ahead.length, 3);
});

test('malformed, repeated, duplicate-sequence and unregistered roadmap records surface reconciliation', () => {
  for (const description of ['<!-- mcportal-milestone: {} -->', '<!-- mcportal-milestone: broken -->', `${milestone(2).description}\n${milestone(2).description}`, milestone(2, { sequence: 1 }).description, 'Not registered']) {
    const data = inventory();
    data.milestones[1]!.description = description;
    const result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
    assert.equal(result.needsPlanning, true);
    assert.ok(result.problems.length > 0);
  }
});

test('closed milestones with open issues cannot silently disappear from review', () => {
  const data = inventory();
  data.milestones[0]!.state = 'closed';
  const result = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  assert.equal(result.needsPlanning, true);
  assert.match(result.problems[0]!, /still has 2 open issues/);
});

test('no managed active milestone requires planning, and bad policy fails explicitly', () => {
  const result = evaluateHorizon(policy, [], [], NOW);
  assert.equal(result.active, null);
  assert.equal(result.needsPlanning, true);
  assert.throws(() => evaluateHorizon({ ...policy, targetAhead: 0 }, [], [], NOW), /Invalid planning policy/);
});

test('queue is a no-op while healthy; a deficit is created once and reused without edits', () => {
  const data = inventory();
  const healthy = evaluateHorizon(policy, data.milestones, data.issues, NOW);
  const deficit = evaluateHorizon(policy, [], [], NOW);
  const requests: Issue[] = [];
  let creates = 0;
  const client = {
    listIssues: () => requests,
    createIssue: (body: string) => {
      creates++;
      const created = { ...issue(200, null), body };
      requests.push(created);
      return created;
    },
  };
  assert.equal(ensurePlanningRequest(policy, healthy, client).action, 'healthy');
  assert.equal(creates, 0);
  assert.equal(ensurePlanningRequest(policy, deficit, client).action, 'created');
  const original = requests[0]!.body;
  assert.equal(ensurePlanningRequest(policy, deficit, client).action, 'existing');
  assert.equal(requests[0]!.body, original);
  assert.equal(creates, 1);
  requests[0]!.state = 'closed';
  assert.equal(ensurePlanningRequest(policy, deficit, client).action, 'created');
  assert.equal(creates, 2);
});

test('public marker spoofing does not capture the queue and duplicate legitimate requests halt creation', () => {
  const legitimate = { ...issue(200, null), body: REQUEST_MARKER };
  const spoof = { ...legitimate, number: 201, user: { login: 'untrusted-contributor' } };
  const result = evaluateHorizon(policy, [], [spoof, legitimate], NOW);
  assert.deepEqual(result.requests.map(r => r.number), [200]);
  assert.throws(() => ensurePlanningRequest(policy, result, { listIssues: () => [legitimate, { ...legitimate, number: 202 }], createIssue: () => { throw new Error('must not create'); } }), /Multiple planning requests/);
});

test('a failed queue read never falls through to issue creation', () => {
  assert.throws(() => ensurePlanningRequest(policy, evaluateHorizon(policy, [], [], NOW), {
    listIssues: () => { throw new Error('GitHub unavailable'); },
    createIssue: () => { throw new Error('must not create'); },
  }), /GitHub unavailable/);
});

test('queue mode refuses local or wrong-repository writers before network access', () => {
  for (const env of [{ GITHUB_ACTIONS: 'false', GITHUB_REPOSITORY: policy.repository }, { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: 'someone/fork' }]) {
    assert.throws(() => execFileSync(process.execPath, ['scripts/planning-horizon.ts', '--queue'], {
      env: { ...process.env, ...env }, encoding: 'utf8', stdio: 'pipe',
    }), /reserved for the serialized/);
  }
});
