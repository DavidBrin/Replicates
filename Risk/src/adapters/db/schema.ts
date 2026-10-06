// GENERATED FILE — do not edit.
//
// Derived from `schema.sql` by `scripts/build-schema.mjs`. Edit the SQL and
// run `npm run build:schema`; `schema.test.ts` fails if the two disagree.
//
// It exists because reading the `.sql` from disk at runtime does not survive
// bundling: on Vercel the working directory is not the repository and the file
// is not traced into the function.

/** The complete schema. Idempotent; safe to re-apply to a live database. */
export const SCHEMA_SQL = `-- Risk — persistence schema (SPEC §6.2). Applied idempotently by
-- \`pnpm run db:push\` (Neon, at deploy time, from \`vercel.json\`'s build
-- command) and by the PGlite adapter on first boot.
--
-- Every statement is re-runnable: \`create table if not exists\`,
-- \`create index if not exists\`, and \`drop constraint if exists\` before an
-- \`add constraint\`. Applying this file to a live database is a no-op.
--
-- Ids are minted in application code (\`nanoid\`), never \`gen_random_uuid()\`:
-- PGlite has no pgcrypto.

-- ──────────────────────────────────────────────────── players + presence ──
-- The "temporary account" (D17). One row per visitor who claimed a name.
-- Presence is FOLDED IN rather than kept in a second table: for an account
-- whose entire lifetime is the session, a presence row would have the same
-- lifetime, one more write per poll and one more join per read.
create table if not exists players (
  id            text primary key,
  display_name  text not null,
  name_key      text not null,                 -- lower(btrim(display_name))
  secret_hash   text not null,                 -- sha256 of a server-minted secret
  color         text not null,                 -- a PlayerColour NAME, never a hex (F8)
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  constraint players_name_len   check (char_length(btrim(display_name)) between 2 and 20),
  constraint players_name_chars check (display_name ~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$'),
  -- The hex for each name lives ONLY in globals.css's \`--p-<name>\` token
  -- family, so re-tuning a palette value cannot invalidate a stored row.
  constraint players_color      check (color in
    ('red','green','blue','yellow','orange','pink','black','white','purple'))
);
create unique index if not exists players_name_key_uniq on players (name_key);
create index if not exists players_last_seen_idx on players (last_seen_at desc);

-- ────────────────────────────────────────────────────────────────── games ──
-- Declared before \`lobbies\` so \`lobbies.game_id\`'s foreign key can be added
-- in the same pass rather than by a follow-up \`alter table\`.
create table if not exists games (
  id            text primary key,
  lobby_id      text,                           -- FK added below, after \`lobbies\` exists
  map_id        text not null,
  rules         jsonb not null,
  -- SERVER-ONLY (D5). \`seed\` is off the \`GameState\` type entirely, so the
  -- response serialiser cannot reach it: there is nothing to strip.
  seed          text not null,
  status        text not null default 'playing',
  seq           bigint not null default 0,      -- == max(game_actions.seq); the ?since= cursor
  snapshot      jsonb not null,                 -- authoritative state AT snapshot_seq
  snapshot_seq  bigint not null default 0,
  state_hash    text not null,                  -- hashState(snapshot); the desync detector
  current_seat  int  not null default 0,
  phase         text not null,
  turn_deadline timestamptz,                    -- the auto-skip fence (§5.6)
  tick_lease    timestamptz,                    -- serialises concurrent lazy ticks
  winner_seat   int,
  -- The bots' cross-turn memory: \`{ "<seat>": { "grudge": number[] } }\`,
  -- §4.13's grudge vector per bot seat, carried into \`makeView\`'s \`grudge\`
  -- argument. WRITTEN BY THE LAZY TICK, inside the same transaction that
  -- appends the tick's actions, so it can never disagree with \`seq\`.
  -- NOT game state: never hashed, never serialised into a snapshot and never
  -- returned by a poll, so losing it degrades bot flavour and nothing else
  -- (F43).
  bot_memory    jsonb not null default '{}'::jsonb,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint games_status check (status in ('playing','finished','abandoned')),
  constraint games_seat   check (current_seat between 0 and 5)
);
create index if not exists games_live_idx on games (status, updated_at desc);

-- ──────────────────────────────────────────────────────────────── lobbies ──
create table if not exists lobbies (
  id           text primary key,                -- the 4-letter code (24 letters, no I or O)
  host_id      text not null references players(id) on delete cascade,
  title        text not null,
  status       text not null default 'open',
  map_id       text not null default 'classic',
  max_seats    int  not null default 6,
  settings     jsonb not null default '{}'::jsonb,   -- the \`Rules\` object
  game_id      text,                            -- set on start; FK added below
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  version      bigint not null default 1,       -- the ?since= cursor for polls 1 and 2
  constraint lobbies_status check (status in ('open','starting','playing','closed')),
  constraint lobbies_seats  check (max_seats between 2 and 6),
  constraint lobbies_title  check (char_length(btrim(title)) between 1 and 40)
);
create index if not exists lobbies_open_idx on lobbies (status, updated_at desc);

alter table lobbies drop constraint if exists lobbies_game_fk;
alter table lobbies add  constraint lobbies_game_fk
  foreign key (game_id) references games(id) on delete set null;

alter table games drop constraint if exists games_lobby_fk;
alter table games add  constraint games_lobby_fk
  foreign key (lobby_id) references lobbies(id) on delete set null;

create table if not exists lobby_seats (
  lobby_id   text not null references lobbies(id) on delete cascade,
  seat       int  not null,
  kind       text not null default 'open',      -- open | human | bot
  player_id  text references players(id) on delete set null,
  bot_level  text,
  ready      boolean not null default false,
  joined_at  timestamptz not null default now(),
  primary key (lobby_id, seat),
  constraint lobby_seats_seat  check (seat between 0 and 5),
  constraint lobby_seats_kind  check (kind in ('open','human','bot')),
  constraint lobby_seats_shape check (
    (kind = 'human' and player_id is not null and bot_level is null) or
    (kind = 'bot'   and player_id is null     and bot_level is not null) or
    (kind = 'open'  and player_id is null     and bot_level is null))
);
-- One seat per player per lobby, enforced by the database rather than by a
-- handler that has to remember.
create unique index if not exists lobby_seats_one_per_player
  on lobby_seats (lobby_id, player_id) where player_id is not null;

-- ─────────────────────────────────────────────────────────── game players ──
create table if not exists game_players (
  game_id       text not null references games(id) on delete cascade,
  seat          int  not null,
  kind          text not null,                  -- human | bot (a human can become a bot)
  player_id     text references players(id) on delete set null,
  bot_level     text,
  -- Denormalised so a finished game's scoreboard never becomes "(unknown)"
  -- after the temporary account expires.
  display_name  text not null,
  color         text not null,
  standing      text not null default 'active',
  missed_turns  int  not null default 0,
  last_seen_at  timestamptz,
  primary key (game_id, seat),
  constraint game_players_kind     check (kind in ('human','bot')),
  constraint game_players_standing check (standing in ('active','eliminated','resigned','away')),
  constraint game_players_seat     check (seat between 0 and 5),
  constraint game_players_color    check (color in
    ('red','green','blue','yellow','orange','pink','black','white','purple'))
);
create index if not exists game_players_player_idx
  on game_players (player_id) where player_id is not null;

-- ───────────────────────────────────────────────────────── the action log ──
-- Append-only. \`seq\` is contiguous per game from 1, with no gaps and no
-- reordering. This is the single source of truth; \`games.snapshot\` is a cache
-- of its fold.
create table if not exists game_actions (
  game_id          text   not null references games(id) on delete cascade,
  seq              bigint not null,
  seat             int    not null,
  type             text   not null,
  payload          jsonb  not null default '{}'::jsonb,   -- carries every server-rolled value
  actor            text   not null,                       -- human | bot | server
  client_action_id text,                                  -- idempotency key; null for bot/server
  state_hash       text   not null,                       -- the hash AFTER applying this action
  created_at       timestamptz not null default now(),
  primary key (game_id, seq),
  constraint game_actions_actor check (actor in ('human','bot','server')),
  constraint game_actions_seq   check (seq > 0),
  -- -1 = SEAT_NONE, -2 = SEAT_NEUTRAL (§4.4, F5): a server-resolved row can
  -- legitimately name the neutral holding.
  constraint game_actions_seat  check (seat between -2 and 5)
);
-- The idempotency fence: a retried POST hits this and becomes a no-op (D15).
create unique index if not exists game_actions_idem
  on game_actions (game_id, client_action_id) where client_action_id is not null;

-- ─────────────────────────────────────────────────────────────────── chat ──
-- Preset-only, and never an action (§5.9). There is no \`body\` column, so
-- there is no free-text path anywhere in the app — by construction rather
-- than by validation (D41).
create table if not exists chat_messages (
  id           bigserial primary key,
  scope        text not null,                   -- global | lobby | game
  scope_id     text,                            -- null for global
  player_id    text references players(id) on delete set null,
  display_name text not null,                   -- denormalised, same reason as game_players
  line_id      int,                             -- the 42-line roster index (§7.3)
  emoji        text,                            -- or one of the 8 glyph ids
  created_at   timestamptz not null default now(),
  constraint chat_scope check (scope in ('global','lobby','game')),
  -- Exactly one of the two, never both and never neither.
  constraint chat_one_of check ((line_id is not null) <> (emoji is not null)),
  constraint chat_line_range check (line_id is null or line_id between 1 and 42)
);
create index if not exists chat_scope_idx on chat_messages (scope, scope_id, id desc);
`;
