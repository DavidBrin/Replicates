import "server-only";

import type { SqlDatabase } from "./driver";

/**
 * The corpus the end-to-end suite runs against.
 *
 * ## Why this exists at all
 *
 * `SEED_DEMO_DATA` has been in `config/env.ts` since the configuration was
 * written, is set to `"true"` by `playwright.config.ts`, and — until this file
 * — was read by nothing. The e2e database is `DB_DATA_DIR: ":memory:"`, so it
 * booted completely empty while the config's own comments described "one
 * shared library" that specs would subscribe to, comment on and get
 * recommendations from. Every spec written against that description would have
 * found zero rows, and the natural diagnosis — "the query is wrong" — would
 * have sent someone into the repositories rather than here.
 *
 * ## Why it is metadata only
 *
 * `pnpm seed` produces the media by driving headless Chromium through the real
 * WebCodecs encode path, which cannot run inside `next start`. So this seeds
 * everything *except* the bytes: channels, videos, renditions, comments,
 * subscriptions, playlists and enough watch history for the co-visitation
 * graph to have opinions. Specs that need real playback run against the tree
 * `pnpm seed` leaves in `.data/blobs`; specs about navigation, search,
 * channels, the recommender and the no-WebCodecs *upload* path do not need a
 * decoded frame and are the great majority.
 *
 * A video whose segments are absent is a legitimate state to test against, not
 * a broken fixture — it is exactly what a video mid-upload looks like, and the
 * player's error path is a surface worth having a spec for.
 *
 * ## Determinism
 *
 * Every id, timestamp and count is a literal. Nothing here calls `Date.now()`,
 * `Math.random()` or `nanoid()`, because a fixture that varies between runs
 * turns an ordering assertion into a flake, and the recommender's output is an
 * ordering assertion. The publish dates are spread across fixed days so
 * "newest first" has a defined answer.
 */

/**
 * The password every seeded account shares.
 *
 * Exported so the e2e suite signs in through the real form rather than
 * fabricating a session cookie — a fabricated cookie tests the cookie parser
 * and skips everything the sign-in route does.
 */
export const E2E_PASSWORD = "e2e-password";

/** Deterministic ids. The prefixes match what the repositories mint. */
const USERS = {
  ada: "usr_e2e_ada",
  grace: "usr_e2e_grace",
  viewer: "usr_e2e_viewer",
} as const;

const CHANNELS = {
  fieldnotes: "ch_e2e_fieldnotes",
  patchbay: "ch_e2e_patchbay",
} as const;

/**
 * Long-form first, then two Shorts. `is_short` is derived by `publishVideo`
 * from the dimensions and duration in production, so the fixtures carry
 * dimensions that agree with the flag rather than setting it in isolation.
 */
const VIDEOS = [
  {
    id: "vid_e2e_0001",
    channel: CHANNELS.fieldnotes,
    title: "Reading a river",
    description: "Where the current goes when the surface is still.",
    seconds: 612,
    width: 1920,
    height: 1080,
    short: false,
    views: 128_400,
    likes: 9_120,
    dislikes: 140,
    publishedAt: "2026-01-04T09:00:00Z",
  },
  {
    id: "vid_e2e_0002",
    channel: CHANNELS.fieldnotes,
    title: "The quietest hour",
    description: "Four microphones, one field, no wind.",
    seconds: 448,
    width: 1920,
    height: 1080,
    short: false,
    views: 41_050,
    likes: 3_880,
    dislikes: 61,
    publishedAt: "2026-01-11T09:00:00Z",
  },
  {
    id: "vid_e2e_0003",
    channel: CHANNELS.patchbay,
    title: "Every cable in the rack",
    description: "A signal path, traced end to end.",
    seconds: 1_204,
    width: 1920,
    height: 1080,
    short: false,
    views: 903_000,
    likes: 58_400,
    dislikes: 900,
    publishedAt: "2026-01-18T09:00:00Z",
  },
  {
    id: "vid_e2e_0004",
    channel: CHANNELS.patchbay,
    title: "Solder joint, close up",
    description: "Thirty seconds, one joint.",
    seconds: 31,
    width: 1080,
    height: 1920,
    short: true,
    views: 2_400_000,
    likes: 190_000,
    dislikes: 2_100,
    publishedAt: "2026-01-20T09:00:00Z",
  },
  {
    id: "vid_e2e_0005",
    channel: CHANNELS.fieldnotes,
    title: "Frost, at speed",
    description: "One morning, sixty times faster.",
    seconds: 27,
    width: 1080,
    height: 1920,
    short: true,
    views: 812_000,
    likes: 74_500,
    dislikes: 640,
    publishedAt: "2026-01-22T09:00:00Z",
  },
] as const;

/**
 * Two caption tracks on the first video. See the insert for why two.
 *
 * The labels are what the CC menu renders, so `(auto-generated)` is part of the
 * data rather than something a component appends — only the caller knows which
 * language it is naming the track *in*, which is why `captions.label` is a
 * column and not a derivation.
 */
const CAPTIONS = [
  {
    id: "cap_e2e_en_uploaded",
    language: "en",
    label: "English",
    source: "uploaded",
    isDefault: true,
  },
  {
    id: "cap_e2e_en_automatic",
    language: "en",
    label: "English (auto-generated)",
    source: "automatic",
    isDefault: false,
  },
] as const;

/** The ladder every long-form fixture carries. Shorts get the bottom two. */
const LADDER = [
  { id: "360p", height: 360, width: 640, bitrate: 800_000 },
  { id: "720p", height: 720, width: 1280, bitrate: 2_800_000 },
  { id: "1080p", height: 1080, width: 1920, bitrate: 5_000_000 },
] as const;

/**
 * Whether this database has already been populated.
 *
 * Checked rather than assumed, because `database()` is memoised per process
 * but a persistent `DB_DATA_DIR` survives restarts — running `pnpm dev` with
 * `SEED_DEMO_DATA=true` twice must not double every count.
 */
async function alreadySeeded(db: SqlDatabase): Promise<boolean> {
  const rows = await db.query<{ present: boolean }>(
    "select exists (select 1 from videos where id = $1) as present",
    [VIDEOS[0].id],
  );
  return rows[0]?.present === true;
}

export async function seedDemoData(db: SqlDatabase): Promise<void> {
  if (await alreadySeeded(db)) return;

  await db.transaction(async (tx) => {
    /**
     * A literal rather than a derivation at boot.
     *
     * `hashPassword` is deliberately expensive — 128 MB and ~200ms per call by
     * design — and three of those on every `next start` is a quarter of a
     * second of the suite's startup spent recomputing a constant.
     *
     * This is the real encoding of {@link E2E_PASSWORD}, produced by that same
     * function and checked in both directions before being pasted here, so the
     * sign-in path is exercised for real rather than stubbed. A previous
     * version of this file carried an *invented* string that merely looked
     * like one; it would have made every sign-in fail with "wrong password"
     * against a fixture that claimed to work, which is a worse failure than no
     * fixture at all. `src/lib/auth/__tests__/session.test.ts` covers the
     * verifier itself.
     */
    const password =
      "scrypt$131072$8$1$64$BIv52Pwo2u/DDxsExSgV3w==$" +
      "S8RuuGLS/6UNP9ldBRR/JzKxexFA3iNwRrmlDMICCxJic0mPIIJLxcOqhRJxLhaMHUebCZDa5A6KnXWq/rXmfw==";

    for (const [handle, id] of Object.entries(USERS)) {
      await tx.execute(
        `insert into users (id, email, display_name, password_hash, created_at)
         values ($1, $2, $3, $4, $5::timestamptz)
         on conflict (id) do nothing`,
        [
          id,
          `${handle}@example.test`,
          handle === "ada" ? "Ada" : handle === "grace" ? "Grace" : "Viewer",
          password,
          "2026-01-01T00:00:00Z",
        ],
      );
    }

    const channels = [
      {
        id: CHANNELS.fieldnotes,
        owner: USERS.ada,
        handle: "fieldnotes",
        name: "Field Notes",
        description: "Recordings from places without a road to them.",
      },
      {
        id: CHANNELS.patchbay,
        owner: USERS.grace,
        handle: "thepatchbay",
        name: "The Patch Bay",
        description: "Signal paths, taken apart.",
      },
    ];

    for (const channel of channels) {
      await tx.execute(
        `insert into channels (id, owner_id, handle, name, description, created_at)
         values ($1, $2, $3, $4, $5, $6::timestamptz)
         on conflict (id) do nothing`,
        [
          channel.id,
          channel.owner,
          channel.handle,
          channel.name,
          channel.description,
          "2026-01-01T00:00:00Z",
        ],
      );
    }

    for (const video of VIDEOS) {
      await tx.execute(
        `insert into videos
           (id, channel_id, title, description, duration_seconds, width, height,
            visibility, upload_status, is_short, view_count, like_count,
            dislike_count, published_at, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, 'public', 'ready', $8, $9, $10,
                 $11, $12::timestamptz, $12::timestamptz)
         on conflict (id) do nothing`,
        [
          video.id,
          video.channel,
          video.title,
          video.description,
          video.seconds,
          video.width,
          video.height,
          video.short,
          video.views,
          video.likes,
          video.dislikes,
          video.publishedAt,
        ],
      );

      const rungs = video.short ? LADDER.slice(0, 2) : LADDER;
      for (const rung of rungs) {
        await tx.execute(
          `insert into video_renditions
             (video_id, name, width, height, bandwidth, codec, frame_rate,
              init_key, playlist_key, segment_count, total_bytes)
           values ($1, $2, $3, $4, $5, 'avc1.640028', 30, $6, $7, $8, $9)
           on conflict (video_id, name) do nothing`,
          [
            video.id,
            rung.id,
            // A Short's ladder is vertical: the rung's numbers are the long
            // and short edges, and which is width depends on the orientation.
            video.short ? rung.height : rung.width,
            video.short ? rung.width : rung.height,
            rung.bitrate,
            `videos/${video.id}/${rung.id}/init.mp4`,
            `videos/${video.id}/${rung.id}/index.m3u8`,
            Math.ceil(video.seconds / 4),
            Math.round((rung.bitrate / 8) * video.seconds),
          ],
        );
      }

      await tx.execute(
        "update videos set master_playlist_key = $2 where id = $1",
        [video.id, `videos/${video.id}/master.m3u8`],
      );
    }

    /**
     * Caption tracks on the first video, and on no other.
     *
     * Two rows rather than one, because the pair is what the CC menu is for and
     * because they exercise the `(video_id, language, source)` uniqueness: an
     * uploaded English track and an automatic English track are two legitimate
     * rows for one video, and they were two rows pointing at one blob key until
     * `blobKeys.captions` learned about `source`.
     *
     * Only `is_default` on the uploaded one — the partial unique index
     * `captions_one_default_key` makes a second one a constraint violation
     * rather than a preference the player has to break a tie on.
     *
     * The `.vtt` bytes are absent, like every other blob here. That is the
     * point of leaving them out: a spec can assert the menu offers two tracks
     * and that the default is the uploaded one without a decoded frame, and the
     * one spec that needs the cues themselves runs against `pnpm seed`'s tree.
     */
    for (const track of CAPTIONS) {
      await tx.execute(
        `insert into captions
           (id, video_id, language, label, source, blob_key, is_default, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, '2026-01-02T09:00:00Z'::timestamptz)
         on conflict (id) do nothing`,
        [
          track.id,
          VIDEOS[0].id,
          track.language,
          track.label,
          track.source,
          `videos/${VIDEOS[0].id}/captions-${track.source}-${track.language}.vtt`,
          track.isDefault,
        ],
      );
    }

    /* Comments: one thread with a reply, so the panel has both shapes. */
    await tx.execute(
      `insert into comments (id, video_id, author_id, body, like_count, created_at)
       values ('cm_e2e_0001', $1, $2, $3, 42, '2026-01-05T10:00:00Z'::timestamptz)
       on conflict (id) do nothing`,
      [VIDEOS[0].id, USERS.viewer, "The bit at four minutes is extraordinary."],
    );
    await tx.execute(
      `insert into comments
         (id, video_id, author_id, parent_id, body, like_count, created_at)
       values ('cm_e2e_0002', $1, $2, 'cm_e2e_0001', $3, 7,
               '2026-01-05T11:00:00Z'::timestamptz)
       on conflict (id) do nothing`,
      [VIDEOS[0].id, USERS.ada, "That is the weir, half a mile upstream."],
    );
    await tx.execute(
      "update videos set comment_count = 2 where id = $1",
      [VIDEOS[0].id],
    );
    await tx.execute(
      "update comments set reply_count = 1 where id = 'cm_e2e_0001'",
    );

    /* One subscription, so the subscriptions feed is not the empty state. */
    await tx.execute(
      `insert into subscriptions (subscriber_id, channel_id, created_at)
       values ($1, $2, '2026-01-06T00:00:00Z'::timestamptz)
       on conflict (subscriber_id, channel_id) do nothing`,
      [USERS.viewer, CHANNELS.fieldnotes],
    );

    /**
     * Watch history, shaped so the co-visitation graph has something to say.
     *
     * Three distinct sessions containing both of Field Notes' long-form videos
     * is exactly `MIN_COVISIT_WEIGHT`, so the pair clears the floor and
     * `related_videos` gets a row — which is what makes the watch page's
     * sidebar a recommendation rather than the popularity backfill. Written
     * through the tables directly rather than through `recordWatch` so the
     * timestamps stay literal.
     */
    const sessions = ["e2e-s1", "e2e-s2", "e2e-s3"];
    for (const [index, session] of sessions.entries()) {
      for (const video of [VIDEOS[0], VIDEOS[1]]) {
        await tx.execute(
          `insert into session_videos (session_key, video_id, first_watched_at)
           values ($1, $2, $3::timestamptz)
           on conflict (session_key, video_id) do nothing`,
          [session, video.id, `2026-01-1${index}T12:00:00Z`],
        );
        await tx.execute(
          `insert into watch_events
             (user_id, session_key, video_id, watched_at, watched_seconds)
           values (null, $1, $2, $3::timestamptz, 120)`,
          [session, video.id, `2026-01-1${index}T12:00:00Z`],
        );
        await tx.execute(
          `insert into video_session_counts (video_id, session_count)
           values ($1, 1)
           on conflict (video_id) do update
              set session_count = video_session_counts.session_count + 1`,
          [video.id],
        );
      }
      await tx.execute(
        `insert into covisitation (video_a, video_b, weight, updated_at)
         values (least($1, $2), greatest($1, $2), 1, $3::timestamptz)
         on conflict (video_a, video_b) do update
            set weight = covisitation.weight + 1,
                updated_at = excluded.updated_at`,
        [VIDEOS[0].id, VIDEOS[1].id, `2026-01-1${index}T12:00:00Z`],
      );
    }

    /* A playlist with both long-form videos, for the playlist surfaces. */
    await tx.execute(
      `insert into playlists
         (id, owner_id, title, description, visibility, kind, created_at, updated_at)
       values ('pl_e2e_0001', $1, 'Water and wire', $2, 'public', 'user',
               '2026-01-07T00:00:00Z'::timestamptz,
               '2026-01-07T00:00:00Z'::timestamptz)
       on conflict (id) do nothing`,
      [USERS.viewer, "Two channels that have nothing in common."],
    );
    for (const [position, video] of [VIDEOS[0], VIDEOS[2]].entries()) {
      await tx.execute(
        `insert into playlist_items (playlist_id, video_id, position, added_at)
         values ('pl_e2e_0001', $1, $2, '2026-01-07T00:00:00Z'::timestamptz)
         on conflict (playlist_id, video_id) do nothing`,
        [video.id, (position + 1) * 1000],
      );
    }
  });

  /**
   * The neighbour lists, built from the graph the transaction just wrote.
   *
   * Outside the transaction and after it, because `refreshRelatedVideos`
   * rebuilds `related_videos` from the committed `covisitation` rows. Imported
   * here rather than at the top of the file so that a build which never seeds
   * does not pull the recommender's write path into its bundle.
   */
  const { refreshRelatedVideos } = await import(
    "@/adapters/repositories/watch-events"
  );
  await refreshRelatedVideos(db);

  /**
   * The search index, through the adapter rather than by writing the rows.
   *
   * `search_documents.search_vector` is built by four `setweight(to_tsvector
   * (…))` calls whose weight labels decide how a title ranks against a channel
   * name — the whole of what makes search feel right. Copying that expression
   * into this file would be a second definition of the ranking, and the first
   * change to either would silently give the e2e suite different results from
   * the application.
   *
   * This was the omission the e2e suite caught on its first real run: the
   * fixture wrote videos and no documents, so `/results?search_query=river`
   * returned nothing and the failure looked like a broken query.
   */
  const { createSearchIndex } = await import("@/adapters/search");
  const channelNames = new Map([
    [CHANNELS.fieldnotes, "Field Notes"],
    [CHANNELS.patchbay, "The Patch Bay"],
  ]);

  await createSearchIndex(db).indexMany(
    VIDEOS.map((video) => ({
      id: video.id,
      kind: "video" as const,
      title: video.title,
      description: video.description,
      channelName: channelNames.get(video.channel) ?? "",
      tags: [],
      publishedAt: new Date(video.publishedAt),
      viewCount: video.views,
      durationSeconds: video.seconds,
      likeCount: video.likes,
      dislikeCount: video.dislikes,
    })),
  );
}
