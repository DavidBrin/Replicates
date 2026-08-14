-- ===========================================================================
-- Linear clone — schema
-- ===========================================================================
--
-- One file, one dialect. It is applied unchanged to both engines: PGlite
-- (PostgreSQL 18.3 compiled to WASM) locally and in tests, and Neon in a
-- deployment. Applied by `scripts/db-push.ts`, never from a request handler.
--
-- Every statement is idempotent, so re-running it against a live database is
-- safe and the build command can apply it on every deploy.
--
-- ---------------------------------------------------------------------------
-- Three constraints shaped this file, and all three were measured rather than
-- assumed:
--
-- 1. **No extensions.** PGlite's base bundle ships none of `citext`,
--    `pgcrypto` or `pg_trgm` — `create extension` fails outright. So
--    case-insensitive uniqueness is a `unique index on (lower(x))` rather than
--    a `citext` column, and search is `ilike` rather than a trigram index.
--    `gen_random_uuid()` needs no extension on PG13+, so ids are fine.
--
-- 2. **Order keys are `collate "C"`, explicitly, on the column.** Manual
--    ordering is a base-62 string compared byte-wise. Postgres' default ICU
--    collation folds case, which makes `Zz` — the key produced by dragging an
--    item to the *top* of a list — sort last. The data-model lane reproduced
--    that against a real Postgres 16.
--
--    The trap: PGlite's default collation is already byte-wise, so the bug
--    **cannot reproduce locally**. A suite run against PGlite alone would pass
--    with the collation omitted and the deployment would silently mis-sort.
--    Declaring it on the column makes both engines correct and makes the
--    intent visible; it is the one place where "PGlite matches production" is
--    not self-evidently true, so it is stated rather than relied upon.
--
-- 3. **Enums are real types.** Linear ships several of these as bare `String!`
--    (`WorkflowState.type`, `Team.issueEstimationType`), with the legal values
--    only in a docstring. Making them Postgres enums means a bad value is a
--    write error rather than a rendering bug six screens away.
-- ---------------------------------------------------------------------------

-- ============================================================== enums ======

do $$ begin
  create type workflow_state_type as enum
    ('triage','backlog','unstarted','started','completed','canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_state as enum
    ('backlog','planned','started','paused','completed','canceled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_health as enum ('onTrack','atRisk','offTrack');
exception when duplicate_object then null; end $$;

do $$ begin
  create type workspace_role as enum ('owner','admin','member','guest');
exception when duplicate_object then null; end $$;

do $$ begin
  create type team_role as enum ('admin','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type project_role as enum ('lead','member');
exception when duplicate_object then null; end $$;

do $$ begin
  create type estimation_scale as enum
    ('notUsed','exponential','fibonacci','linear','tShirt');
exception when duplicate_object then null; end $$;

do $$ begin
  create type issue_relation_type as enum
    ('blocks','blocked_by','related','duplicate','duplicate_of');
exception when duplicate_object then null; end $$;

do $$ begin
  create type invite_status as enum ('pending','accepted','revoked','expired');
exception when duplicate_object then null; end $$;

-- ============================================================ identity =====

create table if not exists users (
  id             text primary key,
  email          text        not null,
  password_hash  text        not null,
  name           text        not null,
  display_name   text        not null,
  avatar_url     text,
  avatar_color   text        not null default '#5e6ad2',
  active         boolean     not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- Case-insensitive uniqueness without `citext`, which PGlite does not ship.
-- Every lookup must use the same `lower()` expression or it will not use this
-- index — and, worse, `David@x.com` and `david@x.com` would both register.
create unique index if not exists users_email_lower_key on users (lower(email));

create table if not exists sessions (
  id           text primary key,
  user_id      text        not null references users(id) on delete cascade,
  -- The session cookie carries a signed JWT; this row is the revocation
  -- record. Storing a hash rather than the token means a database dump cannot
  -- be replayed as a set of live sessions.
  token_hash   text        not null unique,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz
);

create index if not exists sessions_user_idx on sessions (user_id)
  where revoked_at is null;
create index if not exists sessions_expiry_idx on sessions (expires_at);

-- =========================================================== workspaces ====

create table if not exists workspaces (
  id                   text primary key,
  name                 text        not null,
  url_key              text        not null,
  logo_url             text,
  allow_join_by_domain boolean     not null default false,
  allowed_domain       text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create unique index if not exists workspaces_url_key_lower_key
  on workspaces (lower(url_key));

create table if not exists workspace_members (
  workspace_id text           not null references workspaces(id) on delete cascade,
  user_id      text           not null references users(id) on delete cascade,
  role         workspace_role not null default 'member',
  joined_at    timestamptz    not null default now(),
  primary key (workspace_id, user_id)
);

create index if not exists workspace_members_user_idx
  on workspace_members (user_id);

-- The last-owner rule is enforced in a transaction that locks the workspace
-- row, not here: a partial unique index can require *at most* one of a thing,
-- never *at least* one. See `domain/services/membership.ts`.
create index if not exists workspace_members_owner_idx
  on workspace_members (workspace_id) where role = 'owner';

create table if not exists invites (
  id             text          primary key,
  workspace_id   text          not null references workspaces(id) on delete cascade,
  email          text,
  role           workspace_role not null default 'member',
  team_ids       text[]        not null default '{}',
  token_hash     text          not null unique,
  invited_by_id  text          not null references users(id) on delete cascade,
  status         invite_status not null default 'pending',
  created_at     timestamptz   not null default now(),
  expires_at     timestamptz   not null,
  accepted_at    timestamptz,
  accepted_by_id text          references users(id) on delete set null
);

create index if not exists invites_workspace_idx
  on invites (workspace_id, status);

-- ================================================================ teams ====

create table if not exists teams (
  id               text             primary key,
  workspace_id     text             not null references workspaces(id) on delete cascade,
  name             text             not null,
  key              text             not null,
  description      text,
  icon             text             not null default 'Squares',
  color            text             not null default '#5e6ad2',
  private          boolean          not null default false,
  triage_enabled   boolean          not null default false,
  estimation_scale estimation_scale not null default 'notUsed',
  -- The allocator for `issues.number`. Bumped inside the same transaction as
  -- the insert, with `returning`, so two concurrent creates cannot collide.
  issue_counter    integer          not null default 0,
  created_at       timestamptz      not null default now(),
  updated_at       timestamptz      not null default now()
);

-- `ENG` and `eng` would render the same identifier, so uniqueness is
-- case-insensitive even though the key is stored uppercase.
create unique index if not exists teams_workspace_key_lower_key
  on teams (workspace_id, lower(key));

create table if not exists team_members (
  team_id   text        not null references teams(id) on delete cascade,
  user_id   text        not null references users(id) on delete cascade,
  role      team_role   not null default 'member',
  joined_at timestamptz not null default now(),
  primary key (team_id, user_id)
);

create index if not exists team_members_user_idx on team_members (user_id);

-- ===================================================== workflow states =====

create table if not exists workflow_states (
  id          text                primary key,
  team_id     text                not null references teams(id) on delete cascade,
  name        text                not null,
  type        workflow_state_type not null,
  color       text                not null,
  description text,
  -- A float is fine here, unlike issue ordering: the set is 5–10 rows per
  -- team, reordered only by an admin in a settings screen, where renumbering
  -- the whole list is free.
  position    double precision    not null default 0,
  created_at  timestamptz         not null default now()
);

create index if not exists workflow_states_team_idx
  on workflow_states (team_id, position);
create unique index if not exists workflow_states_team_name_key
  on workflow_states (team_id, lower(name));

-- =============================================================== labels ====

create table if not exists labels (
  id           text        primary key,
  workspace_id text        not null references workspaces(id) on delete cascade,
  -- Null means a workspace-wide label; set means team-scoped.
  team_id      text        references teams(id) on delete cascade,
  name         text        not null,
  color        text        not null,
  description  text,
  -- A label group is a label with children; children are mutually exclusive.
  parent_id    text        references labels(id) on delete set null,
  created_at   timestamptz not null default now()
);

create index if not exists labels_workspace_idx on labels (workspace_id);
create index if not exists labels_team_idx on labels (team_id);
create index if not exists labels_parent_idx on labels (parent_id);

-- ============================================================= projects ====

create table if not exists projects (
  id           text          primary key,
  workspace_id text          not null references workspaces(id) on delete cascade,
  name         text          not null,
  slug_id      text          not null,
  description  text          not null default '',
  summary      text          not null default '',
  icon         text          not null default 'Cube',
  color        text          not null default '#5e6ad2',
  state        project_state not null default 'backlog',
  -- Health is the lead's judgement, written only by a project update; state is
  -- where the work actually is. Linear keeps them separate and never derives
  -- either from the issue list.
  health       project_health,
  lead_id      text          references users(id) on delete set null,
  start_date   date,
  target_date  date,
  sort_order   text collate "C" not null,
  created_at   timestamptz   not null default now(),
  updated_at   timestamptz   not null default now(),
  completed_at timestamptz,
  canceled_at  timestamptz,
  archived_at  timestamptz
);

create unique index if not exists projects_slug_key
  on projects (workspace_id, slug_id);
create index if not exists projects_workspace_idx
  on projects (workspace_id, sort_order);

create table if not exists project_teams (
  project_id text not null references projects(id) on delete cascade,
  team_id    text not null references teams(id) on delete cascade,
  primary key (project_id, team_id)
);

create index if not exists project_teams_team_idx on project_teams (team_id);

create table if not exists project_members (
  project_id text         not null references projects(id) on delete cascade,
  user_id    text         not null references users(id) on delete cascade,
  role       project_role not null default 'member',
  joined_at  timestamptz  not null default now(),
  primary key (project_id, user_id)
);

create index if not exists project_members_user_idx on project_members (user_id);

create table if not exists project_milestones (
  id          text        primary key,
  project_id  text        not null references projects(id) on delete cascade,
  name        text        not null,
  description text,
  target_date date,
  sort_order  text collate "C" not null,
  created_at  timestamptz not null default now()
);

create index if not exists project_milestones_project_idx
  on project_milestones (project_id, sort_order);

create table if not exists project_updates (
  id         text           primary key,
  project_id text           not null references projects(id) on delete cascade,
  user_id    text           not null references users(id) on delete cascade,
  body       text           not null,
  health     project_health not null,
  created_at timestamptz    not null default now()
);

create index if not exists project_updates_project_idx
  on project_updates (project_id, created_at desc);

-- =============================================================== issues ====

create table if not exists issues (
  id            text        primary key,
  team_id       text        not null references teams(id) on delete cascade,
  -- Unique per team, allocated from `teams.issue_counter`, never reused.
  number        integer     not null,
  title         text        not null,
  description   text        not null default '',
  state_id      text        not null references workflow_states(id),
  -- 0 = No priority, 1 = Urgent … 4 = Low. Note that 0 must sort *last*;
  -- `order by priority asc` is wrong, which is why every query orders by the
  -- rank expression in `domain/sorting.ts` instead.
  priority      smallint    not null default 0
                  check (priority between 0 and 4),
  assignee_id   text        references users(id) on delete set null,
  creator_id    text        not null references users(id),
  project_id    text        references projects(id) on delete set null,
  milestone_id  text        references project_milestones(id) on delete set null,
  parent_id     text        references issues(id) on delete set null,
  estimate      smallint,
  due_date      date,

  -- Manual order. `collate "C"` is load-bearing — see the header.
  sort_order            text collate "C" not null,
  sub_issue_sort_order  text collate "C",

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Category-transition stamps. Set on entering the category and **cleared on
  -- leaving it**, so a Done → In Progress move nulls `completed_at`.
  -- `started_at` alone is first-write-wins, so cycle time measures from first
  -- pickup rather than from the most recent one.
  started_at    timestamptz,
  completed_at  timestamptz,
  canceled_at   timestamptz,
  triaged_at    timestamptz,
  archived_at   timestamptz,
  trashed_at    timestamptz
);

create unique index if not exists issues_team_number_key
  on issues (team_id, number);

-- The main list query: a team's issues, ordered manually, excluding the
-- archived and trashed. Partial so the index stays small as issues close.
create index if not exists issues_team_sort_idx
  on issues (team_id, sort_order)
  where archived_at is null and trashed_at is null;

create index if not exists issues_state_idx on issues (state_id);
create index if not exists issues_assignee_idx on issues (assignee_id)
  where archived_at is null and trashed_at is null;
create index if not exists issues_project_idx on issues (project_id)
  where archived_at is null and trashed_at is null;
create index if not exists issues_parent_idx on issues (parent_id);
create index if not exists issues_creator_idx on issues (creator_id);
create index if not exists issues_updated_idx on issues (updated_at desc);

create table if not exists issue_labels (
  issue_id text not null references issues(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  primary key (issue_id, label_id)
);

create index if not exists issue_labels_label_idx on issue_labels (label_id);

create table if not exists issue_relations (
  id               text                primary key,
  issue_id         text                not null references issues(id) on delete cascade,
  related_issue_id text                not null references issues(id) on delete cascade,
  type             issue_relation_type not null,
  created_at       timestamptz         not null default now(),
  -- An issue cannot block itself.
  check (issue_id <> related_issue_id)
);

-- One row per direction pair. The inverse is *derived* on read rather than
-- stored, so the two halves cannot drift apart.
create unique index if not exists issue_relations_key
  on issue_relations (issue_id, related_issue_id, type);
create index if not exists issue_relations_related_idx
  on issue_relations (related_issue_id);

create table if not exists issue_subscribers (
  issue_id     text        not null references issues(id) on delete cascade,
  user_id      text        not null references users(id) on delete cascade,
  subscribed_at timestamptz not null default now(),
  primary key (issue_id, user_id)
);

-- ============================================================= comments ====

create table if not exists comments (
  id         text        primary key,
  issue_id   text        not null references issues(id) on delete cascade,
  user_id    text        not null references users(id) on delete cascade,
  body       text        not null,
  -- Set for a threaded reply. One level only: replying to a reply attaches to
  -- the same thread root, which is what Linear does.
  parent_id  text        references comments(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  edited_at  timestamptz
);

create index if not exists comments_issue_idx on comments (issue_id, created_at);
create index if not exists comments_parent_idx on comments (parent_id);

create table if not exists reactions (
  id         text        primary key,
  comment_id text        references comments(id) on delete cascade,
  issue_id   text        references issues(id) on delete cascade,
  user_id    text        not null references users(id) on delete cascade,
  emoji      text        not null,
  created_at timestamptz not null default now(),
  -- Exactly one target.
  check ((comment_id is null) <> (issue_id is null))
);

create unique index if not exists reactions_comment_key
  on reactions (comment_id, user_id, emoji) where comment_id is not null;
create unique index if not exists reactions_issue_key
  on reactions (issue_id, user_id, emoji) where issue_id is not null;

-- ============================================================= activity ====

-- One table with a discriminated JSON payload rather than a column per
-- tracked field. Linear's own `IssueHistory` has ~70 `from*`/`to*` columns
-- plus a `changes` JSON escape hatch, and their newer `ProjectHistory` is
-- fully generic — they moved in this direction themselves.
--
-- `payload` carries both the id and the display label of each side, so an
-- entry still reads correctly after the state or label it names is renamed or
-- deleted.
create table if not exists activities (
  id         text        primary key,
  issue_id   text        not null references issues(id) on delete cascade,
  user_id    text        not null references users(id) on delete cascade,
  type       text        not null,
  payload    jsonb       not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activities_issue_idx
  on activities (issue_id, created_at);

-- ======================================================== notifications ====

create table if not exists notifications (
  id               text        primary key,
  user_id          text        not null references users(id) on delete cascade,
  type             text        not null,
  issue_id         text        references issues(id) on delete cascade,
  comment_id       text        references comments(id) on delete cascade,
  project_id       text        references projects(id) on delete cascade,
  actor_id         text        not null references users(id) on delete cascade,
  read_at          timestamptz,
  snoozed_until_at timestamptz,
  created_at       timestamptz not null default now()
);

-- The Inbox query: one user's unread notifications, newest first.
create index if not exists notifications_user_idx
  on notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx
  on notifications (user_id) where read_at is null;

-- ============================================================== views ======

create table if not exists saved_views (
  id           text        primary key,
  workspace_id text        not null references workspaces(id) on delete cascade,
  team_id      text        references teams(id) on delete cascade,
  owner_id     text        not null references users(id) on delete cascade,
  name         text        not null,
  description  text,
  icon         text        not null default 'Layers',
  color        text        not null default '#5e6ad2',
  filter       jsonb       not null default '{}'::jsonb,
  display      jsonb       not null default '{}'::jsonb,
  shared       boolean     not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists saved_views_workspace_idx
  on saved_views (workspace_id);
create index if not exists saved_views_owner_idx on saved_views (owner_id);

create table if not exists favorites (
  id         text        primary key,
  user_id    text        not null references users(id) on delete cascade,
  kind       text        not null,
  target_id  text        not null,
  sort_order text collate "C" not null,
  created_at timestamptz not null default now()
);

create unique index if not exists favorites_key
  on favorites (user_id, kind, target_id);

-- =========================================================== changefeed ====

-- The realtime bus, such as it is.
--
-- A serverless host has nowhere to keep a pub/sub broker, so clients poll a
-- cursor over this table and the server streams from it. One monotonic
-- sequence per workspace is all the ordering a last-write-wins client needs —
-- and Linear's own sync is documented as last-write-wins, not CRDT, so this is
-- the same guarantee rather than a weaker one.
create table if not exists change_events (
  seq          bigserial   primary key,
  workspace_id text        not null references workspaces(id) on delete cascade,
  entity       text        not null,
  entity_id    text        not null,
  action       text        not null,
  actor_id     text        references users(id) on delete set null,
  payload      jsonb       not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists change_events_workspace_idx
  on change_events (workspace_id, seq);
