import "server-only";

/**
 * Users — and, because this is YouTube, the account creation that is not just a
 * user row.
 *
 * ## `lower(email)` everywhere, without exception
 *
 * `users_email_key` is a unique index on `lower(email)` rather than on `email`,
 * because PGlite ships no `citext` (see the schema header). The expression is
 * load-bearing in both directions and the failure is silent in both: a lookup
 * written as `where email = $1` misses the index *and* fails to find
 * `Ada@Example.com` for someone typing `ada@example.com` — so the address they
 * registered with appears not to exist, and if the sign-up path has the same
 * bug they can register it a second time. Every statement in this file that
 * touches an address goes through `lower()`.
 *
 * ## The password hash never leaves this module
 *
 * `domain/types.ts`'s `User` has no password field, so the hash cannot escape
 * through a return value. The two statements that read it select it explicitly
 * and drop it before mapping.
 */

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
} from "@/adapters/db/driver";
import type { Channel, User } from "@/domain/types";
import { hashPassword, needsRehash, verifyPassword } from "@/lib/auth/password";

import {
  deriveHandle,
  insertChannel,
  reserveHandle,
} from "./channels";
import {
  atomically,
  newId,
  reader,
  text,
  timestamp,
  translatingUniqueViolations,
} from "./shared";

/* ================================================================== SQL == */

const USER_FIELDS = "id, email, display_name, created_at";

/**
 * The index this module can violate as a matter of domain rules. A primary-key
 * collision is deliberately absent — see `translatingUniqueViolations`.
 */
const EMAIL_CONSTRAINT = {
  users_email_key: { entity: "user", field: "email" },
} as const;

/**
 * The two playlists every account has whether it asked for them or not.
 *
 * The titles are YouTube's. They are constants here rather than arguments
 * because `playlists_system_key` — a unique index on `(owner_id, kind)` where
 * `kind <> 'user'` — makes these rows singular by construction, and something
 * that can exist exactly once should not be parameterised as though it were a
 * template.
 */
const SYSTEM_PLAYLISTS = [
  { kind: "watch_later", title: "Watch later" },
  { kind: "liked", title: "Liked videos" },
] as const;

/* ================================================================ types == */

export interface CreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly displayName: string;
}

export interface RegisterInput extends CreateUserInput {
  /**
   * An explicit handle, without the leading `@`.
   *
   * Supplying one turns off collision resolution: a handle somebody asked for
   * by name is either available or it is not, and silently handing them
   * `adalovelace2` when they typed `adalovelace` would be answering a different
   * question. Omit it and {@link RegistrationResult.channel} gets a derived,
   * de-duplicated handle instead.
   */
  readonly handle?: string;
}

export interface RegistrationResult {
  readonly user: User;
  readonly channel: Channel;
}

export interface UsersRepository {
  create(input: CreateUserInput, tx?: SqlExecutor): Promise<User>;
  findById(id: string, tx?: SqlExecutor): Promise<User | null>;
  /** Case-insensitive, via the same `lower()` the unique index uses. */
  findByEmail(email: string, tx?: SqlExecutor): Promise<User | null>;
  /**
   * The sign-in check. `null` for a wrong password *and* for an address that
   * has no account, at the same cost — see {@link verifyPassword}.
   */
  verifyCredentials(
    email: string,
    password: string,
    tx?: SqlExecutor,
  ): Promise<User | null>;
  /** A user, a channel and two system playlists, atomically. */
  register(
    input: RegisterInput,
    tx?: SqlExecutor,
  ): Promise<RegistrationResult>;
}

/* =========================================================== repository == */

export function createUsersRepository(db: SqlDatabase): UsersRepository {
  return {
    async create(input, tx) {
      return insertUser(reader(db, tx), input, await hashPassword(input.password));
    },

    async findById(id, tx) {
      const rows = await reader(db, tx).query<SqlRow>(
        `select ${USER_FIELDS} from users where id = $1`,
        [id],
      );
      const row = rows[0];
      return row ? mapUser(row) : null;
    },

    async findByEmail(email, tx) {
      const rows = await reader(db, tx).query<SqlRow>(
        `select ${USER_FIELDS} from users where lower(email) = lower($1)`,
        [email],
      );
      const row = rows[0];
      return row ? mapUser(row) : null;
    },

    /**
     * Two round trips and a derivation, in that order, whatever the answer.
     *
     * The read selects the hash *and* the read model in one statement, so a
     * successful sign-in does not need a second lookup to answer "who is this".
     * When there is no row, `verifyPassword` is still called — with `null`,
     * which it documents as costing a full derivation. Skipping the call for an
     * unknown address is the account-enumeration oracle in its purest form: the
     * response arrives in microseconds instead of ~200 ms, and the difference
     * is measurable across the internet without any statistics.
     *
     * `__tests__/users.test.ts` asserts that call happens by spying on
     * `verifyPassword`, not by timing the request. A wall-clock assertion on a
     * 200 ms operation is a test that passes on a quiet machine and fails on a
     * busy one, which teaches everybody to ignore it.
     */
    async verifyCredentials(email, password, tx) {
      const exec = reader(db, tx);
      const rows = await exec.query<SqlRow>(
        `select ${USER_FIELDS}, password_hash from users
          where lower(email) = lower($1)`,
        [email],
      );
      const row = rows[0];
      const stored = row ? text(row, "password_hash") : null;

      if (!(await verifyPassword(password, stored)) || !row) return null;

      // The one moment the plaintext is in hand. A hash written under weaker
      // parameters is upgraded here or never — and the upgrade is deliberately
      // not awaited into the answer: if the write fails, the sign-in already
      // succeeded and turning it into an error would lock the account out for
      // a reason that has nothing to do with the credential.
      if (stored !== null && needsRehash(stored)) {
        const replacement = await hashPassword(password);
        await exec
          .execute("update users set password_hash = $2 where id = $1", [
            text(row, "id"),
            replacement,
          ])
          .catch(() => {
            /* Best effort. The next sign-in tries again. */
          });
      }

      return mapUser(row);
    },

    /**
     * Sign-up.
     *
     * Signing up on YouTube gives you a channel; there is no accountless state
     * and no "create your channel" step to forget. So the user, the channel and
     * the two system playlists are one transaction, and a failure anywhere in
     * it leaves no trace — the alternative is an account that owns nothing,
     * which every page after sign-up would have to defend against forever.
     *
     * The password is hashed *before* the transaction opens. That is not a
     * micro-optimisation: scrypt at these parameters takes ~200 ms, PGlite is a
     * single connection whose transactions are serialised behind one another,
     * and holding a transaction open across the derivation would make every
     * concurrent sign-up wait for every other one's hashing.
     */
    async register(input, tx) {
      const passwordHash = await hashPassword(input.password);

      return atomically(db, tx, async (exec) => {
        const user = await insertUser(exec, input, passwordHash);

        const handle =
          input.handle ??
          (await reserveHandle(
            exec,
            deriveHandle(input.displayName, input.email),
          ));

        const channel = await insertChannel(exec, {
          ownerId: user.id,
          handle,
          name: input.displayName,
        });

        for (const playlist of SYSTEM_PLAYLISTS) {
          await exec.execute(
            `insert into playlists (id, owner_id, title, kind, visibility)
             values ($1, $2, $3, $4, 'private')`,
            [newId("pl"), user.id, playlist.title, playlist.kind],
          );
        }

        return { user, channel };
      });
    },
  };
}

/* =========================================================== statements == */

/**
 * Insert a user through whichever executor the caller has.
 *
 * Takes an already-computed hash rather than the plaintext, so that
 * {@link UsersRepository.register} can do its hashing outside the transaction
 * and this function cannot accidentally do it inside one.
 */
async function insertUser(
  exec: SqlExecutor,
  input: CreateUserInput,
  passwordHash: string,
): Promise<User> {
  const rows = await translatingUniqueViolations(
    EMAIL_CONSTRAINT,
    input.email,
    () =>
      exec.query<SqlRow>(
        `insert into users (id, email, password_hash, display_name)
         values ($1, $2, $3, $4)
         returning ${USER_FIELDS}`,
        [newId("usr"), input.email, passwordHash, input.displayName],
      ),
  );
  const row = rows[0];
  if (!row) throw new Error("insert … returning users produced no row");
  return mapUser(row);
}

/* ============================================================== mapping == */

export function mapUser(row: SqlRow): User {
  return {
    id: text(row, "id"),
    email: text(row, "email"),
    displayName: text(row, "display_name"),
    createdAt: timestamp(row["created_at"]),
  };
}
