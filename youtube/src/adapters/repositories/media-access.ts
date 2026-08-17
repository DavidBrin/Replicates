import "server-only";

/**
 * Which video or channel a blob key belongs to — the reverse of `blobKeys`.
 *
 * The delivery routes hold a key and need a decision. `blobKeys` in
 * `ports/blob-store.ts` is the only definition of the layout, and this file is
 * that layout read backwards: `videos/{id}/…` names a video, `channels/{id}/…`
 * names a channel, and anything else names nothing this application owns.
 *
 * ## Why the parse is a whitelist rather than a split
 *
 * The obvious implementation is `key.split("/")` and a look at the first two
 * elements. It is also the one that lets `videos/../etc/passwd` through as
 * "video id `..`", because a split has no opinion about what an id may contain.
 * These keys have already passed `blobKeyFromSegments`, so a traversal cannot
 * reach here through the routes — but this function is the thing that decides
 * *who owns bytes*, and a second entry point added later would inherit the
 * weaker rule. So the id is matched against the character class the two id
 * generators actually produce (`newVideoId` is nanoid's `A-Za-z0-9_-`;
 * `newId` is `prefix_base64url`, the same class), a tail is required, and
 * everything else returns `null`.
 *
 * `null` means refused, never "no rule applied". The distinction matters
 * because the caller's fall-through on `null` is a 404, and a parse that
 * returned a partial answer for an unrecognised shape would turn that into a
 * serve.
 *
 * ## The cache, and what it costs
 *
 * `cachedSubjectForKey` exists because of one number: a player fetches a
 * segment every couple of seconds and research §1.2 puts a view at ~53
 * requests. An authorisation `select` per request would put a database round
 * trip in front of every segment of every *public* video — the case that is
 * 99% of the traffic and needs no lookup at all once it has been made once.
 *
 * Rejected: doing the lookup every time and calling it cheap. It is one
 * indexed primary-key read, so it is cheap in isolation; it is not cheap
 * multiplied by every segment of every concurrent viewer, and the deployed
 * database is Neon over HTTP rather than a socket in the same rack.
 *
 * Rejected: caching in the route handler. The decision is per *video*, not per
 * key, and a per-key cache would miss on every segment of the same video —
 * which is to say it would not be a cache.
 *
 * What the cache costs is stated exactly, because it is a security-relevant
 * cost: **an owner who makes a video private goes on being served for up to
 * one TTL.** That is why the TTL is seconds rather than minutes. The staleness
 * is asymmetric and only one direction is a security question — a video made
 * *public* that goes on 404ing for a few seconds is an availability wobble
 * that fixes itself. The window is bounded, small, and asserted in the suite
 * rather than described here.
 *
 * The upload routes deliberately do *not* use the cache. A write grant is more
 * consequential than a read and is requested once per object rather than once
 * per two seconds, so there is nothing to amortise and no reason to accept a
 * stale answer.
 */

import { database } from "@/adapters/db";
import type { SqlExecutor, SqlRow } from "@/adapters/db/driver";
import type { Visibility } from "@/domain/types";
import type { BlobKey } from "@/ports/blob-store";

import { first, text } from "./shared";

/* ============================================================== parsing == */

export type MediaKeyOwner =
  | { readonly kind: "video"; readonly videoId: string }
  | { readonly kind: "channel"; readonly channelId: string };

/**
 * `{videos|channels}/{id}/{tail}`, matching the same layout `isWritableBlobKey`
 * enforces on the way in.
 *
 * A tail is required: `videos/{id}/` on its own is a *prefix* (see
 * `blobKeys.videoPrefix`) rather than a key naming bytes, and treating one as
 * the other would answer an ownership question about a directory.
 */
const MEDIA_KEY =
  /^(videos|channels)\/([A-Za-z0-9_-]{1,64})\/([A-Za-z0-9._/-]{1,256})$/;

/** The video or channel a key belongs to, or `null` if it belongs to neither. */
export function mediaOwnerFromKey(key: BlobKey): MediaKeyOwner | null {
  const match = MEDIA_KEY.exec(key);
  if (!match) return null;

  const [, namespace, id, tail] = match;
  if (!namespace || !id || !tail) return null;

  /**
   * The pattern cannot do this part. `.` and `/` are both legal in a filename,
   * so `[A-Za-z0-9._/-]` accepts `../../etc/passwd` as happily as
   * `720p/seg-00001.m4s` — the same trap `isWritableBlobKey` documents. These
   * keys have already been through `blobKeyFromSegments` at both routes, so
   * this is the second copy rather than the only one; it is here because the
   * answer this function returns is *who owns bytes*, and a shape that names
   * one video's owner while pointing at another video's bytes must not be
   * something this can express.
   */
  for (const segment of tail.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
  }

  return namespace === "videos"
    ? { kind: "video", videoId: id }
    : { kind: "channel", channelId: id };
}

/* =========================================================== resolution == */

/**
 * A key's owner and the visibility of the thing it belongs to.
 *
 * `visibility` is on the channel branch too, fixed at `public`, so that a
 * caller has one shape to reason about rather than a union it has to narrow
 * before it can ask the only question it cares about. A channel's avatar and
 * banner are rendered on a page anyone can open; there is no channel-level
 * privacy in this schema, and inventing one here would be a rule with no
 * column behind it.
 */
export type MediaSubject =
  | {
      readonly kind: "video";
      readonly videoId: string;
      readonly channelId: string;
      readonly ownerId: string;
      readonly visibility: Visibility;
    }
  | {
      readonly kind: "channel";
      readonly channelId: string;
      readonly ownerId: string;
      readonly visibility: "public";
    };

export interface MediaAccessRepository {
  /**
   * Fresh, every time. `null` for a key that names no shape this app owns and
   * for one whose row is not there — the caller must treat both the same way,
   * which is why they are not distinguished.
   */
  subjectForKey(key: BlobKey): Promise<MediaSubject | null>;

  /** The same answer, from a short-lived process-local cache. See the header. */
  cachedSubjectForKey(key: BlobKey): Promise<MediaSubject | null>;
}

/**
 * One statement, not two. `videos.channel_id → channels.owner_id` is the whole
 * ownership chain and it is a join rather than a second read: nothing about the
 * returned subject would reveal the extra round trip, and this sits on the path
 * a player hits every couple of seconds.
 */
const VIDEO_SUBJECT = `
  select v.id as video_id, v.channel_id, v.visibility, c.owner_id
    from videos v
    join channels c on c.id = v.channel_id
   where v.id = $1`;

const CHANNEL_SUBJECT = `
  select id as channel_id, owner_id from channels where id = $1`;

export function createMediaAccessRepository(
  sql: SqlExecutor,
): MediaAccessRepository {
  const load = async (owner: MediaKeyOwner): Promise<MediaSubject | null> => {
    if (owner.kind === "video") {
      const row = first(await sql.query(VIDEO_SUBJECT, [owner.videoId]));
      if (!row) return null;
      return {
        kind: "video",
        videoId: text(row, "video_id"),
        channelId: text(row, "channel_id"),
        ownerId: text(row, "owner_id"),
        visibility: visibilityOf(row),
      };
    }

    const row = first(await sql.query(CHANNEL_SUBJECT, [owner.channelId]));
    if (!row) return null;
    return {
      kind: "channel",
      channelId: text(row, "channel_id"),
      ownerId: text(row, "owner_id"),
      visibility: "public",
    };
  };

  return {
    async subjectForKey(key) {
      const owner = mediaOwnerFromKey(key);
      return owner === null ? null : load(owner);
    },

    async cachedSubjectForKey(key) {
      const owner = mediaOwnerFromKey(key);
      // An unparseable key never reaches the cache: it costs no round trip to
      // refuse, so caching it would only be a way to fill the map with
      // whatever a scanner sent.
      return owner === null ? null : remember(owner, () => load(owner));
    },
  };
}

/**
 * The repository over the process-wide handle, for route handlers.
 *
 * A function rather than a memoised instance because `database()` is itself a
 * memoised promise — building the repository per call costs an object literal
 * and keeps the test seam (`createMediaAccessRepository(exec)`) the only way
 * anything is constructed.
 */
export async function mediaAccess(): Promise<MediaAccessRepository> {
  return createMediaAccessRepository(await database());
}

/**
 * Fail closed.
 *
 * `videos.visibility` has a `check` constraint, so a value outside the three is
 * unproducible through the database, and `videos.ts` therefore casts. This file
 * does not, because here the column is a security decision rather than a
 * display value: the failure mode of a cast is that a visibility nobody
 * recognised is "not private, therefore servable", which is precisely the
 * fall-through that has to be impossible. An unknown value denies.
 */
function visibilityOf(row: SqlRow): Visibility {
  const value = text(row, "visibility");
  return value === "public" || value === "unlisted" || value === "private"
    ? value
    : "private";
}

/* ================================================================ cache == */

/**
 * Ten seconds.
 *
 * **Assumed, not measured** — there is no production traffic to measure
 * against. The reasoning: it has to be long enough to cover the burst a player
 * makes while filling its buffer (tens of requests over a few seconds), and
 * short enough that "I made this private" is true almost immediately. Seconds
 * satisfies both; minutes would not satisfy the second.
 */
export const MEDIA_ACCESS_CACHE_TTL_MS = 10_000;

/**
 * A ceiling, so a scanner walking guessed ids cannot grow the map without
 * bound. Entries are dropped oldest-first rather than least-recently-used:
 * everything expires within {@link MEDIA_ACCESS_CACHE_TTL_MS} anyway, so
 * insertion order and recency differ by less than the lifetime of an entry,
 * and a `Map` already keeps insertion order for free.
 */
const MEDIA_ACCESS_CACHE_MAX_ENTRIES = 2048;

interface CacheEntry {
  /**
   * The in-flight promise, not the resolved value — the same trick
   * `adapters/db/index.ts` uses. A cold cache plus a player opening several
   * connections at once is a thundering herd, and memoising the value would
   * let every one of them issue its own query before the first resolved.
   */
  readonly pending: Promise<MediaSubject | null>;
  readonly expiresAt: number;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(owner: MediaKeyOwner): string {
  return owner.kind === "video"
    ? `video:${owner.videoId}`
    : `channel:${owner.channelId}`;
}

function remember(
  owner: MediaKeyOwner,
  load: () => Promise<MediaSubject | null>,
): Promise<MediaSubject | null> {
  const key = cacheKey(owner);
  const hit = cache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.pending;

  const pending = load();
  const entry: CacheEntry = {
    pending,
    expiresAt: Date.now() + MEDIA_ACCESS_CACHE_TTL_MS,
  };
  cache.set(key, entry);

  /**
   * A rejection must not occupy the slot for the rest of the window: the next
   * request should retry rather than inherit a connection error. The identity
   * check keeps this from evicting a *newer* entry that replaced this one in
   * the meantime.
   *
   * Attaching the handler also marks the promise handled, so a caller that
   * gives up before awaiting cannot produce an unhandled rejection.
   */
  pending.catch(() => {
    if (cache.get(key) === entry) cache.delete(key);
  });

  if (cache.size > MEDIA_ACCESS_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  return pending;
}

/**
 * Tests only, and the suites that share a process need it: the cache outlives
 * `truncate`, so a fixture rebuilt between tests would otherwise be answered
 * from the previous test's rows.
 */
export function resetMediaAccessCacheForTests(): void {
  cache.clear();
}
