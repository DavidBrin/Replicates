import "server-only";

import { nanoid } from "nanoid";

import type { SqlExecutor, SqlRow, SqlValue } from "@/adapters/db/driver";
import type {
  Pipeline,
  Rendition,
  UploadStatus,
  Video,
  VideoCard,
  Visibility,
} from "@/domain/types";

import {
  bool,
  first,
  json,
  nullableNum,
  nullableText,
  nullableTimestamp,
  num,
  placeholders,
  text,
  timestamp,
} from "./shared";

/**
 * Videos: the record, its ladder, and every feed that lists them.
 *
 * The feeds are the reason this file is shaped the way it is. A `VideoCard`
 * carries its channel's name, handle and avatar, plus the viewer's own watch
 * position — four values that live in two other tables — and the home grid
 * renders forty cards at once. Fetched naïvely that is eighty-one round trips
 * for one page, and the output is byte-for-byte identical to the single joined
 * query, so nothing about the result reveals the mistake. Hence
 * {@link CARD_SELECT}: one statement, one plan, every feed.
 */

/* ---------------------------------------------------------------- shorts -- */

/**
 * A Short is at most three minutes.
 *
 * **Sourced, not guessed.** YouTube raised the Shorts limit from 60 seconds to
 * 3 minutes on 15 October 2024 (announced on the YouTube blog and documented in
 * the "Create a YouTube Short" help article); videos uploaded before that date
 * keep the old 60-second boundary, but nothing uploaded here predates it.
 *
 * Sixty is the number most implementations still use, and picking it would have
 * made every 90-second vertical upload silently a regular video — visible only
 * as an oddly empty Shorts feed.
 */
export const SHORT_MAX_DURATION_SECONDS = 180;

/**
 * A Short is square or taller: `width / height <= 1`.
 *
 * YouTube's help article says "vertical or square", which is this inequality
 * and not the 9:16 exactly that a stricter reading suggests — a 1:1 upload is
 * eligible, and a 4:5 one is too.
 */
export const SHORT_MAX_ASPECT_RATIO = 1;

/**
 * Derived once, at publish, rather than computed per query.
 *
 * Zero dimensions mean the uploader's browser never reported any — the
 * progressive fallback path can end up here — and an unknown shape is not a
 * Short. Guessing vertical from a missing number would put arbitrary videos in
 * a feed that plays them full-bleed.
 */
export function isShortVideo(input: {
  width: number;
  height: number;
  durationSeconds: number;
}): boolean {
  if (input.width <= 0 || input.height <= 0) return false;
  return (
    input.width / input.height <= SHORT_MAX_ASPECT_RATIO &&
    input.durationSeconds > 0 &&
    input.durationSeconds <= SHORT_MAX_DURATION_SECONDS
  );
}

/**
 * The same rule as {@link isShortVideo}, in SQL, so that publishing is one
 * statement and the flag cannot be written from a row the caller read earlier.
 * The two are asserted equivalent in the suite; a second expression of one rule
 * is only safe while something checks that it agrees.
 */
const IS_SHORT_SQL = `(
  v.width > 0 and v.height > 0
  and v.width::double precision / v.height <= ${SHORT_MAX_ASPECT_RATIO}
  and v.duration_seconds > 0
  and v.duration_seconds <= ${SHORT_MAX_DURATION_SECONDS}
)`;

/* ------------------------------------------------------------ projection -- */

/**
 * Every card query is this select with a different `where`.
 *
 * `$1` is always the viewer, and always first, so the fragment can be shared —
 * callers number their own parameters from `$2`. A signed-out viewer passes
 * `null`, which the join simply never matches, so there is one query shape
 * rather than two and no branch that could diverge.
 *
 * `left join watch_progress`, not a subselect: the subselect form is a second
 * index probe per row that the planner is free to leave as one, and "free to"
 * is not a guarantee worth a feed.
 */
const CARD_SELECT = `
  select v.id,
         v.title,
         v.channel_id,
         c.name       as channel_name,
         c.handle     as channel_handle,
         c.avatar_key as channel_avatar_key,
         c.verified   as channel_verified,
         v.thumbnail_key,
         v.preview_key,
         v.duration_seconds,
         v.view_count,
         v.published_at,
         v.is_short,
         wp.position_seconds as watched_seconds
    from videos v
    join channels c on c.id = v.channel_id
    left join watch_progress wp
      on wp.video_id = v.id and wp.user_id = $1`;

/** Published and visible to everyone — what every public feed means by "a video". */
const PUBLIC_AND_READY = `
  v.visibility = 'public'
  and v.upload_status = 'ready'
  and v.published_at is not null`;

/**
 * The full record, with its tags folded in by an aggregate rather than a second
 * query. Tags are a handful of short strings per video; `array_agg` returns
 * them as a JS array through both drivers, so the join costs one sort and saves
 * a round trip on the watch page's critical path.
 */
function videoSelect(source: string): string {
  return `
  select v.*,
         c.name       as channel_name,
         c.handle     as channel_handle,
         c.avatar_key as channel_avatar_key,
         coalesce(
           (select array_agg(t.tag order by t.tag)
              from video_tags t where t.video_id = v.id),
           '{}'
         ) as tags
    from ${source} v
    join channels c on c.id = v.channel_id`;
}

/* -------------------------------------------------------------- commands -- */

export interface NewVideo {
  readonly channelId: string;
  readonly title: string;
  readonly description?: string;
  readonly visibility?: Visibility;
  readonly pipeline?: Pipeline;
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly category?: string;
  readonly tags?: readonly string[];
}

/**
 * A video id is eleven URL-safe characters because that is what sits in
 * `/watch?v=` — the schema header makes the same point about the column. nanoid
 * 's default alphabet is `A-Za-z0-9_-`, the same class YouTube's ids use, so
 * the ids this generates are indistinguishable in shape from real ones.
 */
export function newVideoId(): string {
  return nanoid(11);
}

/**
 * Create the row. It starts `uploading`: a video exists here long before it is
 * playable, and may never become playable at all.
 */
export async function createVideo(
  sql: SqlExecutor,
  input: NewVideo & { readonly id?: string },
): Promise<Video> {
  const id = input.id ?? newVideoId();

  const rows = await sql.query(
    `with inserted as (
       insert into videos (id, channel_id, title, description, visibility,
                           pipeline, duration_seconds, width, height, category)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       returning *
     )
     ${videoSelect("inserted")}`,
    [
      id,
      input.channelId,
      input.title,
      input.description ?? "",
      input.visibility ?? "public",
      input.pipeline ?? "laddered",
      input.durationSeconds ?? 0,
      input.width ?? 0,
      input.height ?? 0,
      input.category ?? "People & Blogs",
    ],
  );

  const created = first(rows);
  if (!created) throw new Error(`Video ${id} vanished between insert and read.`);

  if (input.tags && input.tags.length > 0) {
    await setTags(sql, id, input.tags);
    return { ...toVideo(created), tags: [...new Set(input.tags)].sort() };
  }
  return toVideo(created);
}

export interface VideoPatch {
  readonly title?: string;
  readonly description?: string;
  readonly visibility?: Visibility;
  readonly uploadStatus?: UploadStatus;
  readonly pipeline?: Pipeline;
  readonly durationSeconds?: number;
  readonly width?: number;
  readonly height?: number;
  readonly category?: string;
  readonly commentsEnabled?: boolean;
  readonly thumbnailKey?: string | null;
  readonly previewKey?: string | null;
  readonly masterPlaylistKey?: string | null;
  readonly progressiveKey?: string | null;
  /**
   * The credit for licensed source material. Patchable rather than
   * create-only because the obligation attaches to the *published* video: a
   * `pnpm seed:demo` import and an uploader who picks a Creative Commons licence
   * in the upload form both know it before publish and neither knows it at the
   * moment the row is created.
   */
  readonly attribution?: string | null;
  readonly licence?: string | null;
  readonly licenceUrl?: string | null;
}

const PATCHABLE: Readonly<Record<keyof VideoPatch, string>> = {
  title: "title",
  description: "description",
  visibility: "visibility",
  uploadStatus: "upload_status",
  pipeline: "pipeline",
  durationSeconds: "duration_seconds",
  width: "width",
  height: "height",
  category: "category",
  commentsEnabled: "comments_enabled",
  thumbnailKey: "thumbnail_key",
  previewKey: "preview_key",
  masterPlaylistKey: "master_playlist_key",
  progressiveKey: "progressive_key",
  attribution: "attribution",
  licence: "licence",
  licenceUrl: "licence_url",
};

/**
 * Patch what was named and nothing else.
 *
 * The column list is a fixed map rather than the patch's own keys, so a caller
 * cannot name a column — `{ view_count: 1e9 }` reaching this function updates
 * nothing rather than updating that.
 */
export async function updateVideo(
  sql: SqlExecutor,
  id: string,
  patch: VideoPatch,
): Promise<Video | null> {
  const assignments: string[] = [];
  const params: SqlValue[] = [id];

  for (const [key, column] of Object.entries(PATCHABLE)) {
    const value = patch[key as keyof VideoPatch];
    if (value === undefined) continue;
    params.push(value as SqlValue);
    assignments.push(`${column} = $${params.length}`);
  }

  if (assignments.length === 0) return getVideo(sql, id);

  const rows = await sql.query(
    `with updated as (
       update videos set ${assignments.join(", ")} where id = $1 returning *
     )
     ${videoSelect("updated")}`,
    params,
  );
  const row = first(rows);
  return row ? toVideo(row) : null;
}

/**
 * Publish: flip the status, stamp the date, and settle whether this is a Short.
 *
 * `coalesce(published_at, now())` because re-publishing a video that was made
 * private and then public again must not move it to the top of every feed — the
 * publish date is a property of the video, not of the last time somebody
 * touched its visibility.
 *
 * `is_short` is derived here, in the same statement, from the row's own width,
 * height and duration. Deriving it from values the caller passed in would let a
 * caller that read the row a moment ago write a flag that contradicts it.
 */
export async function publishVideo(
  sql: SqlExecutor,
  id: string,
): Promise<Video | null> {
  const rows = await sql.query(
    `with updated as (
       update videos as v
          set upload_status = 'ready',
              published_at = coalesce(v.published_at, now()),
              is_short = ${IS_SHORT_SQL}
        where v.id = $1
       returning v.*
     )
     ${videoSelect("updated")}`,
    [id],
  );
  const row = first(rows);
  return row ? toVideo(row) : null;
}

/** Replace the tag set. Tags are a set, so a repeat in the input is not two rows. */
export async function setTags(
  sql: SqlExecutor,
  videoId: string,
  tags: readonly string[],
): Promise<void> {
  await sql.execute(`delete from video_tags where video_id = $1`, [videoId]);

  const unique = [...new Set(tags.map((t) => t.trim()).filter(Boolean))];
  if (unique.length === 0) return;

  const values = unique.map((_, i) => `($1, $${i + 2})`).join(", ");
  await sql.execute(
    `insert into video_tags (video_id, tag) values ${values}
     on conflict do nothing`,
    [videoId, ...unique],
  );
}

/**
 * Replace the ladder wholesale.
 *
 * Wholesale rather than per-rung: a transcode either produced a ladder or it
 * did not, and a half-updated ladder — new 1080p rung beside a stale 720p one
 * from the previous attempt — is a master playlist that plays for some viewers
 * and stalls for others.
 */
export async function replaceRenditions(
  sql: SqlExecutor,
  videoId: string,
  renditions: readonly Rendition[],
): Promise<void> {
  await sql.execute(`delete from video_renditions where video_id = $1`, [
    videoId,
  ]);
  if (renditions.length === 0) return;

  const params: SqlValue[] = [videoId];
  const tuples = renditions.map((r) => {
    const start = params.length;
    params.push(
      r.name,
      r.width,
      r.height,
      r.bandwidth,
      r.codec,
      r.frameRate,
      r.initKey,
      r.playlistKey,
      r.segmentCount,
      r.totalBytes,
    );
    return `($1, ${Array.from({ length: 10 }, (_, i) => `$${start + i + 1}`).join(", ")})`;
  });

  await sql.execute(
    `insert into video_renditions
       (video_id, name, width, height, bandwidth, codec, frame_rate,
        init_key, playlist_key, segment_count, total_bytes)
     values ${tuples.join(", ")}`,
    params,
  );
}

/**
 * How long a video actually is, according to the database.
 *
 * One column, because the caller is `POST /api/watch` and the answer decides
 * whether a public counter moves. That route used to take the duration from the
 * request body — the reporter knows it, so sending it looked natural — and the
 * consequence is a two-line exploit:
 *
 * ```
 * POST /api/watch {"videoId":"…","watchedSeconds":0.5,"durationSeconds":1}
 * ```
 *
 * `viewThresholdSeconds(1)` is 0.5, so half a second of claimed viewing counts
 * as a view of a ten-minute video, and the "cap the claim at the video's own
 * length" guard capped it at the length the attacker had just supplied. Both
 * halves of the defence were reading the attacker's number.
 *
 * `null` for a video that is not there, which the caller has already ruled out
 * via `authorizeVideoAccess` — it is returned rather than thrown so the two
 * absences are handled by the same branch.
 */
export async function videoDurationSeconds(
  sql: SqlExecutor,
  id: string,
): Promise<number | null> {
  const row = first(
    await sql.query(`select duration_seconds from videos where id = $1`, [id]),
  );
  return row === undefined ? null : num(row, "duration_seconds");
}

/** Bump the denormalised counter the feeds sort and display. */
export async function recordView(
  sql: SqlExecutor,
  videoId: string,
): Promise<void> {
  await sql.execute(
    `update videos set view_count = view_count + 1 where id = $1`,
    [videoId],
  );
}

export async function deleteVideo(
  sql: SqlExecutor,
  id: string,
): Promise<boolean> {
  return (await sql.execute(`delete from videos where id = $1`, [id])) > 0;
}

/* --------------------------------------------------------------- fixtures -- */

/**
 * Facts about a video's past that no write path can produce.
 *
 * Every other function in this file holds an invariant. This one holds none,
 * and that is deliberate: `published_at`, `view_count`, `like_count` and
 * `dislike_count` are not rules, they are *history*, and every write path here
 * is built for an application that accumulates history one event at a time.
 * `publishVideo` writes `now()`, so a corpus published through it is a library
 * where every video went up in the same second and every card reads "0 seconds
 * ago". `recordView` increments by one, so the 1.2 million views the most
 * popular video in a power-law corpus should have is 1.2 million statements.
 *
 * So a seed script has to state them, and before this existed the only way was
 * raw SQL — which meant a script reaching around the repositories and writing
 * columns nothing else in `src/` knew how to write.
 */
export interface VideoFixtureFacts {
  /** `null` un-publishes. Absent leaves whatever is there. */
  readonly publishedAt?: Date | null;
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly dislikeCount?: number;
}

/**
 * Write those facts directly. **For fixtures and corpora, never for a request.**
 *
 * The name is the guard rail, because nothing else can be: there is no type the
 * compiler could give this that a route handler could not also satisfy. What
 * makes it safe to have is that it is obviously the wrong tool at a call site —
 * a request path that wants a view counted calls {@link recordView}, and one
 * that wants a video published calls {@link publishVideo}, and either of those
 * reaching for `stampVideoFixtureFacts` would be visible in review as a
 * sentence that does not make sense.
 *
 * What it is *not* for, specifically:
 *
 *   - counting a view. `recordView` is one statement and is the only thing that
 *     should ever move `view_count` in response to somebody watching something;
 *   - recording a like. `reactions` is the table that knows *who* liked a video,
 *     and `like_count` is its denormalised total — setting the total without the
 *     row produces a lit like button that corresponds to nothing, or a count
 *     lower than the number of people who can see their own like on it. A seed
 *     that writes both should write the rows through the reactions repository
 *     and use this only for the anonymous surplus;
 *   - publishing. `publishVideo` also derives `is_short` and flips
 *     `upload_status`, and a fixture that set `published_at` alone would produce
 *     a video no feed can find.
 */
export async function stampVideoFixtureFacts(
  sql: SqlExecutor,
  id: string,
  facts: VideoFixtureFacts,
): Promise<Video | null> {
  const params: SqlValue[] = [id];
  const assignments: string[] = [];
  const set = (clause: (placeholder: string) => string, value: SqlValue): void => {
    params.push(value);
    assignments.push(clause(`$${params.length}`));
  };

  if (facts.publishedAt !== undefined) {
    // `::timestamptz` explicitly rather than relying on the assignment target to
    // type the parameter, so that a `null` — which carries no type at all — is
    // still unambiguous to the planner on both engines.
    set(
      (p) => `published_at = ${p}::timestamptz`,
      facts.publishedAt === null ? null : facts.publishedAt.toISOString(),
    );
  }
  if (facts.viewCount !== undefined) {
    set((p) => `view_count = ${p}`, wholeCount(facts.viewCount, "viewCount"));
  }
  if (facts.likeCount !== undefined) {
    set((p) => `like_count = ${p}`, wholeCount(facts.likeCount, "likeCount"));
  }
  if (facts.dislikeCount !== undefined) {
    set(
      (p) => `dislike_count = ${p}`,
      wholeCount(facts.dislikeCount, "dislikeCount"),
    );
  }

  if (assignments.length === 0) return getVideo(sql, id);

  const rows = await sql.query(
    `with updated as (
       update videos set ${assignments.join(", ")} where id = $1 returning *
     )
     ${videoSelect("updated")}`,
    params,
  );
  const row = first(rows);
  return row ? toVideo(row) : null;
}

/**
 * A count, or a `TypeError` naming the field.
 *
 * These columns are `bigint`. A fractional or negative number reaches Postgres
 * as an error from three layers down that names a type rather than a fixture,
 * and a corpus generator producing `1.2e6 * 0.317` fractionally is exactly the
 * kind of thing that happens once.
 */
export function wholeCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(
      `${field} must be a non-negative whole number, got ${String(value)}`,
    );
  }
  return value;
}

/* ----------------------------------------------------------------- reads -- */

export async function getVideo(
  sql: SqlExecutor,
  id: string,
): Promise<Video | null> {
  const rows = await sql.query(`${videoSelect("videos")} where v.id = $1`, [id]);
  const row = first(rows);
  return row ? toVideo(row) : null;
}

/**
 * The watch page's load: the video and the ladder its player will choose from.
 *
 * Two statements, deliberately. Folding the renditions into the first with
 * `json_agg` would make it one, at the cost of a JSON round-trip whose parsed
 * shape differs between the two drivers — and two is already a bounded number.
 * The rule this file is defending is "not one query per row", not "one query".
 */
export async function getVideoWithRenditions(
  sql: SqlExecutor,
  id: string,
): Promise<{ video: Video; renditions: Rendition[] } | null> {
  const video = await getVideo(sql, id);
  if (!video) return null;
  return { video, renditions: await listRenditions(sql, id) };
}

export async function listRenditions(
  sql: SqlExecutor,
  videoId: string,
): Promise<Rendition[]> {
  const rows = await sql.query(
    `select name, width, height, bandwidth, codec, frame_rate,
            init_key, playlist_key, segment_count, total_bytes
       from video_renditions
      where video_id = $1
      order by height desc, bandwidth desc, name`,
    [videoId],
  );
  return rows.map(toRendition);
}

export interface FeedOptions {
  /** `null` for a signed-out viewer, whose cards carry no watch position. */
  readonly viewerId?: string | null;
  readonly limit?: number;
  readonly offset?: number;
}

const DEFAULT_FEED_LIMIT = 40;

/**
 * The home grid.
 *
 * Shorts are excluded: they have their own shelf, with its own aspect ratio and
 * its own player, and a vertical video in the sixteen-by-nine grid is letterboxed
 * to about a third of the tile. Filtering here rather than in the component
 * keeps the grid's page size honest — filtering after the fetch would return
 * forty rows and render twenty-eight.
 */
export async function listHomeFeed(
  sql: SqlExecutor,
  options: FeedOptions = {},
): Promise<VideoCard[]> {
  const { viewerId = null, limit = DEFAULT_FEED_LIMIT, offset = 0 } = options;
  const rows = await sql.query(
    `${CARD_SELECT}
      where ${PUBLIC_AND_READY} and not v.is_short
      order by v.published_at desc, v.id desc
      limit $2 offset $3`,
    [viewerId, limit, offset],
  );
  return rows.map(toCard);
}

/** The Shorts feed — the same rows the grid drops, in the same one query. */
export async function listShortsFeed(
  sql: SqlExecutor,
  options: FeedOptions = {},
): Promise<VideoCard[]> {
  const { viewerId = null, limit = DEFAULT_FEED_LIMIT, offset = 0 } = options;
  const rows = await sql.query(
    `${CARD_SELECT}
      where ${PUBLIC_AND_READY} and v.is_short
      order by v.published_at desc, v.id desc
      limit $2 offset $3`,
    [viewerId, limit, offset],
  );
  return rows.map(toCard);
}

export interface ChannelVideoOptions extends FeedOptions {
  /**
   * The owner's own view of their channel, which includes drafts, failures and
   * private videos. Off by default: a repository whose default is "show
   * everything" leaks the first time a caller forgets an argument.
   */
  readonly includeUnlisted?: boolean;
  readonly sort?: "newest" | "popular" | "oldest";
}

export async function listChannelVideos(
  sql: SqlExecutor,
  channelId: string,
  options: ChannelVideoOptions = {},
): Promise<VideoCard[]> {
  const {
    viewerId = null,
    limit = DEFAULT_FEED_LIMIT,
    offset = 0,
    includeUnlisted = false,
    sort = "newest",
  } = options;

  const visibility = includeUnlisted
    ? `v.channel_id = $2`
    : `v.channel_id = $2 and ${PUBLIC_AND_READY}`;

  // Each of these ends in `id`, matching `videos_channel_idx` exactly. The
  // tiebreaker is not cosmetic: PGlite's `now()` resolves to milliseconds where
  // real Postgres resolves to microseconds, so `published_at desc` alone is a
  // total order on Neon and an arbitrary one locally — the direction of
  // asymmetry that gets diagnosed as a flaky test and fixed by weakening the
  // assertion. `oldest` is the same index read backwards, so its tiebreaker
  // runs the other way too.
  const order =
    sort === "popular"
      ? "v.view_count desc, v.published_at desc, v.id desc"
      : sort === "oldest"
        ? "v.published_at asc, v.id asc"
        : "v.published_at desc, v.id desc";

  const rows = await sql.query(
    `${CARD_SELECT}
      where ${visibility}
      order by ${order}
      limit $3 offset $4`,
    [viewerId, channelId, limit, offset],
  );
  return rows.map(toCard);
}

/**
 * Cards for an explicit list of ids, in one query, order preserved.
 *
 * This is what the recommender and the search index need: they produce ids and
 * nothing else, and without this they would each fetch cards one at a time. The
 * `array_position` order is what keeps their ranking — `where id = any(...)`
 * returns rows in whatever order the plan finds them, which for a ranked list
 * is a silent scramble.
 */
export async function listCardsByIds(
  sql: SqlExecutor,
  ids: readonly string[],
  options: { readonly viewerId?: string | null } = {},
): Promise<VideoCard[]> {
  if (ids.length === 0) return [];

  const bound = placeholders(ids.length, 2);
  const rows = await sql.query(
    `${CARD_SELECT}
      where v.id in (${bound})
      order by array_position(array[${bound}]::text[], v.id)`,
    [options.viewerId ?? null, ...ids],
  );
  return rows.map(toCard);
}

/* --------------------------------------------------------------- mapping -- */

/**
 * Rows become domain values through `shared.ts` and nowhere else.
 *
 * The coercions are not decoration. A `bigint` column is a number under PGlite
 * and a decimal *string* under Neon — node-postgres will not parse `int8` into a
 * double it cannot promise to round-trip — so `row.view_count` used directly
 * works locally and sorts `"10" < "9"` in production. And `shared.num` throws
 * rather than coercing, which is the property that matters in a schema this
 * full of counts: `Number(null)` is `0`, so a mistyped alias would otherwise
 * arrive as a plausible zero that nobody questions.
 */

/**
 * Exported because every other repository in this slice returns cards too.
 *
 * Which makes the column list a contract rather than a local detail: `history`,
 * `playlists`, `recommendations` and `subscriptions` each write their own select
 * and hand the rows here. `shared.bool` reports a *missing* column as `false`
 * rather than throwing — it cannot do otherwise, since `false` is a legitimate
 * value that arrives as `'f'`, `0` and `false` depending on the driver — so a
 * select that omits `channel_verified` produces cards that are silently
 * unverified rather than an error. Any select feeding this function needs
 * `c.verified as channel_verified` in it.
 */
export function toCard(row: SqlRow): VideoCard {
  return {
    id: text(row, "id"),
    title: text(row, "title"),
    channelId: text(row, "channel_id"),
    channelName: text(row, "channel_name"),
    channelHandle: text(row, "channel_handle"),
    channelAvatarKey: nullableText(row, "channel_avatar_key"),
    channelVerified: bool(row, "channel_verified"),
    thumbnailKey: nullableText(row, "thumbnail_key"),
    previewKey: nullableText(row, "preview_key"),
    durationSeconds: num(row, "duration_seconds"),
    viewCount: num(row, "view_count"),
    publishedAt: nullableTimestamp(row.published_at),
    isShort: bool(row, "is_short"),
    // `null`, not `0`: never started and started-then-seeked-back-to-zero are
    // different states, and only one of them draws the red bar.
    watchedSeconds: nullableNum(row, "watched_seconds"),
  };
}

export function toVideo(row: SqlRow): Video {
  return {
    id: text(row, "id"),
    channelId: text(row, "channel_id"),
    channelName: text(row, "channel_name"),
    channelHandle: text(row, "channel_handle"),
    channelAvatarKey: nullableText(row, "channel_avatar_key"),
    title: text(row, "title"),
    description: text(row, "description"),
    visibility: text(row, "visibility") as Visibility,
    uploadStatus: text(row, "upload_status") as UploadStatus,
    pipeline: text(row, "pipeline") as Pipeline,
    durationSeconds: num(row, "duration_seconds"),
    width: num(row, "width"),
    height: num(row, "height"),
    isShort: bool(row, "is_short"),
    masterPlaylistKey: nullableText(row, "master_playlist_key"),
    progressiveKey: nullableText(row, "progressive_key"),
    thumbnailKey: nullableText(row, "thumbnail_key"),
    previewKey: nullableText(row, "preview_key"),
    viewCount: num(row, "view_count"),
    likeCount: num(row, "like_count"),
    dislikeCount: num(row, "dislike_count"),
    commentCount: num(row, "comment_count"),
    commentsEnabled: bool(row, "comments_enabled"),
    category: text(row, "category"),
    // `array_agg` comes back as a JS array from both drivers; `json` is here for
    // the empty case, where the coalesced `'{}'` can arrive as a string.
    tags: json<string[]>(row.tags, []).map(String),
    attribution: nullableText(row, "attribution"),
    licence: nullableText(row, "licence"),
    licenceUrl: nullableText(row, "licence_url"),
    publishedAt: nullableTimestamp(row.published_at),
    createdAt: timestamp(row.created_at),
  };
}

function toRendition(row: SqlRow): Rendition {
  return {
    name: text(row, "name"),
    width: num(row, "width"),
    height: num(row, "height"),
    bandwidth: num(row, "bandwidth"),
    codec: text(row, "codec"),
    frameRate: num(row, "frame_rate"),
    initKey: text(row, "init_key"),
    playlistKey: text(row, "playlist_key"),
    segmentCount: num(row, "segment_count"),
    totalBytes: num(row, "total_bytes"),
  };
}
