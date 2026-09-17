-- Workspace snapshot table for optional server persistence.
-- Apply once against the database pointed at by DATABASE_URL, e.g.:
--   psql "$DATABASE_URL" -f scripts/schema.sql
-- The app also runs an equivalent CREATE TABLE IF NOT EXISTS on first use
-- so a fresh Neon database works without a separate migrate step.

CREATE TABLE IF NOT EXISTS workspaces (
  id   text PRIMARY KEY,
  data jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
