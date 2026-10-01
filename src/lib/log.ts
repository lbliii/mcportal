/**
 * The server's one logger. Leveled and structured: every line is an event name
 * plus flat fields, written to stderr (stdout belongs to the stdio transport).
 *
 *   text (default)  [mcportal] info tool.call tool=open_room outcome=ok ms=41 req=3f9c…
 *   json            {"t":"2026-10-01T…","level":"info","event":"tool.call","tool":"open_room",…}
 *
 * MCPORTAL_LOG_FORMAT=json suits a log platform (Railway); MCPORTAL_LOG_LEVEL sets the
 * floor (default info). Fields are for ids, names, counts and timings: never tokens,
 * profile contents or third-party text. User ids are logged only as userRef() hashes.
 */
import { createHash, randomBytes } from 'node:crypto';

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
    const all = Object.entries({ ...base, ...fields }).filter((e): e is [string, string | number | boolean | null] => e[1] !== undefined);
    if (format === 'json') {
      write(JSON.stringify({ t: now().toISOString(), level, event, ...Object.fromEntries(all) }));
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
  const format = env.MCPORTAL_LOG_FORMAT === 'json' ? 'json' : 'text';
  return createLogger(write ? { level, format, write } : { level, format });
}

/** A short random id that ties together the lines of one request. */
export function requestId(): string {
  return randomBytes(6).toString('hex');
}

/** A stable, non-reversible handle for a user id, so logs can be correlated without naming anyone. */
export function userRef(userId: string): string {
  return createHash('sha256').update(`mcportal-log:${userId}`).digest('hex').slice(0, 10);
}
