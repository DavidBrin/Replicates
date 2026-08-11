-- Dollar Pixels — Postgres schema (Neon).
--
-- Apply once against the target database before setting STORE_DRIVER=postgres:
--
--   psql "$DATABASE_URL" -f src/adapters/store/schema.sql
--
-- Every statement is idempotent, so re-running it on a live database is safe.
--
-- Ids are application-generated strings (`prefix_nanoid`), not sequences: the
-- id exists before the row does, because an order's id goes to the payment
-- provider before anything is written.
--
-- `by` is a non-reserved keyword in Postgres and would parse unquoted, but it
-- is quoted everywhere here and in `postgres.ts` so that neither this file nor
-- a future Postgres release has to be trusted on that point.

create table if not exists users (
  id           text primary key,
  handle       text        not null,
  display_name text        not null,
  created_at   timestamptz not null
);

-- Handles are matched case-insensitively, so uniqueness has to be enforced the
-- same way — otherwise `David` and `david` both insert and the lookup for
-- either returns whichever row the planner reached first.
create unique index if not exists users_handle_lower_key on users (lower(handle));

create table if not exists pages (
  id              text primary key,
  slug            text        not null unique,
  title           text        not null,
  kind            text        not null check (kind in ('flagship', 'private', 'premium')),
  size            text        not null check (size in ('small', 'medium', 'full')),
  -- Null on the flagship page, which belongs to the platform.
  owner_id        text references users (id),
  allowance_total integer     not null check (allowance_total >= 0),
  allowance_used  integer     not null default 0,
  created_at      timestamptz not null,
  -- The allowance can only ever be spent down to zero. `consumeAllowance`
  -- guards this in its WHERE clause; the constraint is what makes it true even
  -- if some other code path ever writes the column.
  constraint pages_allowance_within_total
    check (allowance_used >= 0 and allowance_used <= allowance_total)
);

create index if not exists pages_owner_idx on pages (owner_id);
-- The directory reads listed pages only: flagship and premium (SPEC section 4).
create index if not exists pages_listed_idx on pages (created_at) where kind <> 'private';

create table if not exists orders (
  id           text primary key,
  kind         text        not null check (kind in ('blocks', 'page')),
  -- Null for a `page` order: the page does not exist until it settles.
  page_id      text references pages (id),
  buyer_id     text        not null references users (id),
  amount_cents integer     not null,
  status       text        not null check (status in ('pending', 'paid', 'expired', 'cancelled')),
  provider     text        not null,
  provider_ref text,
  -- The pending claim or the pending page, so settlement needs nothing but the
  -- order (SPEC section 6).
  payload      jsonb       not null,
  created_at   timestamptz not null,
  settled_at   timestamptz
);

create index if not exists orders_buyer_idx on orders (buyer_id, created_at);

create table if not exists claims (
  id         text primary key,
  page_id    text        not null references pages (id),
  owner_id   text        not null references users (id),
  bx         integer     not null,
  "by"       integer     not null,
  bw         integer     not null check (bw > 0),
  bh         integer     not null check (bh > 0),
  caption    text        not null,
  colour     text        not null,
  -- PNG data URL sized exactly to the rect, or null for a solid colour claim.
  -- Inline rather than in blob storage: tiles are sub-kilobyte and thousands of
  -- per-object requests cost far more than the 33% base64 overhead
  -- (research/persistence-and-vercel.md section 5, DECISIONS D14).
  tile       text,
  order_id   text        not null references orders (id),
  created_at timestamptz not null
);

create index if not exists claims_page_idx on claims (page_id, created_at);
create index if not exists claims_owner_idx on claims (owner_id, created_at);

-- One row per owned block.
--
-- This table is the whole reason the store is Postgres. `PRIMARY KEY (page_id,
-- bx, by)` makes selling one block twice structurally impossible rather than
-- merely unlikely: `claimBlocks` inserts the rect with ON CONFLICT DO NOTHING
-- and compares the row count to the rect's size, so two concurrent settlements
-- over the same block cannot both believe they won
-- (research/persistence-and-vercel.md section 6).
create table if not exists blocks (
  page_id  text    not null references pages (id),
  bx       integer not null,
  "by"     integer not null,
  claim_id text    not null references claims (id),
  primary key (page_id, bx, "by")
);

create index if not exists blocks_claim_idx on blocks (claim_id);

-- One reservation per order, stored as a rectangle rather than a row per block:
-- a hold is only ever tested for rect overlap, and a 4,000-block selection
-- would otherwise write 4,000 rows that a 30-minute timeout throws away.
--
-- Nothing deletes these on a timer. A hold whose `expires_at` has passed is
-- treated as absent by every read, and rows are swept opportunistically when
-- the page is next reserved on or claimed (DECISIONS D9).
create table if not exists holds (
  order_id   text primary key references orders (id),
  page_id    text        not null references pages (id),
  bx         integer     not null,
  "by"       integer     not null,
  bw         integer     not null check (bw > 0),
  bh         integer     not null check (bh > 0),
  expires_at timestamptz not null
);

create index if not exists holds_page_idx on holds (page_id, expires_at);

-- Append-only. A correction is a new negative entry, never an edit — hence no
-- update path and no `updated_at`.
create table if not exists ledger_entries (
  id           text primary key,
  order_id     text        not null references orders (id),
  page_id      text references pages (id),
  -- Null when the money belongs to the platform.
  recipient_id text references users (id),
  amount_cents integer     not null,
  kind         text        not null check (kind in ('block_sale', 'page_sale', 'platform_fee')),
  created_at   timestamptz not null
);

create index if not exists ledger_recipient_idx on ledger_entries (recipient_id, created_at);

-- Webhook de-duplication. The primary key is what makes an at-least-once
-- delivery idempotent: the second insert of the same event id conflicts, the
-- row count comes back zero, and the handler knows to do nothing.
create table if not exists processed_events (
  id          text primary key,
  provider    text        not null,
  received_at timestamptz not null
);
