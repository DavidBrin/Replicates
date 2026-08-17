import "server-only";

import type { SqlDatabase, SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type { Playlist, PlaylistKind, VideoCard, Visibility } from "@/domain/types";

import {
  atomically,
  first,
  newId,
  nullableText,
  num,
  text,
  timestamp,
} from "./shared";
import { toCard } from "./videos";

/**
 * Playlists, including the two every account has whether it asked or not.
 *
 * The interesting part is not the table, it is the two invariants that keep
 * the "liked" playlist from becoming a second, disagreeing record of the same
 * fact. A video is in your liked playlist *because* you liked it — one truth,
 * stored in `reactions`, projected here. So the generic add and remove refuse
 * that playlist outright and `setLikedMembership` is the only way in, called
 * from inside the same transaction that writes the reaction.
 *
 * The alternative — let both surfaces write and reconcile later — is the design
 * that produces a liked playlist containing videos whose like button is grey.
 */

/**
 * The gap left between adjacent items, so a drag between two of them is one
 * `update` rather than a rewrite of the list.
 *
 * 1024 gives ten drags into the same gap before the halving runs out, which is
 * far past what anyone does to one pair of items in a sitting; the re-space
 * below handles the eleventh. The schema comment explains why this is an
 * integer and not a fractional string: playlists are dragged within a page of a
 * few hundred rows, and the sibling project's fractional keys exhausted double
 * precision after about fifty drags into one gap.
 */
export const PLAYLIST_POSITION_STEP = 1_024;

/** Titles YouTube gives the two playlists it creates for you. */
const SYSTEM_TITLES: Readonly<Record<Exclude<PlaylistKind, "user">, string>> = {
  watch_later: "Watch later",
  liked: "Liked videos",
};

export class PlaylistNotFoundError extends Error {
  constructor(readonly playlistId: string) {
    super(`No such playlist: ${playlistId}`);
    this.name = "PlaylistNotFoundError";
  }
}

/**
 * Raised when a move or a removal names a video the playlist does not hold.
 *
 * Distinct from {@link PlaylistNotFoundError} because the two send a caller to
 * different places: the playlist missing means the id or the owner is wrong,
 * the item missing means the client's idea of the playlist's contents is
 * stale — usually a second tab, or a drag that raced a removal.
 */
export class PlaylistItemNotFoundError extends Error {
  constructor(
    readonly playlistId: string,
    readonly videoId: string,
  ) {
    super(`Playlist ${playlistId} does not contain ${videoId}`);
    this.name = "PlaylistItemNotFoundError";
  }
}

/**
 * Raised when something tries to edit the liked playlist directly.
 *
 * Deliberately loud rather than silently forwarded to the reaction path: a
 * caller that reached for this API wanted a playlist mutation, and quietly
 * turning it into a like would also quietly change the video's like count.
 */
export class LikedPlaylistIsDerivedError extends Error {
  constructor() {
    super(
      "The liked playlist is derived from reactions. Like the video instead — " +
        "see reactions.reactToVideo.",
    );
    this.name = "LikedPlaylistIsDerivedError";
  }
}

export class SystemPlaylistIsFixedError extends Error {
  constructor(readonly kind: PlaylistKind) {
    super(`A '${kind}' playlist cannot be renamed or deleted.`);
    this.name = "SystemPlaylistIsFixedError";
  }
}

/* --------------------------------------------------------- the playlists -- */

export interface NewPlaylist {
  readonly ownerId: string;
  readonly title: string;
  readonly description?: string;
  readonly visibility?: Visibility;
}

export async function createPlaylist(
  sql: SqlExecutor,
  input: NewPlaylist,
): Promise<Playlist> {
  const id = newId("pl");
  const rows = await sql.query(
    `with created as (
       insert into playlists (id, owner_id, title, description, visibility)
       values ($1, $2, $3, $4, $5)
       returning *
     )
     ${playlistSelect("created")}`,
    [
      id,
      input.ownerId,
      input.title,
      input.description ?? "",
      input.visibility ?? "private",
    ],
  );

  const created = first(rows);
  if (!created) throw new Error(`Playlist ${id} vanished between write and read.`);
  return toPlaylist(created);
}

/**
 * Get the owner's `watch_later` or `liked` playlist, creating it if this is the
 * first time anything has needed it.
 *
 * Created lazily rather than at sign-up, because sign-up belongs to another
 * module and a rule enforced in two places is a rule enforced in neither. The
 * schema's partial unique index is what makes lazy creation safe: two requests
 * racing to create the same one produce a conflict, not a second playlist.
 *
 * One statement. `on conflict do nothing` returns no row when the playlist
 * already existed, and the `coalesce` falls through to the pre-existing row.
 *
 * ## The case the `coalesce` alone does not cover
 *
 * The comment above used to end "which the statement's own snapshot can see
 * precisely because it was not written by this statement". That is true of a
 * row that was already committed when this statement began, and false of the
 * row that *caused* the conflict when the conflict was caused by a concurrent
 * transaction. Under read-committed, `on conflict do nothing` waits for the
 * other transaction and then takes neither branch: the insert produced no row,
 * and the fallback `select` runs against a snapshot taken before the other
 * commit, so it finds nothing either. `coalesce` returns `null` and this
 * function throws — on a request that did nothing wrong, in the one situation
 * the partial unique index was supposed to make safe.
 *
 * `on conflict … do update` closes it: an update always returns its row,
 * conflict or not, and the assignment is a no-op write of the column's own
 * value so nothing about the existing playlist changes.
 *
 * The target has to be spelled out for `do update` — `do nothing` may be
 * unqualified, `do update` may not — and it is spelled as an *inference*,
 * `(owner_id, kind) where kind <> 'user'`, rather than as
 * `on constraint playlists_system_key`. `playlists_system_key` is a partial
 * unique index created with `create unique index`, and Postgres reserves
 * `ON CONSTRAINT` for table constraints; naming an index there fails with
 * "constraint … does not exist" at runtime rather than at parse time. The
 * `where` clause is not optional either: it is what selects this partial index
 * instead of leaving the inference ambiguous.
 */
export async function ensureSystemPlaylist(
  sql: SqlExecutor,
  ownerId: string,
  kind: Exclude<PlaylistKind, "user">,
): Promise<string> {
  const rows = await sql.query(
    `insert into playlists (id, owner_id, title, kind, visibility)
     values ($1, $2, $3, $4, 'private')
     on conflict (owner_id, kind) where kind <> 'user'
       do update set owner_id = playlists.owner_id
     returning id`,
    [newId("pl"), ownerId, SYSTEM_TITLES[kind], kind],
  );

  const id = nullableText(first(rows) ?? {}, "id");
  if (!id) throw new Error(`Could not resolve the ${kind} playlist for ${ownerId}.`);
  return id;
}

export async function getPlaylist(
  sql: SqlExecutor,
  id: string,
): Promise<Playlist | null> {
  const rows = await sql.query(
    `${playlistSelect("playlists")} where p.id = $1`,
    [id],
  );
  const row = first(rows);
  return row ? toPlaylist(row) : null;
}

/**
 * The owner's playlists, each with the two things its card shows: how many
 * videos, and the first one's thumbnail.
 *
 * Both as scalar subqueries rather than joins, for the same reason as the
 * channel list — a join for the count and another for the cover multiply
 * against each other, and the result looks right until a playlist has more than
 * one item.
 */
export async function listPlaylists(
  sql: SqlExecutor,
  ownerId: string | null,
): Promise<Playlist[]> {
  if (!ownerId) return [];
  const rows = await sql.query(
    `${playlistSelect("playlists")}
      where p.owner_id = $1
      order by p.updated_at desc, p.id`,
    [ownerId],
  );
  return rows.map(toPlaylist);
}

export interface PlaylistPatch {
  readonly title?: string;
  readonly description?: string;
  readonly visibility?: Visibility;
}

export async function updatePlaylist(
  db: SqlDatabase,
  id: string,
  patch: PlaylistPatch,
  outer?: SqlExecutor,
): Promise<Playlist | null> {
  return atomically(db, outer, async (tx) => {
    const kind = await playlistKind(tx, id);
    if (!kind) throw new PlaylistNotFoundError(id);
    if (kind !== "user" && patch.title !== undefined) {
      throw new SystemPlaylistIsFixedError(kind);
    }

    const rows = await tx.query(
      `with updated as (
         update playlists
            set title       = coalesce($2::text, title),
                description = coalesce($3::text, description),
                visibility  = coalesce($4::text, visibility),
                updated_at  = now()
          where id = $1
         returning *
       )
       ${playlistSelect("updated")}`,
      [
        id,
        patch.title ?? null,
        patch.description ?? null,
        patch.visibility ?? null,
      ],
    );
    const row = first(rows);
    return row ? toPlaylist(row) : null;
  });
}

export async function deletePlaylist(
  db: SqlDatabase,
  id: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const kind = await playlistKind(tx, id);
    if (!kind) return false;
    if (kind !== "user") throw new SystemPlaylistIsFixedError(kind);
    return (await tx.execute(`delete from playlists where id = $1`, [id])) > 0;
  });
}

/* ------------------------------------------------------------- the items -- */

/**
 * Add a video to a playlist the owner controls.
 *
 * Refuses the liked playlist: that one is a projection of `reactions`, and a
 * row added here would be a like nobody can un-like.
 */
export async function addVideo(
  db: SqlDatabase,
  playlistId: string,
  videoId: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const kind = await playlistKind(tx, playlistId);
    if (!kind) throw new PlaylistNotFoundError(playlistId);
    if (kind === "liked") throw new LikedPlaylistIsDerivedError();
    return appendItem(tx, playlistId, videoId);
  });
}

export async function removeVideo(
  db: SqlDatabase,
  playlistId: string,
  videoId: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const kind = await playlistKind(tx, playlistId);
    if (!kind) throw new PlaylistNotFoundError(playlistId);
    if (kind === "liked") throw new LikedPlaylistIsDerivedError();

    const removed = await tx.execute(
      `delete from playlist_items where playlist_id = $1 and video_id = $2`,
      [playlistId, videoId],
    );
    if (removed > 0) await touch(tx, playlistId);
    return removed > 0;
  });
}

/** Watch Later, resolved and appended in one transaction. */
export async function addToWatchLater(
  db: SqlDatabase,
  ownerId: string,
  videoId: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const id = await ensureSystemPlaylist(tx, ownerId, "watch_later");
    return appendItem(tx, id, videoId);
  });
}

export async function removeFromWatchLater(
  db: SqlDatabase,
  ownerId: string,
  videoId: string,
  outer?: SqlExecutor,
): Promise<boolean> {
  return atomically(db, outer, async (tx) => {
    const id = await ensureSystemPlaylist(tx, ownerId, "watch_later");
    const removed = await tx.execute(
      `delete from playlist_items where playlist_id = $1 and video_id = $2`,
      [id, videoId],
    );
    if (removed > 0) await touch(tx, id);
    return removed > 0;
  });
}

/**
 * The liked playlist's only door, and it opens from inside a transaction that
 * is already writing the reaction.
 *
 * Takes an `SqlExecutor` rather than an `SqlDatabase` on purpose: it cannot
 * open a transaction of its own, so it cannot be called except as part of one,
 * which is the whole point — a membership change that committed while the
 * reaction rolled back would be exactly the divergence this file exists to
 * prevent.
 */
export async function setLikedMembership(
  tx: SqlExecutor,
  ownerId: string,
  videoId: string,
  liked: boolean,
): Promise<void> {
  const id = await ensureSystemPlaylist(tx, ownerId, "liked");
  if (liked) {
    await appendItem(tx, id, videoId);
    return;
  }
  const removed = await tx.execute(
    `delete from playlist_items where playlist_id = $1 and video_id = $2`,
    [id, videoId],
  );
  if (removed > 0) await touch(tx, id);
}

/**
 * The playlist's videos, in the owner's order, as cards.
 *
 * Same one-statement projection as every other feed, plus the join to
 * `playlist_items` for the order. `pi.added_at` breaks a position tie so the
 * order is total — two items sharing a position (which the re-space below
 * exists to prevent, but which a bad migration could still produce) would
 * otherwise reorder themselves between two identical requests.
 */
export async function listPlaylistItems(
  sql: SqlExecutor,
  playlistId: string,
  options: { readonly viewerId?: string | null; readonly limit?: number } = {},
): Promise<VideoCard[]> {
  const rows = await sql.query(
    `select v.id, v.title, v.channel_id,
            c.name       as channel_name,
            c.handle     as channel_handle,
            c.avatar_key as channel_avatar_key,
            c.verified   as channel_verified,
            v.thumbnail_key, v.preview_key, v.duration_seconds,
            v.view_count, v.published_at, v.is_short,
            wp.position_seconds as watched_seconds
       from playlist_items pi
       join videos v on v.id = pi.video_id
       join channels c on c.id = v.channel_id
       left join watch_progress wp
         on wp.video_id = v.id and wp.user_id = $1
      where pi.playlist_id = $2
      order by pi.position, pi.added_at, v.id
      limit $3`,
    [options.viewerId ?? null, playlistId, options.limit ?? 200],
  );
  return rows.map(toCard);
}

/* ---------------------------------------------------------------- moving -- */

/**
 * Drag `videoId` to sit directly after `afterVideoId`, or to the top when that
 * is `null`.
 *
 * Expressed as "after this neighbour" rather than as an index because that is
 * what a drop actually knows, and because an index would have to be resolved
 * against a list that may have changed since the page rendered — the drag would
 * land somewhere plausible and wrong.
 *
 * Returns the position written.
 */
export async function moveVideo(
  db: SqlDatabase,
  playlistId: string,
  videoId: string,
  afterVideoId: string | null,
  outer?: SqlExecutor,
): Promise<number> {
  if (afterVideoId === videoId) {
    throw new Error("A playlist item cannot be moved after itself.");
  }

  return atomically(db, outer, async (tx) => {
    let bounds = await neighbourhood(tx, playlistId, videoId, afterVideoId);
    let position = midpoint(bounds);

    // The gap between the two neighbours has closed: there is no integer
    // strictly between them. Re-space the whole list and take the fresh
    // measurement — after which the gap is `PLAYLIST_POSITION_STEP` wide again
    // and the midpoint necessarily fits.
    if (position === null) {
      await respace(tx, playlistId);
      bounds = await neighbourhood(tx, playlistId, videoId, afterVideoId);
      position = midpoint(bounds);
      if (position === null) {
        throw new Error(
          `Re-spacing playlist ${playlistId} did not open a gap; positions are corrupt.`,
        );
      }
    }

    /**
     * `returning` rather than a bare `execute`, because the row may not be
     * there.
     *
     * `neighbourhood` reads the *anchor* — the item being moved after — and is
     * satisfied by a valid anchor whether or not the item being moved exists.
     * So moving a video that is not in this playlist computed a plausible
     * position, updated nothing, bumped the playlist's `updated_at`, and
     * returned the position as though the move had happened. The caller's
     * optimistic reorder then stuck until a reload put it back.
     */
    const moved = await tx.query(
      `update playlist_items set position = $3
        where playlist_id = $1 and video_id = $2
       returning video_id`,
      [playlistId, videoId, position],
    );
    if (moved.length === 0) {
      throw new PlaylistItemNotFoundError(playlistId, videoId);
    }

    await touch(tx, playlistId);
    return position;
  });
}

interface Neighbourhood {
  /** The anchor's position, or `null` when moving to the very top. */
  readonly lower: number | null;
  /** The next item's position, or `null` when moving to the very end. */
  readonly upper: number | null;
}

/**
 * The two positions the moved item must land between.
 *
 * One statement. The moved row is excluded from the upper bound: without that,
 * dragging an item down by one slot measures the gap against *itself* and
 * computes a midpoint it already occupies, so the drag appears to do nothing.
 */
async function neighbourhood(
  tx: SqlExecutor,
  playlistId: string,
  videoId: string,
  afterVideoId: string | null,
): Promise<Neighbourhood> {
  const rows = await tx.query(
    `with anchor as (
       select position from playlist_items
        where playlist_id = $1 and video_id = $2
     )
     select (select position from anchor) as lower,
            (select min(position) from playlist_items
              where playlist_id = $1
                and video_id <> $3
                and ($2::text is null
                     or position > (select position from anchor))) as upper`,
    [playlistId, afterVideoId, videoId],
  );

  const row = first(rows);
  const lowerRaw = row?.lower;
  const upperRaw = row?.upper;

  if (afterVideoId !== null && (lowerRaw === null || lowerRaw === undefined)) {
    throw new Error(
      `Cannot move after ${afterVideoId}: it is not in playlist ${playlistId}.`,
    );
  }

  return {
    lower: lowerRaw === null || lowerRaw === undefined ? null : Number(lowerRaw),
    upper: upperRaw === null || upperRaw === undefined ? null : Number(upperRaw),
  };
}

/**
 * The integer to write, or `null` when the neighbours are adjacent and there is
 * none.
 *
 * Moving to the top is the same arithmetic with a synthetic lower bound two
 * steps below the first item, which keeps one formula instead of a special
 * case — and lets positions go negative, which the column permits and which
 * costs nothing until roughly two million consecutive drags to the top.
 */
function midpoint({ lower, upper }: Neighbourhood): number | null {
  if (upper === null) {
    return (lower ?? 0) + PLAYLIST_POSITION_STEP;
  }
  const floor = lower ?? upper - 2 * PLAYLIST_POSITION_STEP;
  const candidate = Math.floor((floor + upper) / 2);
  return candidate > floor && candidate < upper ? candidate : null;
}

/**
 * Rewrite every position as a multiple of the step, preserving the current
 * order.
 *
 * `row_number()` over the existing order rather than a client-side loop: the
 * loop is one statement per item, and a playlist being re-spaced is exactly the
 * one that has enough items for that to matter.
 */
async function respace(tx: SqlExecutor, playlistId: string): Promise<void> {
  await tx.execute(
    `with ordered as (
       select video_id,
              row_number() over (order by position, added_at, video_id) as rn
         from playlist_items
        where playlist_id = $1
     )
     update playlist_items pi
        set position = ordered.rn * $2
       from ordered
      where pi.playlist_id = $1 and pi.video_id = ordered.video_id`,
    [playlistId, PLAYLIST_POSITION_STEP],
  );
}

/* --------------------------------------------------------------- helpers -- */

async function playlistKind(
  sql: SqlExecutor,
  id: string,
): Promise<PlaylistKind | null> {
  const rows = await sql.query(`select kind from playlists where id = $1`, [id]);
  const row = first(rows);
  if (!row) return null;
  return text(row, "kind") as PlaylistKind;
}

/** Append at the end. `on conflict do nothing`: a playlist holds a video once. */
async function appendItem(
  tx: SqlExecutor,
  playlistId: string,
  videoId: string,
): Promise<boolean> {
  const added = await tx.execute(
    `insert into playlist_items (playlist_id, video_id, position)
     select $1::text, $2::text,
            coalesce(
              (select max(position) from playlist_items where playlist_id = $1),
              0
            ) + $3::integer
     on conflict (playlist_id, video_id) do nothing`,
    [playlistId, videoId, PLAYLIST_POSITION_STEP],
  );
  if (added > 0) await touch(tx, playlistId);
  return added > 0;
}

/** The sidebar sorts by `updated_at`, so changing the items has to move it. */
async function touch(tx: SqlExecutor, playlistId: string): Promise<void> {
  await tx.execute(`update playlists set updated_at = now() where id = $1`, [
    playlistId,
  ]);
}

function playlistSelect(source: string): string {
  return `
  select p.*,
         u.display_name as owner_name,
         (select count(*) from playlist_items pi where pi.playlist_id = p.id)
           as item_count,
         (select v.thumbnail_key
            from playlist_items pi
            join videos v on v.id = pi.video_id
           where pi.playlist_id = p.id
           order by pi.position, pi.added_at, v.id
           limit 1) as thumbnail_key
    from ${source} p
    join users u on u.id = p.owner_id`;
}

function toPlaylist(row: SqlRow): Playlist {
  return {
    id: text(row, "id"),
    ownerId: text(row, "owner_id"),
    ownerName: text(row, "owner_name"),
    title: text(row, "title"),
    description: text(row, "description"),
    visibility: text(row, "visibility") as Visibility,
    kind: text(row, "kind") as PlaylistKind,
    itemCount: num(row, "item_count"),
    thumbnailKey: nullableText(row, "thumbnail_key"),
    updatedAt: timestamp(row.updated_at),
  };
}
