import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateSupportPolicy, type SupportPolicy } from '../scripts/release-support.ts';
const policy: SupportPolicy = { minimumClientVersion: '0.12.0', announcedAt: '2026-09-01T00:00:00Z', effectiveAt: '2026-10-01T00:00:00Z', reason: 'Linked-state protocol changed', emergency: false };
const replacement = { isDraft: false, publishedAt: '2026-08-31T00:00:00Z', assets: ['mcportal-local-v0.12.0.tar.gz', 'mcportal-hosted-v0.12.0.tar.gz', 'SHA256SUMS'].map((name) => ({ name })) };
const now = Date.parse('2026-10-07T00:00:00Z');
test('minimum bump requires released replacement packages and an elapsed notice window', () => {
  validateSupportPolicy(policy, '0.12.0', '0.10.0', replacement, now);
  assert.throws(() => validateSupportPolicy(policy, '0.12.0', '0.10.0', undefined, now), /replacement/);
  assert.throws(() => validateSupportPolicy(policy, '0.12.0', '0.10.0', { ...replacement, isDraft: true }, now), /replacement/);
  assert.throws(() => validateSupportPolicy(policy, '0.12.0', '0.10.0', { ...replacement, assets: [] }, now), /missing/);
  assert.throws(() => validateSupportPolicy({ ...policy, effectiveAt: '2026-12-01' }, '0.12.0', '0.10.0', replacement, now), /elapsed/);
  assert.throws(() => validateSupportPolicy({ ...policy, announcedAt: '2026-09-15' }, '0.12.0', '0.10.0', replacement, now), /30-day/);
  assert.throws(() => validateSupportPolicy(policy, '0.12.0', '0.10.0', { ...replacement, publishedAt: '2026-09-02' }, now), /before announcing/);
});
test('emergency exception still requires reason, replacement and valid dates; unchanged minimum needs no network', () => {
  validateSupportPolicy({ ...policy, emergency: true, announcedAt: '2026-09-30' }, '0.12.0', '0.10.0', replacement, now);
  assert.throws(() => validateSupportPolicy({ ...policy, emergency: true, reason: '' }, '0.12.0', '0.10.0', replacement, now), /reason/);
  assert.throws(() => validateSupportPolicy({ ...policy, emergency: true, effectiveAt: 'invalid' }, '0.12.0', '0.10.0', replacement, now), /dates/);
  validateSupportPolicy({ ...policy, minimumClientVersion: '0.10.0', announcedAt: null, effectiveAt: null, reason: null }, '0.10.0', '0.10.0');
  assert.throws(() => validateSupportPolicy(policy, '0.10.0', '0.10.0'), /match/);
});
