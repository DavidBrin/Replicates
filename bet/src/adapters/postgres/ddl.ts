/**
 * The Postgres adapter's schema as plain, idempotent DDL.
 *
 * Why a hand-written string and not `drizzle-kit` migrations: opening a
 * database has to work in three places with no build step between them —
 * a PGlite file on a developer's laptop, a fresh in-memory PGlite in the
 * test suite, and a Neon project reached from `pnpm db:push`. `drizzle-kit`
 * is a devDependency and a CLI; requiring it at runtime would make the
 * opt-in Postgres path fail on Vercel, where devDependencies are pruned.
 * Every statement is `IF NOT EXISTS`, so applying this to a populated
 * database is a no-op and it can run unconditionally on open.
 *
 * This must stay in step with `schema.ts` (the Drizzle table definitions
 * the queries are actually built from). Nothing enforces that mechanically,
 * but `drizzle-store.test.ts` runs the whole `DataStore` contract against a
 * PGlite database created from exactly this DDL, and the contract touches
 * every column — so a drift between the two fails the suite.
 *
 * `drizzle.config.ts` still points `drizzle-kit` at `schema.ts` for anyone
 * who prefers `drizzle-kit push`/`generate`; both routes produce the same
 * tables.
 */

export const SCHEMA_SQL = `
create table if not exists users (
  id text primary key,
  handle text not null,
  display_name text not null,
  avatar_color text not null,
  avatar_initials text not null,
  balance integer not null,
  created_at timestamptz not null
);
create index if not exists users_handle_idx on users (handle);

create table if not exists friendships (
  user_a_id text not null,
  user_b_id text not null,
  created_at timestamptz not null,
  primary key (user_a_id, user_b_id)
);
create index if not exists friendships_user_b_idx on friendships (user_b_id);

create table if not exists friend_requests (
  id text primary key,
  from_id text not null,
  to_id text not null,
  status text not null,
  created_at timestamptz not null
);
create index if not exists friend_requests_to_idx on friend_requests (to_id, status);
create index if not exists friend_requests_from_idx on friend_requests (from_id, status);

create table if not exists groups (
  id text primary key,
  slug text not null,
  name text not null,
  emoji text not null,
  member_ids text[] not null,
  owner_id text not null,
  created_at timestamptz not null
);
create index if not exists groups_slug_idx on groups (slug);

create table if not exists markets (
  id text primary key,
  group_id text,
  creator_id text not null,
  question text not null,
  resolution_criteria text not null,
  resolution_source text,
  closes_at timestamptz not null,
  status text not null,
  visibility text not null,
  pricing jsonb not null,
  min_stake integer not null,
  max_stake integer not null,
  stakes_visible boolean not null,
  outcomes jsonb not null,
  resolution jsonb,
  category text,
  created_at timestamptz not null
);
create index if not exists markets_group_idx on markets (group_id);
create index if not exists markets_creator_idx on markets (creator_id);
create index if not exists markets_visibility_idx on markets (visibility);

create table if not exists positions (
  id text primary key,
  market_id text not null,
  outcome_id text not null,
  user_id text not null,
  shares double precision not null,
  cost_basis integer not null
);
create unique index if not exists positions_market_outcome_user_key
  on positions (market_id, outcome_id, user_id);
create index if not exists positions_user_idx on positions (user_id);

create table if not exists trades (
  id text primary key,
  market_id text not null,
  outcome_id text not null,
  user_id text not null,
  side text not null,
  shares double precision not null,
  cost integer not null,
  avg_price double precision not null,
  fee integer not null,
  at timestamptz not null
);
create index if not exists trades_market_idx on trades (market_id, at);
create index if not exists trades_user_idx on trades (user_id, at);

create table if not exists messages (
  id text primary key,
  room_id text not null,
  author_id text,
  kind text not null,
  body text not null,
  client_id text,
  at timestamptz not null
);
create index if not exists messages_room_keyset_idx on messages (room_id, at desc, id desc);
create index if not exists messages_client_id_idx on messages (room_id, client_id);
-- Idempotent chat sends: at most one row per (room, author, client_id) once
-- a client_id is supplied. \`nulls not distinct\` is what makes this cover
-- system messages too, whose author_id is null — without it every such row
-- would be unique to Postgres and the constraint would never fire.
create unique index if not exists messages_client_id_key
  on messages (room_id, author_id, client_id) nulls not distinct
  where client_id is not null;

create table if not exists invites (
  id text primary key,
  kind text not null,
  target_type text not null,
  target_id text not null,
  inviter_id text not null,
  invitee_id text,
  token_hash text,
  status text not null,
  expires_at timestamptz not null,
  created_at timestamptz not null
);
create index if not exists invites_token_hash_idx on invites (token_hash);
create index if not exists invites_inviter_idx on invites (inviter_id);
create index if not exists invites_invitee_idx on invites (invitee_id);

create table if not exists notifications (
  id text primary key,
  user_id text not null,
  type text not null,
  payload jsonb not null,
  read_at timestamptz,
  created_at timestamptz not null
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

create table if not exists price_points (
  market_id text not null,
  at timestamptz not null,
  prices jsonb not null,
  primary key (market_id, at)
);
`;

/** Table names in an order safe to truncate/drop as one statement. */
export const TABLE_NAMES = [
  "users",
  "friendships",
  "friend_requests",
  "groups",
  "markets",
  "positions",
  "trades",
  "messages",
  "invites",
  "notifications",
  "price_points",
] as const;

/**
 * Splits `SCHEMA_SQL` into individual statements. Neither driver reliably
 * accepts a whole multi-statement script through the same path used for
 * parameterised queries, and splitting also means a syntax error names the
 * statement that caused it rather than the file. This script contains no
 * dollar-quoted blocks or string literals with semicolons in them — only
 * DDL and `--` comments — so a line-comment-aware scan is sufficient.
 */
export function splitStatements(script: string): string[] {
  const withoutComments = script
    .split("\n")
    .map((line) => {
      const commentAt = line.indexOf("--");
      return commentAt === -1 ? line : line.slice(0, commentAt);
    })
    .join("\n");
  return withoutComments
    .split(";")
    .map((statement) => statement.trim())
    .filter((statement) => statement.length > 0);
}
