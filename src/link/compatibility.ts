/** Public compatibility negotiation, before OAuth allocates a callback or grant. */
import { MIN_CLIENT_VERSION, versionAtLeast } from '../api/calls.ts';
import { SERVER_INFO } from '../mcp.ts';
export const COMPATIBILITY_PATH = '/.well-known/mcportal';
export function compatibilityMetadata(publicUrl: string) {
  return { version: 1, minClientVersion: MIN_CLIENT_VERSION, recommendedVersion: SERVER_INFO.version,
    upgradeUrl: `${publicUrl}/install.md`, capabilities: ['linked-state-v1'] };
}
export type Compatibility = { status: 'current' | 'update_available' | 'update_required'; minClientVersion: string; recommendedVersion: string }
  | { status: 'unavailable' };
export async function checkCompatibility(server: string, clientVersion: string, fetcher: typeof fetch = fetch): Promise<Compatibility> {
  try {
    const response = await fetcher(new URL(COMPATIBILITY_PATH, server), { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) return { status: 'unavailable' };
    const body = await response.json();
    const version = /^\d+\.\d+\.\d+$/;
    if (body?.version !== 1 || typeof body.minClientVersion !== 'string' || typeof body.recommendedVersion !== 'string' || !version.test(body.minClientVersion) || !version.test(body.recommendedVersion)) return { status: 'unavailable' };
    return { status: !versionAtLeast(clientVersion, body.minClientVersion) ? 'update_required'
      : !versionAtLeast(clientVersion, body.recommendedVersion) ? 'update_available' : 'current',
      minClientVersion: body.minClientVersion, recommendedVersion: body.recommendedVersion };
  } catch { return { status: 'unavailable' }; }
}
