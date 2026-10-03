/** Read-only external monitor: storage health and authenticated MCP discovery. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

type Stage = 'configuration' | 'health' | 'initialize' | 'tools/list';
type Json = Record<string, unknown>;
export interface ProbeResult {
  ok: boolean;
  stage: Stage;
  code?: string;
  httpStatus?: number;
  version?: string;
  storage?: string;
  toolCount?: number;
}

function object(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Never include endpoint credentials, response bodies or thrown error text in reports. */
export async function checkService(env: NodeJS.ProcessEnv, fetcher: typeof fetch = fetch): Promise<ProbeResult> {
  let stage: Stage = 'configuration';
  let base: URL;
  try {
    base = new URL(env.MCPORTAL_URL ?? '');
  } catch {
    return { ok: false, stage, code: 'invalid_url' };
  }
  const loopback = ['127.0.0.1', '[::1]', 'localhost'].includes(base.hostname);
  if ((base.protocol !== 'https:' && !(base.protocol === 'http:' && loopback)) ||
      base.username || base.password || base.search || base.hash || !['/', '/mcp', '/mcp/'].includes(base.pathname)) {
    return { ok: false, stage, code: 'invalid_url' };
  }
  const token = env.MCPORTAL_TOKEN?.trim();
  if (!token || /[\r\n]/.test(token)) return { ok: false, stage, code: 'missing_or_invalid_token' };
  const timeout = Number(env.MCPORTAL_OPS_TIMEOUT_MS ?? 10000);
  if (!Number.isInteger(timeout) || timeout < 100 || timeout > 60000) return { ok: false, stage, code: 'invalid_timeout' };
  let httpStatus: number | undefined;
  const request = async (path: string, message?: Json): Promise<unknown> => {
    const headers: Record<string, string> = { accept: 'application/json' };
    // The public health endpoint never needs the monitor's bearer token.
    if (message) {
      headers.authorization = `Bearer ${token}`;
      headers['content-type'] = 'application/json';
      headers['mcp-protocol-version'] = '2025-11-25';
    }
    const response = await fetcher(new URL(path, base), {
      method: message ? 'POST' : 'GET', headers, redirect: 'error',
      signal: AbortSignal.timeout(timeout), ...(message ? { body: JSON.stringify(message) } : {}),
    });
    httpStatus = response.status;
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error('http_error');
    }
    if (!response.body) throw new Error('invalid_response');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let bytes = 0;
    try {
      while (true) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > 524288) throw new Error('response_too_large');
        chunks.push(chunk.value);
      }
    } finally {
      await reader.cancel();
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  };
  try {
    stage = 'health';
    const health = await request('/health');
    if (!object(health) || health.ok !== true || !object(health.checks) || health.checks.storage !== 'ok') {
      return { ok: false, stage, code: 'storage_unhealthy' };
    }
    stage = 'initialize';
    httpStatus = undefined;
    const init = await request('/mcp', {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'mcportal-ops-check', version: '1' } },
    });
    if (!object(init) || init.jsonrpc !== '2.0' || init.id !== 1 || 'error' in init || !object(init.result) || !object(init.result.serverInfo)) {
      return { ok: false, stage, code: 'invalid_rpc_response' };
    }
    stage = 'tools/list';
    httpStatus = undefined;
    const listing = await request('/mcp', { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    if (!object(listing) || listing.jsonrpc !== '2.0' || listing.id !== 2 || 'error' in listing || !object(listing.result) || !Array.isArray(listing.result.tools) ||
        !listing.result.tools.some((tool: unknown) => object(tool) && tool.name === 'open_room')) {
      return { ok: false, stage, code: 'invalid_rpc_response' };
    }
    return {
      ok: true, stage,
      ...(typeof init.result.serverInfo.version === 'string' ? { version: init.result.serverInfo.version.slice(0, 64) } : {}),
      ...(health.storage === 'postgres' || health.storage === 'files' ? { storage: health.storage } : {}),
      toolCount: listing.result.tools.length,
    };
  } catch {
    return { ok: false, stage, code: httpStatus && httpStatus >= 400 ? 'http_error' : 'request_or_response_failed', ...(httpStatus ? { httpStatus } : {}) };
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = await checkService(process.env);
  console.log(JSON.stringify(result));
  process.exitCode = result.ok ? 0 : 1;
}
