// GENERATED FILE — do not edit.
//
// Derived from `schema.sql` by `scripts/build-schema.mjs`. Edit the SQL and
// run `npm run build:schema`; `schema.test.ts` fails if the two disagree.
//
// It exists because reading the `.sql` from disk at runtime does not survive
// bundling: on Vercel the working directory is not the repository and the file
// is not traced into the function.

/** The complete schema. Idempotent; safe to re-apply to a live database. */
export const SCHEMA_SQL = `-- Island Empire — persistence schema. Applied idempotently by \`pnpm run
-- db:push\` (Neon, at deploy time) and by the PGlite adapter on first boot.
-- The persistence slice owns this file; keep every statement re-runnable.
--
-- One table. Custom maps are the only server-side state (D23, D38): campaign
-- progress, settings and challenge medals live in localStorage, and the
-- weekly picks are recomputed from the ISO week on every request (D25), so
-- there is no \`challenge_records\` and no "this week" row.
--
-- Ids are nanoids generated in application code: PGlite ships without
-- pgcrypto, so \`gen_random_uuid()\` is not available locally.

CREATE TABLE IF NOT EXISTS maps (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  author      TEXT NOT NULL DEFAULT 'anonymous',
  definition  JSONB NOT NULL,
  players     INTEGER NOT NULL,
  width       INTEGER NOT NULL,
  height      INTEGER NOT NULL,
  biome       TEXT NOT NULL DEFAULT 'grass',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- \`biome\` arrived after the first cut of the table; a database created from
-- that cut gains the column here. Idempotent like everything else.
ALTER TABLE maps ADD COLUMN IF NOT EXISTS biome TEXT NOT NULL DEFAULT 'grass';

-- Listing is newest-first with a keyset cursor on (created_at, id), so the
-- index carries both columns in that order.
CREATE INDEX IF NOT EXISTS maps_created_at_idx ON maps (created_at DESC, id DESC);
`;
