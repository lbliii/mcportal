/**
 * Decide whether an IP address is safe to connect to on a user's behalf.
 *
 * IPv4: everything except private, loopback, link-local, CGNAT, documentation,
 * multicast and reserved ranges.
 * IPv6: allowlist global unicast (2000::/3) only, minus Teredo, documentation
 * and 6to4. That rules out ::1, ::ffff:x (mapped), ::x (compatible),
 * 64:ff9b::/96 (NAT64), fc00::/7, fe80::/10, fec0::/10 and multicast in one go,
 * however the address is written.
 */
import { isIP } from 'node:net';

const V4_BLOCKED: Array<[number, number]> = (
  [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
  ] as Array<[string, number]>
).map(([base, bits]) => [v4ToInt(base), bits]);

function v4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

function isPublicV4(ip: string): boolean {
  const n = v4ToInt(ip);
  return !V4_BLOCKED.some(([base, bits]) => {
    const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
    return ((n & mask) >>> 0) === ((base & mask) >>> 0);
  });
}

/** Parse any valid IPv6 text form into 8 16-bit groups. */
export function parseV6(input: string): number[] | undefined {
  let ip = input.toLowerCase().replace(/^\[|\]$/g, '');
  const zone = ip.indexOf('%');
  if (zone !== -1) ip = ip.slice(0, zone);
  // Rewrite a trailing dotted IPv4 (e.g. ::ffff:127.0.0.1) as two hex groups.
  const lastColon = ip.lastIndexOf(':');
  const tail = ip.slice(lastColon + 1);
  if (tail.includes('.')) {
    if (isIP(tail) !== 4) return undefined;
    const n = v4ToInt(tail);
    ip = `${ip.slice(0, lastColon + 1)}${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const halves = ip.split('::');
  if (halves.length > 2) return undefined;
  const parse = (s: string) => (s === '' ? [] : s.split(':'));
  const head = parse(halves[0]!);
  const rest = halves.length === 2 ? parse(halves[1]!) : [];
  let parts: string[];
  if (halves.length === 2) {
    const fill = 8 - head.length - rest.length;
    if (fill < 1) return undefined;
    parts = [...head, ...new Array<string>(fill).fill('0'), ...rest];
  } else {
    parts = head;
  }
  if (parts.length !== 8 || parts.some((p) => !/^[0-9a-f]{1,4}$/.test(p))) return undefined;
  return parts.map((p) => parseInt(p, 16));
}

function isPublicV6(ip: string): boolean {
  const g = parseV6(ip);
  if (!g) return false;
  if ((g[0]! & 0xe000) !== 0x2000) return false; // not 2000::/3 global unicast
  if (g[0] === 0x2001 && g[1] === 0x0000) return false; // Teredo 2001::/32
  if (g[0] === 0x2001 && g[1] === 0x0db8) return false; // documentation
  if (g[0] === 0x2002) return false; // 6to4 embeds arbitrary IPv4
  return true;
}

export function isPublicAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) return isPublicV4(ip);
  if (family === 6) return isPublicV6(ip);
  return false;
}

export function isLoopbackHost(host: string): boolean {
  const h = host.replace(/^\[|\]$/g, '').toLowerCase();
  return h === 'localhost' || h === '127.0.0.1' || h === '::1';
}
