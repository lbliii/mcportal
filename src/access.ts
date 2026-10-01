/**
 * The one access gate (identity plan). Every tool call and hosted endpoint asks
 * authorize(actor, action, resource) before doing anything; there is no second path.
 *
 * Rules today:
 *   - a suspended account can do nothing;
 *   - `admin` actions need the admin role (and admin actions are never MCP tools);
 *   - a resource with an owner can only be touched by that owner.
 * Sharing (M2) adds audience rules for reading other people's shares here.
 */
import type { AccountStatus, Role } from './accounts.ts';

export interface Actor {
  accountId: string;
  role: Role;
  status: AccountStatus;
  /** The GitHub login, when known (suggests a handle). */
  login?: string;
}

/** read: look at your own data · write: change it · fetch: cause outbound requests · admin: manage others */
export type Action = 'read' | 'write' | 'fetch' | 'admin';

export interface Resource {
  ownerId?: string;
}

export type Decision = { ok: true } | { ok: false; reason: string };

export function authorize(actor: Actor, action: Action, resource: Resource = {}): Decision {
  if (actor.status !== 'active') return { ok: false, reason: 'This account is suspended.' };
  if (action === 'admin' && actor.role !== 'admin') return { ok: false, reason: 'That needs an admin.' };
  // Someone else's resource: only through an admin action (which already required the admin role).
  if (resource.ownerId !== undefined && resource.ownerId !== actor.accountId && action !== 'admin') {
    return { ok: false, reason: 'That belongs to someone else.' };
  }
  return { ok: true };
}

/** The single user of a local (stdio) MCPortal owns everything on the machine. */
export function localActor(accountId: string): Actor {
  return { accountId, role: 'user', status: 'active' };
}
