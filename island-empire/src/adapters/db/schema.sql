-- Island Empire — persistence schema. Applied idempotently by `pnpm run
-- db:push` (Neon, at deploy time) and by the PGlite adapter on first boot.
-- The persistence slice owns this file; keep every statement re-runnable.

CREATE TABLE IF NOT EXISTS maps (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'anonymous',
  definition  JSONB NOT NULL,
  players     INTEGER NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maps_created_at_idx ON maps (created_at DESC);
