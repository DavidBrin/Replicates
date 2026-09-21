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
`;
