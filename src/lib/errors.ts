/**
 * One error vocabulary for the whole server.
 *
 * Every error we throw on purpose is an AppError (or a subclass like ProfileError
 * or BoundaryError) carrying a stable, machine-readable `code`. The message is
 * written for the user and may reach the model, so it never echoes attacker-chosen
 * text (URLs, upstream bodies) unless it was cleaned first.
 *
 * Callers branch on `code`, never on the message text. Tool results carry the code
 * in structuredContent.error; HTTP endpoints map it to a status with httpStatus().
 * Anything that isn't an AppError is a bug: it's logged with its stack and reported
 * as `internal`, without its message.
 */

export const ERROR_CODES = {
  /** The caller sent something unusable: a bad argument, a malformed profile, an invalid handle. */
  invalid_argument: { status: 400, retryable: false },
  /** The thing named doesn't exist (or the caller can't see it). */
  not_found: { status: 404, retryable: false },
  /** It already exists, or clashes with something that does (a duplicate portal, a taken handle). */
  conflict: { status: 409, retryable: false },
  /** The request is fine, but the state doesn't allow it yet (e.g. sharing before claiming a handle). */
  failed_precondition: { status: 409, retryable: false },
  /** A per-user cap was reached: a full room, the most shares or follows MCPortal keeps. */
  limit_exceeded: { status: 409, retryable: false },
  /** The usage budget is spent for now. */
  rate_limited: { status: 429, retryable: true },
  /** Signed in, but not allowed (suspended, not an admin, someone else's data). */
  forbidden: { status: 403, retryable: false },
  /** Not signed in. */
  unauthenticated: { status: 401, retryable: false },
  /** Not available on this server (e.g. sharing on a local MCPortal). */
  unavailable: { status: 501, retryable: false },
  /** The fetch boundary refused: not http(s), a non-public address, a disallowed redirect. */
  fetch_blocked: { status: 400, retryable: false },
  /** The fetch took too long. */
  fetch_timeout: { status: 504, retryable: true },
  /** The response was bigger than allowed. */
  fetch_too_large: { status: 502, retryable: false },
  /** Couldn't connect to the other server (DNS, refused, reset). */
  upstream_unreachable: { status: 502, retryable: true },
  /** The other server answered, but with an error status or something unparseable. */
  upstream_error: { status: 502, retryable: false },
  /** A bug or an unexpected failure. Its details stay in the logs. */
  internal: { status: 500, retryable: false },
} as const satisfies Record<string, { status: number; retryable: boolean }>;

export type ErrorCode = keyof typeof ERROR_CODES;

export interface AppErrorOptions {
  cause?: unknown;
  /** Small, safe, machine-readable facts (a limit, a retry delay). Never secrets or raw upstream text. */
  details?: Record<string, string | number | boolean>;
}

export class AppError extends Error {
  override name = 'AppError';
  readonly code: ErrorCode;
  readonly details?: Record<string, string | number | boolean>;

  constructor(code: ErrorCode, message: string, options: AppErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.code = code;
    if (options.details) this.details = options.details;
  }

  get retryable(): boolean {
    return ERROR_CODES[this.code].retryable;
  }
}

/** An upstream server's failure: unreachable, an error status, or a body we couldn't use. */
export class UpstreamError extends AppError {
  override name = 'UpstreamError';
  /** The HTTP status the upstream answered with, if it answered. */
  readonly status?: number;

  constructor(code: Extract<ErrorCode, 'upstream_unreachable' | 'upstream_error'>, message: string, options: AppErrorOptions & { status?: number } = {}) {
    super(code, message, options);
    if (options.status !== undefined) this.status = options.status;
  }
}

/** Throw for a non-2xx upstream response. The message names the host and status only. */
export function upstreamStatus(what: string, status: number): UpstreamError {
  return new UpstreamError('upstream_error', `${what} responded ${status}`, { status, details: { status } });
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** The code for any thrown value: its own for an AppError, `internal` for everything else. */
export function errorCode(error: unknown): ErrorCode {
  return isAppError(error) ? error.code : 'internal';
}

export function httpStatus(code: ErrorCode): number {
  return ERROR_CODES[code].status;
}

/** A thrown value's message, for logs. Use userMessage() for anything the user or model sees. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** What the user (and model) may see: an AppError's own message, or a generic line for a bug. */
export function userMessage(error: unknown, fallback = 'Something went wrong on our side.'): string {
  return isAppError(error) ? error.message : fallback;
}

/** A thrown value with its stack, for logs. */
export function errorStack(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
