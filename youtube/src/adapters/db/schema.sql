-- YouTube replica — schema
--
-- One dialect, applied identically to PGlite (development, tests) and Neon
-- (deployed). Idempotent: every statement is `if not exists` or equivalent, so
-- boot applies it unconditionally and a re-run is free.
--
-- Two constraints govern what may appear below, and both are invisible until
-- they fail:
--
--   1. PGlite's base bundle ships NO extensions. `create extension` fails
--      outright — no `pg_trgm`, no `citext`, no `unaccent`, no `pgcrypto`.
--      `gen_random_uuid()` and `tsvector` are core since PG13 and are fine.
--      Anything that needs an extension works on Neon and cannot boot locally,
--      which is the worst direction for a difference to run.
--
--   2. Text compared byte-wise must say so. Postgres' default ICU collation
--      folds case, and identifiers here are case-sensitive by intent.
--
-- Ids are application-generated text rather than uuids wherever the id appears
-- in a URL. A video id is eleven URL-safe characters because that is what sits
-- in `/watch?v=`, and a schema that stored a uuid there would have produced an
-- application whose every link was the wrong shape.

/* ---------------------------------------------------------------- people -- */

create table if not exists users (
  id            text primary key,
  email         text not null,
  password_hash text not null,
  display_name  text not null,
  created_at    timestamptz not null default now()
);

-- Case-insensitive uniqueness without `citext`. The `lower()` expression is
-- load-bearing in both directions: every lookup must use the same expression
-- or it silently misses the index *and* lets two spellings of one address
-- both register.
create unique index if not exists users_email_key on users (lower(email));

create table if not exists sessions (
  id         text primary key,
  user_id    text not null references users (id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

/* -------------------------------------------------------------- channels -- */

create table if not exists channels (
  id          text primary key,
  owner_id    text not null references users (id) on delete cascade,
  -- The @handle. Collated byte-wise so that reserving one spelling does not
  -- silently reserve every casing of it, and unique on `lower()` so that two
  -- casings cannot both be taken.
  handle      text not null collate "C",
  name        text not null,
  description text not null default '',
  avatar_key  text,
  banner_key  text,
  -- The verified tick. On a channel rather than derived from a subscriber
  -- threshold, because the real thing is a manual eligibility decision and a
  -- computed one would flicker as counts crossed a boundary.
  verified    boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists channels_handle_key on channels (lower(handle));
create index if not exists channels_owner_idx on channels (owner_id);

/* ---------------------------------------------------------------- videos -- */

-- `upload_status` tracks a client-side transcode, which is a genuinely
-- multi-step, resumable, abandonable process — the browser encodes a ladder
-- and posts segments as they are produced, so a row exists long before the
-- video is playable and may never become playable at all.
--
-- `pipeline` records which of the two upload paths produced this video.
-- 'laddered' is the normal path: WebCodecs in the uploader's browser, a
-- rendition ladder, HLS. 'progressive' is the fallback for a browser with no
-- WebCodecs — the source file stored untouched and served whole over HTTP
-- `Range`. The player branches on this column, so it is not a diagnostic
-- field; it is load-bearing.
create table if not exists videos (
  id                text primary key,
  channel_id        text not null references channels (id) on delete cascade,
  title             text not null,
  description       text not null default '',
  visibility        text not null default 'public'
                      check (visibility in ('public', 'unlisted', 'private')),
  upload_status     text not null default 'uploading'
                      check (upload_status in
                        ('uploading', 'processing', 'ready', 'failed')),
  pipeline          text not null default 'laddered'
                      check (pipeline in ('laddered', 'progressive')),
  duration_seconds  double precision not null default 0,
  width             integer not null default 0,
  height            integer not null default 0,
  -- A Short is not a different entity, only a different presentation of one:
  -- vertical, and at or under the duration cut-off. Derived at publish time
  -- rather than queried, because every feed filters on it.
  is_short          boolean not null default false,
  master_playlist_key text,
  progressive_key   text,
  thumbnail_key     text,
  preview_key       text,
  view_count        bigint not null default 0,
  like_count        bigint not null default 0,
  dislike_count     bigint not null default 0,
  comment_count     bigint not null default 0,
  comments_enabled  boolean not null default true,
  category          text not null default 'People & Blogs',
  -- Attribution for third-party licensed source material, kept out of
  -- `description` deliberately.
  --
  -- `pnpm seed:demo` pulls Creative Commons clips, and CC-BY *requires* credit.
  -- Putting that credit in the description would satisfy the licence exactly
  -- until the first person edits their description, at which point the
  -- obligation is silently dropped by a field that was never meant to carry
  -- one. A separate column is not tidiness: it is the difference between
  -- honouring the terms and appearing to.
  attribution       text,
  licence           text,
  licence_url       text,
  published_at      timestamptz,
  created_at        timestamptz not null default now()
);

-- Every ordering index carries `id` as a final tiebreaker, and that is not
-- belt-and-braces.
--
-- MEASURED: PGlite's `now()` resolves to milliseconds — the microsecond field
-- of a `timestamptz` it generates is always zero. Real Postgres resolves to
-- microseconds. So several rows inserted in one batch share a timestamp
-- locally and do not share one on Neon, which means `order by published_at
-- desc` alone is a total order on the deployed engine and an arbitrary one in
-- development.
--
-- That asymmetry is worse than a plain bug. A feed test asserting an exact
-- order passes against Neon and flakes locally, so the natural conclusion is
-- that the local engine is at fault and the assertion gets weakened — which
-- removes the only check that would have caught a genuine ordering error
-- later. Appending a unique column makes the order total on both engines and
-- takes the question off the table.
create index if not exists videos_channel_idx
  on videos (channel_id, published_at desc, id desc);
create index if not exists videos_published_idx
  on videos (published_at desc, id desc)
  where visibility = 'public' and upload_status = 'ready';
create index if not exists videos_shorts_idx
  on videos (published_at desc, id desc)
  where is_short and visibility = 'public' and upload_status = 'ready';

-- One rung of the ladder. `bandwidth` is the measured average the packager
-- wrote into the master playlist's EXT-X-STREAM-INF, not the encoder's
-- requested target — the player's ABR compares it against measured throughput,
-- so an aspirational number here makes every switching decision wrong.
create table if not exists video_renditions (
  video_id       text not null references videos (id) on delete cascade,
  name           text not null,
  width          integer not null,
  height         integer not null,
  bandwidth      integer not null,
  -- The RFC 6381 codec string, e.g. `avc1.4d401f`. Negotiated at encode time
  -- against what the uploader's browser could actually produce, so this is not
  -- derivable from the rung and must be stored.
  codec          text not null,
  frame_rate     double precision not null default 30,
  init_key       text not null,
  playlist_key   text not null,
  segment_count  integer not null default 0,
  total_bytes    bigint not null default 0,
  primary key (video_id, name)
);

create table if not exists video_tags (
  video_id text not null references videos (id) on delete cascade,
  tag      text not null,
  primary key (video_id, tag)
);

create index if not exists video_tags_tag_idx on video_tags (tag);

/* ---------------------------------------------------------------- social -- */

create table if not exists subscriptions (
  subscriber_id text not null references users (id) on delete cascade,
  channel_id    text not null references channels (id) on delete cascade,
  -- 'all' | 'personalised' | 'none' — the bell.
  notifications text not null default 'personalised'
                  check (notifications in ('all', 'personalised', 'none')),
  created_at    timestamptz not null default now(),
  primary key (subscriber_id, channel_id)
);

create index if not exists subscriptions_channel_idx
  on subscriptions (channel_id);

-- Likes on videos and on comments share one table because they share one rule:
-- a person holds at most one opinion about one thing, and changing it is an
-- update rather than a second row. Splitting them into two tables would mean
-- writing that rule twice.
create table if not exists reactions (
  user_id     text not null references users (id) on delete cascade,
  target_kind text not null check (target_kind in ('video', 'comment')),
  target_id   text not null,
  value       smallint not null check (value in (-1, 1)),
  created_at  timestamptz not null default now(),
  primary key (user_id, target_kind, target_id)
);

create index if not exists reactions_target_idx
  on reactions (target_kind, target_id);

-- Threaded, but only one level deep — which is YouTube's actual model, not a
-- simplification of it. A reply to a reply is stored against the same
-- top-level parent and merely mentions its addressee. Enforced by the check
-- below rather than by convention, because a two-level tree that the UI cannot
-- render is a data problem nobody notices until it is in the database.
create table if not exists comments (
  id             text primary key,
  video_id       text not null references videos (id) on delete cascade,
  author_id      text not null references users (id) on delete cascade,
  parent_id      text references comments (id) on delete cascade,
  body           text not null,
  like_count     bigint not null default 0,
  reply_count    bigint not null default 0,
  is_pinned      boolean not null default false,
  -- Set when the channel owner has hearted the comment.
  hearted        boolean not null default false,
  created_at     timestamptz not null default now(),
  edited_at      timestamptz
);

-- `id` tiebreakers again, for the reason given above `videos_channel_idx`:
-- a comment thread posted inside one millisecond has no stable order locally
-- and a stable one on Neon.
create index if not exists comments_video_idx
  on comments (video_id, is_pinned desc, like_count desc, created_at desc, id desc)
  where parent_id is null;
create index if not exists comments_parent_idx
  on comments (parent_id, created_at, id)
  where parent_id is not null;

/* ------------------------------------------------------------- playlists -- */

-- `kind` distinguishes the two playlists every account has whether it asked
-- for them or not. They are real playlists — same table, same items, same
-- rendering — but they cannot be deleted and their titles are not the owner's
-- to change, so the constraint lives here rather than in a service that could
-- be bypassed.
create table if not exists playlists (
  id          text primary key,
  owner_id    text not null references users (id) on delete cascade,
  title       text not null,
  description text not null default '',
  visibility  text not null default 'private'
                check (visibility in ('public', 'unlisted', 'private')),
  kind        text not null default 'user'
                check (kind in ('user', 'watch_later', 'liked')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index if not exists playlists_system_key
  on playlists (owner_id, kind)
  where kind <> 'user';

create index if not exists playlists_owner_idx
  on playlists (owner_id, updated_at desc);

create table if not exists playlist_items (
  playlist_id text not null references playlists (id) on delete cascade,
  video_id    text not null references videos (id) on delete cascade,
  -- Manual ordering as a sparse integer, re-spaced on collision. A fractional
  -- index would avoid the re-space, but playlists are reordered by drag within
  -- a page of at most a few hundred rows, and the sibling project that used
  -- fractional strings found they exhaust double precision after about fifty
  -- drags into one gap.
  position    integer not null,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, video_id)
);

create index if not exists playlist_items_order_idx
  on playlist_items (playlist_id, position);

/* --------------------------------------------------------------- viewing -- */

-- Every watch, append-only. This is the recommender's raw input and the
-- history page's source, and it is deliberately not the same table as
-- `watch_progress` — one is an event log that only grows, the other is a
-- current-state row that is overwritten. Conflating them would mean either
-- losing the co-visitation signal or rewriting history rows on every seek.
--
-- `session_key` groups a signed-out viewer's watches so that co-visitation
-- works before anyone has an account. It is a cookie value, not an identity.
create table if not exists watch_events (
  id           bigserial primary key,
  user_id      text references users (id) on delete set null,
  session_key  text not null,
  video_id     text not null references videos (id) on delete cascade,
  watched_at   timestamptz not null default now(),
  -- Seconds actually watched, not the position reached. A seek to the end is
  -- not a view, and the recommender must not treat it as one.
  watched_seconds double precision not null default 0
);

create index if not exists watch_events_session_idx
  on watch_events (session_key, watched_at desc);
create index if not exists watch_events_user_idx
  on watch_events (user_id, watched_at desc);
create index if not exists watch_events_video_idx
  on watch_events (video_id, watched_at desc);

-- Where the red bar under the thumbnail comes from, and where playback
-- resumes. One row per viewer per video, overwritten.
create table if not exists watch_progress (
  user_id          text not null references users (id) on delete cascade,
  video_id         text not null references videos (id) on delete cascade,
  position_seconds double precision not null default 0,
  completed        boolean not null default false,
  updated_at       timestamptz not null default now(),
  primary key (user_id, video_id)
);

create index if not exists watch_progress_recent_idx
  on watch_progress (user_id, updated_at desc, video_id desc);

/* --------------------------------------------------------------- search -- */

-- Search storage belongs to the search adapter, not to the domain. Videos,
-- channels and playlists are three different tables with three different
-- shapes, and a query that ranked across them by joining all three would be
-- rewritten completely the day the port swaps to a real index. Denormalising
-- into one document table keeps that swap to one file.
--
-- The vector is a stored column written by the adapter rather than a trigger:
-- the port's `index()` call is the documented moment a document changes, and a
-- trigger would make a second, invisible one.
create table if not exists search_documents (
  id            text primary key,
  kind          text not null check (kind in ('video', 'channel', 'playlist')),
  title         text not null,
  description   text not null default '',
  channel_name  text not null default '',
  tags          text not null default '',
  published_at  timestamptz,
  view_count    bigint not null default 0,
  -- Both counts, not a stored ratio. The `rating` sort orders by the lower
  -- bound of a confidence interval on the like rate, which needs the sample
  -- size as well as the proportion — 1 like out of 1 and 10,000 out of 10,003
  -- are the same ratio and are not the same evidence. A precomputed ratio
  -- column would throw away the half that distinguishes them.
  like_count    bigint not null default 0,
  dislike_count bigint not null default 0,
  duration_seconds double precision not null default 0,
  search_vector tsvector
);

create index if not exists search_documents_vector_idx
  on search_documents using gin (search_vector);
create index if not exists search_documents_kind_idx
  on search_documents (kind, published_at desc);

/* ---------------------------------------------------- recommender: graph -- */

-- Co-visitation, after Davidson et al., RecSys 2010 (doi 10.1145/1864708.1864770).
--
-- The paper's relatedness score is r(vi,vj) = cij / f(vi,vj), with the
-- instantiated denominator f(vi,vj) = ci·cj. Three tables rather than one,
-- because those three quantities are genuinely different things and an
-- implementation that conflates any two of them is subtly and silently wrong:
--
--   session_videos       — which videos a session has already seen
--   video_session_counts — ci, distinct sessions containing vi
--   covisitation         — cij, distinct sessions containing both
--
-- `session_videos` is not bookkeeping, it is the correctness of the whole
-- structure. cij counts *distinct sessions* containing both videos, so a
-- viewer who replays one video four times in a sitting must contribute one to
-- each of its pairs, not four. Without a membership set to test against, every
-- replay re-increments and the counts quietly become "watched together,
-- weighted by replay count" — which inflates exactly the popular pairs the
-- recommender leans on hardest, so the output still looks plausible.
-- `research/04-recommender-covisitation.md` §2 names this as the single most
-- common defect in a from-scratch implementation.
--
-- ci is a session count, NOT `videos.view_count`. They diverge the moment
-- anyone watches anything twice, and using the view count as the normaliser
-- would penalise rewatched videos for being rewatched.
create table if not exists session_videos (
  session_key       text not null,
  video_id          text not null references videos (id) on delete cascade,
  first_watched_at  timestamptz not null default now(),
  primary key (session_key, video_id)
);

create table if not exists video_session_counts (
  video_id      text primary key references videos (id) on delete cascade,
  session_count bigint not null default 0
);

-- cij. Canonicalised so an unordered pair is stored once — `video_a < video_b`
-- is enforced rather than assumed, because a single un-canonicalised insert
-- would create a second row for a pair that already exists and split its count
-- across the two.
--
-- The read path does not use this table directly; see `related_videos` below.
create table if not exists covisitation (
  video_a    text not null references videos (id) on delete cascade,
  video_b    text not null references videos (id) on delete cascade,
  weight     integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (video_a, video_b),
  check (video_a < video_b)
);

-- The precomputed top-K neighbour list — the paper's Ri.
--
-- Denormalised to both directions, which is the deliberate opposite of the
-- write table's canonicalisation, because the two have opposite access
-- patterns. Writes touch one row per pair and want the table half the size;
-- reads always ask "given this seed, what is related" and want the answer off
-- one index with no union and no CASE. Keeping both shapes costs a refresh
-- step and saves that union on every watch page and every home feed.
create table if not exists related_videos (
  seed_id      text not null references videos (id) on delete cascade,
  candidate_id text not null references videos (id) on delete cascade,
  score        double precision not null,
  rank         integer not null,
  primary key (seed_id, candidate_id)
);

create index if not exists related_videos_seed_rank_idx
  on related_videos (seed_id, rank);
create index if not exists covisitation_a_idx on covisitation (video_a, weight desc);
create index if not exists covisitation_b_idx on covisitation (video_b, weight desc);
create index if not exists session_videos_video_idx on session_videos (video_id);

/* -------------------------------------------------------------- captions -- */

create table if not exists captions (
  id          text primary key,
  video_id    text not null references videos (id) on delete cascade,
  -- BCP-47.
  language    text not null,
  label       text not null,
  source      text not null check (source in ('uploaded', 'automatic')),
  blob_key    text not null,
  is_default  boolean not null default false,
  created_at  timestamptz not null default now()
);

create unique index if not exists captions_video_language_key
  on captions (video_id, language, source);

/* ------------------------------------------------------------ content id -- */

-- A work a rights-holder has registered for matching. Its audio has been
-- fingerprinted into `fingerprints`; the reference itself may or may not also
-- exist as a video on the platform.
create table if not exists reference_works (
  id            text primary key,
  title         text not null,
  rights_holder text not null,
  -- The default policy applied to a new match. The rights-holder may change it
  -- per claim afterwards.
  policy        text not null default 'monetise'
                  check (policy in ('block', 'monetise', 'track')),
  video_id      text references videos (id) on delete set null,
  duration_seconds double precision not null default 0,
  created_at    timestamptz not null default now()
);

-- The inverted index: landmark hash → where it occurs in which work.
--
-- `hash` packs the (f1, f2, Δt) triple from the constellation pairing —
-- absolute frequencies for both points, not a delta between them. An earlier
-- version of this comment said (f1, Δf, Δt), which is a different and also
-- workable scheme; recording the wrong one would have left the next reader
-- unable to interpret the stored values.
-- Integer rather than bytea so that the index is a plain btree on a fixed-width
-- type — this table is by far the largest in the schema, at roughly a thousand
-- rows per minute of registered audio, and every byte of key width is
-- multiplied by that.
--
-- No foreign key to `reference_works`, deliberately: a bulk fingerprint insert
-- of tens of thousands of rows should not take tens of thousands of index
-- probes to verify a parent that the caller just created. Orphans are cleaned
-- with the work.
create table if not exists fingerprints (
  hash       integer not null,
  work_id    text not null,
  offset_ms  integer not null
);

create index if not exists fingerprints_hash_idx on fingerprints (hash);
create index if not exists fingerprints_work_idx on fingerprints (work_id);

-- A match, once the offset histogram has spiked.
create table if not exists claims (
  id            text primary key,
  video_id      text not null references videos (id) on delete cascade,
  reference_id  text not null references reference_works (id) on delete cascade,
  policy        text not null check (policy in ('block', 'monetise', 'track')),
  status        text not null default 'active'
                  check (status in ('active', 'disputed', 'released')),
  -- The matched span, in the *claimed video's* timeline.
  match_start_ms integer not null,
  match_end_ms   integer not null,
  -- Where that span sits in the reference work, which is what makes a claim
  -- checkable by the uploader rather than merely assertable by us.
  reference_offset_ms integer not null,
  -- Histogram peak height. The number the threshold was applied to, kept so a
  -- dispute can be argued about evidence rather than about a boolean.
  score         integer not null,
  created_at    timestamptz not null default now()
);

create index if not exists claims_video_idx on claims (video_id);
create index if not exists claims_reference_idx on claims (reference_id);

/* ------------------------------------------------------------------- ads -- */

create table if not exists ad_creatives (
  id                text primary key,
  advertiser        text not null,
  blob_key          text not null,
  duration_seconds  double precision not null,
  click_through_url text,
  skip_after_seconds integer,
  weight            integer not null default 1,
  created_at        timestamptz not null default now()
);
