/** Hosted credentials must travel over HTTPS; loopback HTTP supports local development. */
import { AppError } from '../lib/errors.ts';
import { isLoopbackHost } from '../lib/ip.ts';

export function hostedOrigin(value: string): string {
  let url: URL;
  try { url = new URL(value); } catch {
    throw new AppError('invalid_argument', 'Use a valid HTTPS address for the hosted MCPortal.');
  }
  if (url.username || url.password || (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLoopbackHost(url.hostname)))) {
    throw new AppError('invalid_argument', 'The hosted MCPortal requires HTTPS (HTTP is allowed only on loopback for local development).');
  }
  return url.origin;
}
