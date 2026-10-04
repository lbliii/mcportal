/**
 * Thumbnails for the room, fetched through the guarded fetcher and returned as data:
 * URIs, so the UI never contacts third parties and needs no CSP exceptions.
 */
import { errorCode } from './lib/errors.ts';
import type { SourceDeps } from './sources.ts';
import { MAX_THUMB_BYTES } from './types.ts';

const IMAGE_TYPES: Record<string, (b: Buffer) => boolean> = {
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => b.subarray(0, 4).toString('latin1') === 'GIF8',
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

/** A failure worth retrying soon (timeout, network, 5xx): not cached like a missing or unusable image. */
class TransientImageError extends Error {}

/**
 * Fetch one image through the guarded fetcher and return it as a data: URI, so the
 * UI never contacts third parties and needs no CSP exceptions. Only JPEG, PNG, GIF
 * and WebP whose bytes match their type; no SVG. Cached for a day, as are permanent
 * failures; a timeout or server error isn't cached, so the next load tries again.
 */
export async function thumbnail(url: string, deps: SourceDeps): Promise<string | null> {
  try {
    const result = await deps.cache.get(`img:${url}`, 86_400, async () => {
      // Feeds often link full-size originals. Many image CDNs resize on request, so an
      // oversized picture is retried at thumbnail width; the byte cap still applies.
      for (const attempt of resizeAttempts(url)) {
        const got = await fetchImage(attempt, deps);
        if (got === 'retry') throw new TransientImageError();
        if (got !== 'too-big') return got;
      }
      return null;
    });
    return result.value;
  } catch (error) {
    if (error instanceof TransientImageError) return null;
    throw error;
  }
}

/** Hosts known to resize with ?w= (Valnet's *images.com CDNs, WordPress Photon, imgix). */
const RESIZING_HOSTS = /(^|\.)([a-z]+images\.com|i\d\.wp\.com|imgix\.net)$/;

/**
 * URLs to try in order. Other hosts get the original, then ?w=480. A WordPress upload
 * that is still too big (Colossal posts multi-MB originals and ignores ?w=) then goes
 * through WordPress's public resizer, Photon, which serves any public image by path.
 */
function resizeAttempts(url: string): string[] {
  const small = resized(url);
  if (RESIZING_HOSTS.test(new URL(url).hostname)) return [small, url];
  const photon = wordpressPhoton(url);
  return photon ? [url, small, photon] : [url, small];
}

function resized(url: string): string {
  const u = new URL(url);
  u.searchParams.set('w', '480');
  return u.href;
}

function wordpressPhoton(url: string): string | undefined {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.port || u.search || !u.pathname.startsWith('/wp-content/uploads/')) return undefined;
  return `https://i0.wp.com/${u.hostname}${u.pathname}?w=480`;
}

// Accept lists only formats we keep: some CDNs serve AVIF whenever it's mentioned, even at q=0.
async function fetchImage(url: string, deps: SourceDeps): Promise<string | null | 'too-big' | 'retry'> {
  try {
    const res = await deps.fetcher(url, { binary: true, maxBytes: MAX_THUMB_BYTES, timeoutMs: 6000, headers: { accept: 'image/webp,image/jpeg,image/png,image/gif' } });
    if (res.status >= 500 || res.status === 429) return 'retry';
    if (res.status < 200 || res.status >= 300) return null;
    if (res.truncated) return 'too-big';
    const bytes = Buffer.from(res.text, 'base64');
    if (bytes.length > MAX_THUMB_BYTES) return 'too-big';
    const type = Object.keys(IMAGE_TYPES).find((t) => IMAGE_TYPES[t]!(bytes));
    return type ? `data:${type};base64,${res.text}` : null;
  } catch (error) {
    if (errorCode(error) === 'fetch_too_large') return 'too-big';
    if (errorCode(error) === 'fetch_blocked') return null;   // blocked address or redirect: no picture
    return 'retry';   // timed out, or couldn't connect
  }
}
