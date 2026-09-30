import { createHash, randomBytes } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import type { Server } from 'node:http';
import { request } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp, type AppConfig, type AppDeps } from '../src/http.ts';
import { TtlCache } from '../src/lib/cache.ts';
import { createFixtureFetcher } from '../src/lib/fixture-fetch.ts';
import { MemoryProfileStore } from '../src/store.ts';
import type { Fetcher } from '../src/types.ts';

export interface Running {
  base: string;
  port: number;
  server: Server;
  close: () => Promise<void>;
}

export async function startApp(overrides: Partial<AppConfig> = {}, fetcher: Fetcher = createFixtureFetcher(), deps: Partial<AppDeps> = {}): Promise<Running> {
  const dataDir = overrides.dataDir ?? (await mkdtemp(path.join(tmpdir(), 'mcportal-http-')));
  const config: AppConfig = {
    host: '127.0.0.1',
    port: 0,
    publicUrl: 'http://localhost',
    staticUser: 'default',
    allowedGithubUsers: [],
    allowedHosts: ['localhost', '127.0.0.1', '::1'],
    allowedOrigins: [],
    allowUnauthenticated: false,
    trustProxy: false,
    ...overrides,
    dataDir,
  };
  const server = createApp(config, { store: new MemoryProfileStore(), fetcher, cache: new TtlCache(), log: () => {}, ...deps });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return { base: `http://127.0.0.1:${port}`, port, server, close: () => new Promise((r) => server.close(() => r())) };
}

/** Raw HTTP request so tests can set any Host/Origin header. */
export function raw(
  port: number,
  options: { method?: string; path?: string; headers?: Record<string, string>; body?: string },
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      { host: '127.0.0.1', port, method: options.method ?? 'GET', path: options.path ?? '/', headers: { host: `localhost:${port}`, ...options.headers } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      },
    );
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

export function pkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

export const RPC_PING = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' });
