/**
 * `POST /api/auth/signup`
 *
 * Creates an account, opens a session, and — when the request carries an invite
 * token — redeems it in the same call. That last part is what makes an invite
 * link work for someone who has no account yet: the alternative is signing up,
 * losing the token, and staring at an empty workspace list.
 *
 * ## One transaction, because "invitation-only" is a claim about what exists
 *
 * The account, the session and the redemption are a single transaction, and on
 * a closed workspace an invitation that does not redeem takes all three down
 * with it.
 *
 * The version this replaced checked only that an `inviteToken` was *present*
 * and at least sixteen characters long, then created the user and the session
 * and tried the redemption afterwards — reporting the failure as a note on a
 * `201`. So `{"inviteToken": "aaaaaaaaaaaaaaaa"}` produced a real account and a
 * live session on a workspace configured to admit nobody without an invitation.
 * The account was outside every workspace, which is why it reads as harmless
 * until you notice that `ALLOW_OPEN_SIGNUP=false` is the *only* thing standing
 * between a stranger and an authenticated principal on the deployment: from
 * there they hold a session cookie, an entry in `users`, an address the members
 * table will match against, and every endpoint that distinguishes "signed in"
 * from "signed out" rather than "member" from "non-member".
 *
 * So the order is now: refuse a token that names no invitation *before* writing
 * anything, and roll back everything if the redemption fails for any of the
 * reasons only visible under the lock — expired, revoked, already spent, or
 * minted by an admin who has since been demoted below the role it grants.
 *
 * ## …and open sign-up keeps the lenient behaviour, deliberately
 *
 * When `ALLOW_OPEN_SIGNUP` is true the account was never gated on the
 * invitation, so a dead link is a note rather than a failure: refusing would
 * leave the visitor with no account *and* no form, since the page they used is
 * the invite page and it is now spent. The difference between the two modes is
 * the whole point — the token is a credential only where it is required.
 */

import { z } from "zod";

import {
  getDb,
  type SqlDatabase,
  type SqlExecutor,
  type SqlValue,
} from "@/adapters/db";
import { config } from "@/config/env";
import type { UserId, WorkspaceId, WorkspaceRole } from "@/domain/entities";
import { allowed, explainDenial } from "@/domain/policy";
import { withWorkspaceLock } from "@/domain/services/membership";
import { redeemInvite, workspaceForInviteToken } from "@/lib/auth/invites";
import { hashPassword } from "@/lib/auth/password";
import { consumeAuthAttempt } from "@/lib/auth/rate-limit";
import {
  createSession,
  readCookie,
  sessionCookie,
  type IssuedSession,
} from "@/lib/auth/session";
import { newId } from "@/lib/ids";

/**
 * A twelve-character minimum and no composition rules.
 *
 * Length is the only requirement that survives contact with how people actually
 * choose passwords; "one uppercase, one digit, one symbol" reliably produces
 * `Password1!` and a sticky note. NIST dropped composition rules in SP 800-63B
 * for the same reason. The cap exists because scrypt hashes whatever it is
 * given and a megabyte-long password is a denial-of-service vector.
 */
const Body = z.object({
  email: z.email().max(320),
  password: z.string().min(12).max(256),
  name: z.string().trim().min(1).max(120),
  displayName: z.string().trim().min(1).max(60).optional(),
  /**
   * Present when the visitor arrived through an invite link.
   *
   * The length bounds are a sanity check on a bearer token, nothing more. They
   * were once the *only* check on a closed workspace, which is the defect this
   * file is shaped around: a shape is not a credential, and the only thing that
   * can tell a real token from sixteen characters of anything is the database.
   */
  inviteToken: z.string().min(16).max(256).optional(),
});

/** The 15-minute cookie an invite page leaves behind before redirecting here. */
const PENDING_INVITE_COOKIE = "pending_invite";

const INVITATION_ONLY = "Sign-ups are invitation-only on this workspace.";

export async function POST(request: Request): Promise<Response> {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid sign-up details.", issues: z.treeifyError(parsed.error) },
      { status: 400 },
    );
  }
  const { email, password, name, displayName } = parsed.data;
  const inviteToken =
    parsed.data.inviteToken ??
    readCookie(request.headers.get("cookie"), PENDING_INVITE_COOKIE);

  // Before the hash. Every sign-up spends ~200 ms and 128 MB in scrypt, which
  // is the cost that protects the stored password and, unthrottled, the lever
  // that makes this endpoint worth flooding.
  const throttle = consumeAuthAttempt("signup", request, email);
  if (throttle.limited) {
    return Response.json(
      { error: "Too many sign-up attempts. Try again shortly." },
      {
        status: 429,
        headers: { "Retry-After": String(throttle.retryAfterSeconds) },
      },
    );
  }

  const { allowOpenSignup } = config().auth;

  // A closed workspace still has to let invited people in, or the invitation is
  // not an invitation.
  if (!allowOpenSignup && !inviteToken) {
    return Response.json({ error: INVITATION_ONLY }, { status: 403 });
  }

  const db = getDb();

  // Unlike sign-in, this one does tell you the address is taken. It has to: the
  // alternative is pretending to create an account that already exists and
  // handing the visitor a session they cannot have. The enumeration surface is
  // the same as any sign-up form's and is not the one `SPEC.md` §4 guards.
  const existing = await db.query(
    "select 1 from users where lower(email) = lower($1)",
    [email],
  );
  if (existing.length > 0) {
    return Response.json(
      { error: "An account with that email already exists." },
      { status: 409 },
    );
  }

  // Which workspace to lock — and, on a closed workspace, the first real test
  // the token has to pass. A token matching no row is refused here, before an
  // account exists to have to roll back.
  const workspaceId = inviteToken
    ? await workspaceForInviteToken(inviteToken, db)
    : null;
  if (!allowOpenSignup && workspaceId === null) {
    return Response.json({ error: INVITATION_ONLY }, { status: 403 });
  }

  // Outside the transaction: 200 ms of scrypt is 200 ms of holding a workspace
  // lock, and nothing in the hash depends on anything the transaction reads.
  const passwordHash = await hashPassword(password);
  const userId = newId("usr") as UserId;

  const create = async (tx: SqlExecutor): Promise<Created> => {
    await tx.execute(
      `insert into users (id, email, password_hash, name, display_name)
       values ($1, $2, $3, $4, $5)`,
      [
        userId,
        email,
        passwordHash,
        name,
        (displayName ?? email.split("@")[0] ?? name).toLowerCase(),
      ],
    );

    // `transactional(tx)` and not `db`: on Neon the transaction is a dedicated
    // client, so a session written through the pool would commit even when the
    // rest of this rolls back — an account that does not exist, holding a
    // session that does.
    const session = await createSession(userId, {
      userAgent: request.headers.get("user-agent"),
      db: transactional(tx, db),
    });

    if (inviteToken === null || inviteToken === undefined) {
      return { session, joined: null };
    }

    const redemption = await redeemInvite(tx, { token: inviteToken, userId });
    if (redemption.ok) {
      return {
        session,
        joined: {
          workspaceId: redemption.value.workspaceId,
          role: redemption.value.role,
        },
      };
    }

    // The closed-workspace path. Throwing is how the account and the session
    // are un-created: `db.transaction` rolls back and rethrows, and the catch
    // below turns it into the same refusal a missing token gets.
    if (!allowOpenSignup) throw new SignUpRefused(403, INVITATION_ONLY);

    // The account is real and the session is live — only the invitation
    // failed, so this is a 201 with a note rather than an error. Making it a
    // failure would leave the visitor with an account they cannot sign into
    // because the form they used is gone.
    return { session, joined: null, inviteError: explainDenial(redemption.denial) };
  };

  let created: Created;
  try {
    created =
      workspaceId === null
        ? await db.transaction(create)
        : await underWorkspaceLock(db, workspaceId, create);
  } catch (error) {
    if (error instanceof SignUpRefused) {
      return Response.json({ error: error.reason }, { status: error.status });
    }
    // The duplicate check above is a read, so two simultaneous sign-ups for one
    // address both pass it and the unique index settles the argument. Reporting
    // the loser as a 409 rather than a 500 says the true thing.
    if (isUniqueViolation(error)) {
      return Response.json(
        { error: "An account with that email already exists." },
        { status: 409 },
      );
    }
    throw error;
  }

  const headers = new Headers();
  headers.append("Set-Cookie", sessionCookie(created.session.token));
  if (inviteToken) {
    // The pending-invite cookie has done its job either way; leaving it would
    // re-try the same dead link on the next sign-up from this browser.
    headers.append(
      "Set-Cookie",
      `${PENDING_INVITE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    );
  }

  return Response.json(
    {
      user: { id: userId, email, name },
      workspace: created.joined,
      inviteError: created.inviteError,
    },
    { status: 201, headers },
  );
}

/* =============================================================== helpers = */

interface Created {
  readonly session: IssuedSession;
  readonly joined: {
    readonly workspaceId: WorkspaceId;
    readonly role: WorkspaceRole;
  } | null;
  readonly inviteError?: string;
}

/**
 * A refusal that has to unwind a transaction to be true.
 *
 * `Authorized` is the vocabulary everywhere else in this codebase, and it is
 * the wrong one here for a mechanical reason: a returned denial *commits*. The
 * only way to un-create the account is to leave through the exception path, so
 * the refusal has to be an exception.
 */
class SignUpRefused extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
  ) {
    super(reason);
    this.name = "SignUpRefused";
  }
}

/**
 * Run `fn` inside the workspace's lock, unwrapping the policy result.
 *
 * `withWorkspaceLock` answers `NOT_FOUND` when the workspace has been deleted
 * between locating it and locking it. That is a dead invitation like any other,
 * and on a closed workspace it must not leave an account behind, so it leaves
 * by the same door as every other redemption failure.
 */
async function underWorkspaceLock<T>(
  db: SqlDatabase,
  workspaceId: WorkspaceId,
  fn: (tx: SqlExecutor) => Promise<T>,
): Promise<T> {
  const outcome = await withWorkspaceLock<T>(db, workspaceId, async (tx) =>
    allowed(await fn(tx)),
  );
  if (!outcome.ok) throw new SignUpRefused(403, explainDenial(outcome.denial));
  return outcome.value;
}

/**
 * A `SqlDatabase` façade over one transaction's executor.
 *
 * `createSession` takes a database because it is normally called on its own.
 * Here it has to write inside a transaction it did not open, and this is the
 * adapter that lets it without teaching the session module about transactions
 * it does not otherwise care about. `transaction()` joins rather than nesting,
 * which is what both drivers do for a nested call anyway.
 */
function transactional(tx: SqlExecutor, db: SqlDatabase): SqlDatabase {
  return {
    engine: db.engine,
    query: (sql: string, params?: readonly SqlValue[]) => tx.query(sql, params),
    execute: (sql: string, params?: readonly SqlValue[]) =>
      tx.execute(sql, params),
    transaction: <T>(fn: (inner: SqlExecutor) => Promise<T>) => fn(tx),
    migrate: () => db.migrate(),
    close: () => db.close(),
  };
}

/** Postgres' unique-violation SQLSTATE, however the driver surfaces it. */
function isUniqueViolation(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "23505") return true;
  return (
    error instanceof Error &&
    /duplicate key value violates unique constraint/i.test(error.message)
  );
}
