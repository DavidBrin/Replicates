import "server-only";

/**
 * Who is asking — the one place a request becomes a user and an {@link Actor}.
 *
 * Two entry points, because a Server Component and a Route Handler get at the
 * cookie differently and only one of them may write one back:
 *
 *  - {@link currentUser} reads `next/headers` during a render. It never renews
 *    the session, because Next forbids setting a cookie there and a renewal
 *    that cannot be delivered signs the user out (see `session.ts`).
 *  - {@link userFromRequest} takes the `Request` a route handler was given and
 *    hands back any renewed token for the handler to put on its `Response`.
 *
 * Everything else in the codebase should be asking one of those two rather than
 * parsing a cookie of its own.
 */

import { cookies } from "next/headers";

import { getDb, type SqlDatabase, type SqlRow } from "@/adapters/db";
import type { UserId, WorkspaceId } from "@/domain/entities";
import type { Actor, WorkspacePolicySettings } from "@/domain/policy";
import { loadActor } from "@/domain/services/membership";

import { resolveSession, sessionCookieName, sessionTokenFromRequest } from "./session";

export interface SessionUser {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  readonly displayName: string;
  readonly avatarUrl: string | null;
  readonly avatarColor: string;
}

interface UserRow extends SqlRow {
  readonly id: UserId;
  readonly email: string;
  readonly name: string;
  readonly display_name: string;
  readonly avatar_url: string | null;
  readonly avatar_color: string;
}

/**
 * Resolve a token to a user.
 *
 * A deactivated account reads as signed out rather than as a suspended
 * principal. The policy's `suspended` flag still exists and still denies every
 * action (R9), but a deactivated user should not get as far as a workspace
 * screen that then refuses every button on it.
 */
async function userFromToken(
  token: string | null,
  options: { readonly db?: SqlDatabase; readonly renew?: boolean } = {},
): Promise<{ user: SessionUser; renewedToken?: string } | null> {
  const db = options.db ?? getDb();
  const session = await resolveSession(token, { db, renew: options.renew });
  if (!session) return null;

  const rows = await db.query<UserRow>(
    `select id, email, name, display_name, avatar_url, avatar_color
       from users where id = $1 and active`,
    [session.userId],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      displayName: row.display_name,
      avatarUrl: row.avatar_url,
      avatarColor: row.avatar_color,
    },
    ...(session.renewedToken ? { renewedToken: session.renewedToken } : {}),
  };
}

/** The signed-in user during a render, or `null`. */
export async function currentUser(
  options: { readonly db?: SqlDatabase } = {},
): Promise<SessionUser | null> {
  const jar = await cookies();
  const token = jar.get(sessionCookieName())?.value ?? null;
  const resolved = await userFromToken(token, { db: options.db, renew: false });
  return resolved?.user ?? null;
}

/** Thrown by {@link requireUser}; the route or page layer turns it into a 401. */
export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}

export async function requireUser(
  options: { readonly db?: SqlDatabase } = {},
): Promise<SessionUser> {
  const user = await currentUser(options);
  if (!user) throw new UnauthenticatedError();
  return user;
}

/**
 * The signed-in user for a route handler.
 *
 * `renewedToken` is set when the session crossed its half-life; the handler is
 * responsible for putting it on the response, which is the only reason renewal
 * is safe to do here and not during a render.
 */
export async function userFromRequest(
  request: Request,
  options: { readonly db?: SqlDatabase; readonly renew?: boolean } = {},
): Promise<{ user: SessionUser; renewedToken?: string } | null> {
  return userFromToken(sessionTokenFromRequest(request), {
    db: options.db,
    renew: options.renew ?? true,
  });
}

/**
 * The user's standing in one workspace, ready for `can()`.
 *
 * Returns an actor with a null workspace role — not `null` — when the user is
 * not a member, so callers keep passing something to `can()` rather than
 * writing their own "if not a member" branch, which is where a missing check
 * hides.
 */
export async function actorFor(
  workspaceId: WorkspaceId,
  userId: UserId | null,
  options: { readonly db?: SqlDatabase; readonly settings?: WorkspacePolicySettings } = {},
): Promise<Actor> {
  if (!userId) return { userId: null, workspaceRole: null };
  const db = options.db ?? getDb();
  return loadActor(db, workspaceId, userId, options.settings);
}
