/**
 * The hosted state API: what a linked local MCPortal calls instead of its own files.
 *
 *   POST /api/v1/call   { calls: [{ id, method, params }] }  ->  { results: [{ id, result } | { id, error }] }
 *
 * Every method is one entry in a table (src/api/methods.ts) with a param schema, an
 * access class and a cost. The dispatcher here does for each call what src/mcp.ts
 * does for a tool: check the params, ask the access gate, charge the budget, run it,
 * and turn expected failures into coded errors and anything else into `internal`.
 *
 * Calls act as the token's account, always: no method takes an account id to act as.
 * Calls in a batch run concurrently and are independent; there are no transactions
 * across them.
 */
import { authorize, localActor } from '../access.ts';
import { budgetMessage } from '../lib/budget.ts';
import { ERROR_CODES, errorStack, isAppError, type ErrorCode } from '../lib/errors.ts';
import { requestId, silentLogger, userRef } from '../lib/log.ts';
import { schemaProblem, type JsonSchema } from '../lib/schema.ts';
import { clean } from '../lib/text.ts';
import type { ToolContext, ToolErrorInfo } from '../tools/kit.ts';

export const API_PATH = '/api/v1/call';
/** Whole exports (GET, ?format=) and imports (POST, an MCPortal export as the body). */
export const API_EXPORT_PATH = '/api/v1/export';
export const API_IMPORT_PATH = '/api/v1/import';
/** Calls per request. */
export const API_MAX_CALLS = 20;
/** The header a client names its version in, and the oldest version this server still serves. */
export const CLIENT_HEADER = 'mcportal-client';
export const MIN_CLIENT_VERSION = '0.5.0';

export interface ApiMethod {
  /** For the access gate: read your own data, or change it. */
  access: 'read' | 'write';
  /** Budget units per call (default 1). */
  cost?: number;
  params: JsonSchema;
  run: (params: Record<string, unknown>, ctx: ToolContext) => Promise<unknown>;
}

export type ApiResult = { id: string | number; result: unknown } | { id: string | number | null; error: ToolErrorInfo };

function failure(id: string | number | null, code: ErrorCode, message: string, details?: Record<string, string | number | boolean>): ApiResult {
  return { id, error: { code, message, retryable: ERROR_CODES[code].retryable, ...(details ? { details } : {}) } };
}

/** "0.10.2" > "0.9.9"; anything that isn't x.y.z is older than everything. */
export function versionAtLeast(version: string, min: string): boolean {
  const parse = (v: string) => (/^\d+\.\d+\.\d+$/.test(v) ? v.split('.').map(Number) : undefined);
  const a = parse(version.trim()), b = parse(min)!;
  if (!a) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i]! > b[i]!;
  return true;
}

async function runCall(call: unknown, ctx: ToolContext, methods: Record<string, ApiMethod>): Promise<ApiResult> {
  if (typeof call !== 'object' || call === null || Array.isArray(call)) return failure(null, 'invalid_argument', 'Each call must be an object');
  const { id, method: name, params = {} } = call as Record<string, unknown>;
  if (typeof id !== 'string' && typeof id !== 'number') return failure(null, 'invalid_argument', 'Each call needs an id (a string or number)');
  if (typeof name !== 'string' || !Object.hasOwn(methods, name)) return failure(id, 'not_found', `Unknown method ${clean(String(name), 60)}`);
  const method = methods[name]!;
  const log = (ctx.log ?? silentLogger).child({ api: name, user: userRef(ctx.userId) });
  const started = Date.now();
  const done = (result: ApiResult, outcome: string): ApiResult => {
    const code = 'error' in result ? result.error.code : undefined;
    const ms = Date.now() - started;
    log.info('api.call', { outcome, code, ms });
    ctx.metrics?.record(`api:${name}`, outcome, ms, code);
    return result;
  };

  const problem = schemaProblem(method.params, params, 'params');
  if (problem) return done(failure(id, 'invalid_argument', `${name}: ${problem}.`), 'invalid');
  const decision = authorize(ctx.actor ?? localActor(ctx.userId), method.access, { ownerId: ctx.userId });
  if (!decision.ok) return done(failure(id, 'forbidden', decision.reason), 'denied');
  if (ctx.budget) {
    const verdict = ctx.budget.take(ctx.userId, method.cost ?? 1);
    if (!verdict.ok) return done(failure(id, 'rate_limited', budgetMessage(verdict), { scope: verdict.scope, retryAfterSeconds: verdict.retryAfterSeconds }), 'limited');
  }
  try {
    return done({ id, result: (await method.run(params as Record<string, unknown>, { ...ctx, log })) ?? null }, 'ok');
  } catch (error) {
    if (isAppError(error) && error.code !== 'internal') return done(failure(id, error.code, clean(error.message, 500), error.details), 'error');
    const ref = requestId();
    log.error('api.crashed', { ref, error: errorStack(error) });
    return done(failure(id, 'internal', `${name} failed: something went wrong on our side (reference ${ref}).`, { ref }), 'crashed');
  }
}

/**
 * One request's calls. Returns undefined when the body isn't a batch at all (the
 * caller answers 400); otherwise one result per call, in order.
 */
export async function handleCalls(body: unknown, ctx: ToolContext, methods: Record<string, ApiMethod>): Promise<ApiResult[] | undefined> {
  const calls = typeof body === 'object' && body !== null ? (body as { calls?: unknown }).calls : undefined;
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > API_MAX_CALLS) return undefined;
  return Promise.all(calls.map((call) => runCall(call, ctx, methods)));
}
