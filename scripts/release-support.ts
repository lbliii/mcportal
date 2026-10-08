/** A minimum-version increase is a compatibility change, not a routine release bump. */
import { compareVersions, parseVersion } from './release.ts';
export interface SupportPolicy {
  minimumClientVersion: string;
  announcedAt: string | null;
  effectiveAt: string | null;
  reason: string | null;
  emergency: boolean;
}
export interface ReplacementRelease { isDraft: boolean; publishedAt: string; assets: Array<{ name: string }> }
export function validateSupportPolicy(policy: SupportPolicy, current: string, previous: string, replacement?: ReplacementRelease, now = Date.now()): void {
  if (typeof policy.emergency !== 'boolean') throw new Error('Emergency policy must be explicit');
  if (!parseVersion(current) || !parseVersion(previous) || policy.minimumClientVersion !== current) throw new Error('Support policy must match the runtime minimum client version');
  if (compareVersions(current, previous) <= 0) return;
  if (!policy.reason?.trim()) throw new Error('A minimum-version increase needs a documented reason');
  const announced = Date.parse(policy.announcedAt ?? ''), effective = Date.parse(policy.effectiveAt ?? '');
  if (!Number.isFinite(announced) || !Number.isFinite(effective) || announced > now || effective > now || effective < announced) throw new Error('Announcement and effective dates must be valid and elapsed before enforcing a new minimum');
  if (!policy.emergency && effective - announced < 30 * 86400000) throw new Error('Ordinary minimum-version increases require a 30-day deprecation window');
  if (!replacement || replacement.isDraft || !Number.isFinite(Date.parse(replacement.publishedAt)) || Date.parse(replacement.publishedAt) > announced) throw new Error('Publish the replacement release before announcing the new minimum');
  for (const name of [`mcportal-local-v${current}.tar.gz`, `mcportal-hosted-v${current}.tar.gz`, 'SHA256SUMS']) {
    if (!replacement.assets.some((asset) => asset.name === name)) throw new Error(`Replacement release is missing ${name}`);
  }
}
