/**
 * The server's one logger. Leveled and structured: every line is an event name
 * plus flat fields, written to stderr (stdout belongs to the stdio transport).
 *
 *   text (local)    [mcportal] info tool.call tool=open_room outcome=ok ms=41 req=3f9c…
 *   json (hosted)   {"t":"2026-10-01T…","level":"info","message":"tool.call","event":"tool.call",…}
 *
 * JSON is the production/Railway default; MCPORTAL_LOG_FORMAT overrides it. MCPORTAL_LOG_LEVEL sets the
 * floor (default info). Fields are for ids, names, counts and timings: never tokens,
 * profile contents or third-party text. User ids are logged only as userRef() hashes.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Actor } from '../access.ts';

const VERSION: string = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')).version;

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
export type LogFields = Record<string, string | number | boolean | null | undefined>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  /** A logger that adds these fields to every line (a request id, a tool name). */
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  format?: 'text' | 'json';
  write?: (line: string) => void;
  now?: () => Date;
}

const RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Text values that need quoting: spaces, quotes, `=`, or nothing at all. */
function textValue(value: string | number | boolean | null): string {
  const s = String(value);
  return s === '' || /[\s"=]/.test(s) ? JSON.stringify(s) : s;
}

export function createLogger(options: LoggerOptions = {}, base: LogFields = {}): Logger {
  const floor = RANK[options.level ?? 'info'];
  const format = options.format ?? 'text';
  const write = options.write ?? ((line: string) => process.stderr.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function emit(level: LogLevel, event: string, fields: LogFields = {}): void {
    if (RANK[level] < floor) return;
    const all = Object.entries({ ...base, ...fields }).filter((e): e is [string, string | number | boolean | null] =>
      e[1] !== undefined && !['t', 'level', 'event', 'message'].includes(e[0]));
    if (format === 'json') {
      write(JSON.stringify({ t: now().toISOString(), level, message: event, event, ...Object.fromEntries(all) }));
      return;
    }
    // Multi-line values (stacks) go last, on their own lines, so the head stays greppable.
    const inline = all.filter(([, v]) => typeof v !== 'string' || !v.includes('\n'));
    const block = all.filter(([, v]) => typeof v === 'string' && v.includes('\n'));
    const head = [`[mcportal] ${level} ${event}`, ...inline.map(([k, v]) => `${k}=${textValue(v)}`)].join(' ');
    write(block.length ? `${head}\n${block.map(([k, v]) => `  ${k}: ${String(v).replace(/\n/g, '\n  ')}`).join('\n')}` : head);
  }

  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
    child: (fields) => createLogger(options, { ...base, ...fields }),
  };
}

/** Discards everything (tests, scripts). */
export const silentLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child: () => silentLogger,
};

let processLog: Logger | undefined;

/** The process-wide logger from the environment, for code with no logger handed to it. */
export function processLogger(): Logger {
  return (processLog ??= loggerFromEnv());
}

export function loggerFromEnv(env: NodeJS.ProcessEnv = process.env, write?: (line: string) => void): Logger {
  const level = (LOG_LEVELS as readonly string[]).includes(env.MCPORTAL_LOG_LEVEL ?? '') ? (env.MCPORTAL_LOG_LEVEL as LogLevel) : 'info';
  const production = env.NODE_ENV === 'production' || Boolean(env.RAILWAY_ENVIRONMENT_ID || env.RAILWAY_DEPLOYMENT_ID);
  const format = env.MCPORTAL_LOG_FORMAT === 'text' ? 'text' : env.MCPORTAL_LOG_FORMAT === 'json' || production ? 'json' : 'text';
  return createLogger(write ? { level, format, write } : { level, format }, {
    service: 'mcportal', version: VERSION,
    environment: env.RAILWAY_ENVIRONMENT_NAME || env.NODE_ENV || 'development',
    deployment: env.RAILWAY_DEPLOYMENT_ID, commit: env.RAILWAY_GIT_COMMIT_SHA,
  });
}

export type Traffic = 'internal' | 'user' | 'local';

/** Classification is operator/account controlled, never taken from request metadata. */
export function actorLogFields(userId: string, actor?: Actor, env: NodeJS.ProcessEnv = process.env): { user: string; traffic: Traffic } {
  const internal = (env.MCPORTAL_INTERNAL_USERS ?? '').split(',').map((id) => id.trim()).filter(Boolean);
  const traffic = actor?.role === 'admin' || internal.includes(userId) ? 'internal' : actor ? 'user' : 'local';
  return { user: userRef(userId), traffic };
}

/** Keep successful calls useful, expected failures visible, and bugs at error severity. */
export function outcomeLevel(outcome: string, code?: string): LogLevel {
  return outcome === 'crashed' || code === 'internal' ? 'error' : outcome === 'ok' ? 'info' : 'warn';
}

const CLIENT_HOSTS: Record<string, string> = {
  claude: 'claude', 'claude-ai': 'claude', 'claude-desktop': 'claude', 'claude desktop': 'claude',
  'claude-code': 'claude_code', 'claude code': 'claude_code', chatgpt: 'chatgpt', 'openai-chatgpt': 'chatgpt',
  codex: 'codex', 'codex-mcp-client': 'codex', mcportal: 'mcportal',
};

/** No arbitrary client strings/build metadata (which can contain device ids or secrets). */
export function observedClientVersion(value: unknown): string {
  if (value === undefined) return 'missing';
  return typeof value === 'string' && value.length <= 64 && /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)(?:\.\d{1,4}){0,3})?$/.test(value) ? value : 'other';
}

export function clientLogFields(value: unknown): { host: string; clientVersion: string } {
  const client = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const name = typeof client.name === 'string' && client.name.length <= 64 ? client.name.toLowerCase() : '';
  const host = Object.hasOwn(CLIENT_HOSTS, name) ? CLIENT_HOSTS[name]! : 'unknown';
  return { host, clientVersion: host === 'unknown' ? 'unknown' : observedClientVersion(client.version) };
}

/** Request-scoped only: the HTTP MCP transport has no persistent client session. */
export function userAgentLogFields(value: string | undefined): { host: string; clientVersion: string } {
  const match = value && value.length <= 128 ? /^([^/]+)\/([^ ]+)$/.exec(value) : null;
  return clientLogFields(match ? { name: match[1], version: match[2] } : undefined);
}

/** A short random id that ties together the lines of one request. */
export function requestId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Keys userRef. Account ids are guessable (github-<sequential id>), so an unkeyed hash
 * could be reversed by hashing every id; this key exists only in the running process.
 */
const USER_REF_KEY = randomBytes(32);

/**
 * A handle for a user id, so one server process's logs can be correlated without naming
 * anyone. Not reversible, and different after every restart.
 */
export function userRef(userId: string): string {
  return createHmac('sha256', USER_REF_KEY).update(userId).digest('hex').slice(0, 10);
}
