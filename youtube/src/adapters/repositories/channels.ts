import "server-only";

/**
 * Channels — the thing a video actually belongs to.
 *
 * A `Channel` read model carries `subscriberCount` and `videoCount`, and
 * neither is a column. That is a decision, not an oversight: a stored counter
 * has to be maintained by every path that subscribes, unsubscribes, publishes,
 * unpublishes, deletes a video or deletes a user — and the schema's cascading
 * deletes mean several of those paths belong to the database rather than to
 * this application. A counter the database can change behind our back is a
 * counter that drifts, and a drifted subscriber count is visible on the page.
 *
 * So they are computed, and the whole job of this module is to compute them
 * without an N+1: one statement returns the channels *and* their counts,
 * whether that is one channel or all of an owner's. The counts ride as scalar
 * subqueries rather than joins because `subscriptions` and `videos` are both
 * one-to-many — joining both at once multiplies rows, and undoing that needs
 * two `count(distinct …)` over a cross product, which is slower and easier to
 * get quietly wrong.
 */

import type {
  SqlDatabase,
  SqlExecutor,
  SqlRow,
  SqlValue,
} from "@/adapters/db/driver";
import type { Channel } from "@/domain/types";

import {
  Params,
  bool,
  escapeLikePrefix,
  newId,
  nullableText,
  num,
  reader,
  text,
  timestamp,
  translatingUniqueViolations,
} from "./shared";

/* ================================================================== SQL == */

/** Qualified for the selects, bare for `insert … returning`. */
const CHANNEL_FIELDS = `id, owner_id, handle, name, description,
    avatar_key, banner_key, verified, created_at`;
const CHANNEL_COLUMNS = `c.id, c.owner_id, c.handle, c.name, c.description,
    c.avatar_key, c.banner_key, c.verified, c.created_at`;

/**
 * The two computed counts.
 *
 * `videoCount` counts *public, ready, published* videos only, and that is the
 * number a channel page shows next to the subscriber count. Counting
 * everything would mean a visitor reads "42 videos" above a grid of 37,
 * because the other five are private, unlisted, or still uploading — and the
 * reflex diagnosis for that ("the grid is dropping rows") sends you looking in
 * entirely the wrong place. An owner's own dashboard wants a different number
 * and should ask a different question rather than widening this one.
 *
 * **`published_at is not null` was the missing third clause**, and it is the
 * one that made the paragraph above describe a bug rather than a rule. Every
 * surface that lists videos carries it — `videos.ts`, `recommendations.ts`,
 * and both queries in `subscriptions.ts` — so a public, ready row awaiting its
 * scheduled publication counted here and appeared in no feed anywhere. The
 * count was wrong in exactly the direction the comment says is confusing, and
 * only for videos in a state a demo corpus rarely produces.
 *
 * Both subqueries are index lookups: `subscriptions_channel_idx` and
 * `videos_channel_idx` are each keyed on the column being matched.
 */
const COUNT_COLUMNS = `(select count(*) from subscriptions s
      where s.channel_id = c.id) as subscriber_count,
    (select count(*) from videos v
      where v.channel_id = c.id
        and v.visibility = 'public'
        and v.upload_status = 'ready'
        and v.published_at is not null) as video_count`;

/**
 * The index this module can violate as a matter of domain rules.
 *
 * `channels_handle_key` is on `lower(handle)`, so it fires for a handle that
 * differs from an existing one only in case. A collision on the primary key is
 * deliberately absent from this map — see `translatingUniqueViolations`.
 */
const HANDLE_CONSTRAINT = {
  channels_handle_key: { entity: "channel", field: "handle" },
} as const;

/* ============================================================== handles == */

/** YouTube's own bounds: 3–30 characters of `a-z`, `0-9`, `.`, `_`, `-`. */
export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

/**
 * Fold arbitrary text into something that could be a handle.
 *
 * Diacritics are decomposed and their marks removed rather than the whole
 * letter being dropped — `Renée` becomes `renee`, not `rene`. Losing a letter
 * produces a handle its owner does not recognise as theirs, and it is the kind
 * of thing that is never noticed until someone complains about their own URL.
 *
 * The result may be shorter than {@link HANDLE_MIN_LENGTH}, or empty: a display
 * name of `你好` folds to nothing at all. What to do about that is
 * {@link deriveHandle}'s decision, not this function's.
 */
export function handleSlug(source: string): string {
  return source
    .normalize("NFKD")
    // The combining marks NFKD just split off, as escapes: a literal
    // U+0300 in a character class renders on top of the bracket and is
    // indistinguishable from a typo in every editor and every diff.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "")
    .replace(/([._-])\1+/g, "$1")
    .replace(/^[._-]+/, "")
    .slice(0, HANDLE_MAX_LENGTH)
    .replace(/[._-]+$/, "");
}

/**
 * The handle a new account gets when it did not ask for one.
 *
 * Display name first, because that is what the owner expects to see in their
 * own URL; the local part of the address second, because it is at least theirs;
 * `user` last, so an account whose name folds to nothing still gets a channel
 * rather than an error on the sign-up form. Every step is a pure function of
 * its input, which is what lets the registration test assert the exact handle
 * instead of a pattern.
 */
export function deriveHandle(displayName: string, email: string): string {
  const fromName = handleSlug(displayName);
  if (fromName.length >= HANDLE_MIN_LENGTH) return fromName;
  const fromEmail = handleSlug(email.split("@")[0] ?? "");
  if (fromEmail.length >= HANDLE_MIN_LENGTH) return fromEmail;
  return "user";
}

/**
 * The stem numbered candidates are built from.
 *
 * Five characters of headroom, so `stem + "99999"` still fits in thirty.
 * Without it a thirty-character base would have to be truncated to make room
 * for its suffix — and the truncated stem is a *different* prefix from the one
 * {@link reserveHandle} queried, so the availability check would be answering a
 * question about a different family of handles than the one it hands back.
 */
function suffixStem(base: string): string {
  const trimmed = base
    .slice(0, HANDLE_MAX_LENGTH - 5)
    .replace(/[._-]+$/, "");
  return trimmed.length > 0 ? trimmed : "user";
}

/**
 * Pick a free handle in `base`'s family, deterministically.
 *
 * `base`, then `base2`, `base3`, … — never a random suffix. Random would be
 * untestable, and it would also tell the second Ada Lovelace nothing about why
 * her URL looks like that; `adalovelace2` at least says what happened.
 *
 * One statement, not one per candidate. The `like` prefix pulls the whole
 * family back in a single round trip and the choice is made in memory, so the
 * tenth collision costs what the first does. The prefix is {@link suffixStem}'s
 * rather than `base`'s, and since that is itself a prefix of `base`, the query
 * still covers `base` itself.
 *
 * This is a check-then-insert and therefore a race: two registrations running
 * concurrently can choose the same free handle, and the loser's `insert` hits
 * `channels_handle_key`. That is the correct outcome — the index is the
 * authority and this function is only an optimiser for the common case — and it
 * surfaces as a `DuplicateError` rather than as a duplicated handle. Retrying
 * is the caller's decision, because only the caller knows what else its
 * transaction has already done.
 */
export async function reserveHandle(
  exec: SqlExecutor,
  desired: string,
): Promise<string> {
  // Lowercased up front because the uniqueness rule is on `lower(handle)`, so
  // comparing a mixed-case candidate against the taken set would find nothing
  // and hand back a handle the index then rejects.
  const base = desired.toLowerCase();
  const stem = suffixStem(base);
  const rows = await exec.query<{ handle: string }>(
    `select lower(handle) as handle from channels
      where lower(handle) like $1 escape '\\'`,
    [`${escapeLikePrefix(stem)}%`],
  );
  const taken = new Set(rows.map((row) => row.handle));

  if (!taken.has(base)) return base;
  // Bounded by the rows just read: with `n` handles in the family at most
  // `n + 1` candidates can be occupied, so the loop always terminates.
  for (let suffix = 2; suffix <= taken.size + 2; suffix += 1) {
    const candidate = `${stem}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  // Unreachable given the bound above. Throwing rather than returning a
  // duplicate, because a handle that silently collides is worse than a sign-up
  // that fails loudly.
  throw new Error(`No free handle in the family "${stem}".`);
}

/* =========================================================== statements == */

export interface CreateChannelInput {
  readonly ownerId: string;
  /** Without the leading `@`. Case is preserved; uniqueness ignores it. */
  readonly handle: string;
  readonly name: string;
  readonly description?: string;
  readonly avatarKey?: string | null;
  readonly bannerKey?: string | null;
}

/**
 * Insert a channel through whichever executor the caller has.
 *
 * A free function rather than a method because registration composes it into a
 * transaction alongside a user insert and two playlist inserts, and threading a
 * whole repository object through for one statement is more ceremony than the
 * statement.
 */
export async function insertChannel(
  exec: SqlExecutor,
  input: CreateChannelInput,
): Promise<Channel> {
  const rows = await translatingUniqueViolations(
    HANDLE_CONSTRAINT,
    input.handle,
    () =>
      exec.query<SqlRow>(
        `insert into channels
           (id, owner_id, handle, name, description, avatar_key, banner_key)
         values ($1, $2, $3, $4, $5, $6, $7)
         returning ${CHANNEL_FIELDS}`,
        [
          newId("ch"),
          input.ownerId,
          input.handle,
          input.name,
          input.description ?? "",
          input.avatarKey ?? null,
          input.bannerKey ?? null,
        ],
      ),
  );
  const row = rows[0];
  if (!row) throw new Error("insert … returning channels produced no row");
  // A channel that did not exist a millisecond ago has no subscribers and no
  // videos. Re-selecting to learn that is a round trip whose answer is already
  // known, so the counts are supplied rather than queried.
  return mapChannel(row, { subscriberCount: 0, videoCount: 0 });
}

/* =========================================================== repository == */

/** Every field optional: absent means "leave it", `null` means "clear it". */
export interface UpdateChannelInput {
  readonly handle?: string;
  readonly name?: string;
  readonly description?: string;
  readonly avatarKey?: string | null;
  readonly bannerKey?: string | null;
  /**
   * The tick. Not the owner's to set — this is the seam a review decision or a
   * seed writes through, and whatever calls it is what has to be authorised.
   * It lives here rather than in a second repository because it is one column
   * on one row, and a channel with two write paths is a channel whose
   * invariants are enforced in two places.
   */
  readonly verified?: boolean;
}

export interface ChannelsRepository {
  create(input: CreateChannelInput, tx?: SqlExecutor): Promise<Channel>;
  findById(id: string, tx?: SqlExecutor): Promise<Channel | null>;
  /** Tolerates a leading `@`, because that is how a handle appears in a URL. */
  findByHandle(handle: string, tx?: SqlExecutor): Promise<Channel | null>;
  listForOwner(ownerId: string, tx?: SqlExecutor): Promise<Channel[]>;
  /** `null` when there is no such channel. */
  update(
    id: string,
    patch: UpdateChannelInput,
    tx?: SqlExecutor,
  ): Promise<Channel | null>;
}

export function createChannelsRepository(db: SqlDatabase): ChannelsRepository {
  return {
    create: async (input, tx) => insertChannel(reader(db, tx), input),

    findById: async (id, tx) =>
      selectOne(reader(db, tx), "c.id = $1", [id]),

    findByHandle: async (handle, tx) =>
      selectOne(reader(db, tx), "lower(c.handle) = lower($1)", [
        handle.replace(/^@/, ""),
      ]),

    /**
     * Oldest first, then by handle.
     *
     * The tiebreaker is not decoration. **Measured:** PGlite's `now()` has
     * millisecond resolution — five channels inserted back to back came back
     * with `…47.152000`, `…47.154000`, `…47.154000`, `…47.154000`,
     * `…47.154000`, the trailing zeroes being the microseconds Postgres has
     * room for and this build never fills. So `created_at` is not a total order
     * here, and an owner creating two channels in one request gets a tie.
     *
     * `c.id asc` would break the tie deterministically and *uselessly*: ids are
     * random, so the order would be stable for a given database and unrelated
     * to anything a person could predict — including insertion order, which is
     * what the reader of `order by created_at` assumes they are getting.
     * `handle` is unique by index and therefore makes this a total order, and
     * alphabetical is at least the answer a channel switcher wants.
     *
     * Real Postgres has microsecond `now()`, so a test that asserted insertion
     * order would pass against Neon and fail locally — the direction of
     * disagreement the driver's header warns about.
     */
    async listForOwner(ownerId, tx) {
      const rows = await reader(db, tx).query<SqlRow>(
        `select ${CHANNEL_COLUMNS}, ${COUNT_COLUMNS}
           from channels c
          where c.owner_id = $1
          order by c.created_at asc, c.handle asc`,
        [ownerId],
      );
      return rows.map((row) => mapChannel(row));
    },

    async update(id, patch, tx) {
      const params = new Params();
      const assignments: string[] = [];
      const set = (column: string, value: SqlValue): void => {
        assignments.push(`${column} = ${params.bind(value)}`);
      };

      if (patch.handle !== undefined) set("handle", patch.handle);
      if (patch.name !== undefined) set("name", patch.name);
      if (patch.description !== undefined) set("description", patch.description);
      if (patch.avatarKey !== undefined) set("avatar_key", patch.avatarKey);
      if (patch.bannerKey !== undefined) set("banner_key", patch.bannerKey);
      if (patch.verified !== undefined) set("verified", patch.verified);

      // An empty patch is a read, not a no-op write. `update … set where id`
      // is a syntax error and `set id = id` would take a row lock for nothing.
      if (assignments.length === 0) {
        return selectOne(reader(db, tx), "c.id = $1", [id]);
      }

      const idPlaceholder = params.bind(id);
      // One statement: the CTE performs the update and the outer select
      // computes the counts against the row it returned. Doing it as two
      // statements would need a transaction to be equivalent, and would report
      // counts from an instant *after* the write rather than with it.
      const rows = await translatingUniqueViolations(
        HANDLE_CONSTRAINT,
        patch.handle ?? "",
        () =>
          reader(db, tx).query<SqlRow>(
            `with updated as (
               update channels set ${assignments.join(", ")}
                where id = ${idPlaceholder}
               returning ${CHANNEL_FIELDS}
             )
             select ${CHANNEL_COLUMNS}, ${COUNT_COLUMNS} from updated c`,
            params.values,
          ),
      );
      const row = rows[0];
      return row ? mapChannel(row) : null;
    },
  };
}

/* ============================================================== mapping == */

async function selectOne(
  exec: SqlExecutor,
  where: string,
  params: readonly SqlValue[],
): Promise<Channel | null> {
  const rows = await exec.query<SqlRow>(
    `select ${CHANNEL_COLUMNS}, ${COUNT_COLUMNS}
       from channels c
      where ${where}`,
    params,
  );
  const row = rows[0];
  return row ? mapChannel(row) : null;
}

/**
 * A `channels` row as the domain sees it.
 *
 * `counts` is for the one caller that knows them without asking — a freshly
 * inserted channel. Everything else reads them off the row, and passing a row
 * that has no count columns without supplying them is a `TypeError` naming the
 * missing column rather than a silent zero.
 */
export function mapChannel(
  row: SqlRow,
  counts?: { subscriberCount: number; videoCount: number },
): Channel {
  return {
    id: text(row, "id"),
    ownerId: text(row, "owner_id"),
    handle: text(row, "handle"),
    name: text(row, "name"),
    description: text(row, "description"),
    avatarKey: nullableText(row, "avatar_key"),
    bannerKey: nullableText(row, "banner_key"),
    verified: bool(row, "verified"),
    subscriberCount: counts?.subscriberCount ?? num(row, "subscriber_count"),
    videoCount: counts?.videoCount ?? num(row, "video_count"),
    createdAt: timestamp(row["created_at"]),
  };
}
