import { createPGliteDatabase } from "@/adapters/db/pglite";
import type { SqlDatabase } from "@/adapters/db";
import type { SearchDocument } from "@/ports/search-index";

/**
 * A real Postgres for the search suites, and a document factory.
 *
 * Deliberately a second, local copy of a fixture the repositories slice is
 * writing at the same time. Two independent twenty-line helpers now is much
 * cheaper than two slices editing one file concurrently; a later pass can
 * merge them, and until then neither suite can be broken by the other's
 * changes.
 *
 * `:memory:` is what `createPGliteDatabase` maps to `new PGlite()` with no
 * argument — a fresh in-process database per suite with nothing on disk. There
 * is no mock and no SQLite: this adapter is `tsvector`, `ts_rank_cd` and
 * `ts_headline` from top to bottom, so anything that could be faked would be
 * testing the fake.
 */
export async function freshDatabase(): Promise<SqlDatabase> {
  const db = await createPGliteDatabase(":memory:");
  await db.migrate();
  return db;
}

/**
 * A plausible video document, overridable field by field.
 *
 * The defaults are chosen to be *neutral* rather than realistic: no matching
 * text, a middling view count and a fixed publication date, so that a test
 * which overrides one field is varying exactly one signal. A default of zero
 * views would silently pin every document to the bottom of the popularity
 * term and make half the ranking assertions vacuous.
 *
 * The like counts are non-zero for the same reason, and it matters more here
 * than anywhere else: zero votes is a *special case* in the `rating` sort —
 * every unrated document scores exactly 0 — so a default of 0/0 would make
 * every rating assertion an assertion about the tiebreak instead. A test that
 * wants the unrated case asks for it.
 */
export function doc(overrides: Partial<SearchDocument> = {}): SearchDocument {
  return {
    id: "doc-1",
    kind: "video",
    title: "An ordinary upload",
    description: "Nothing in particular happens in this video.",
    channelName: "Some Channel",
    tags: [],
    publishedAt: new Date("2024-06-01T00:00:00.000Z"),
    viewCount: 1_000,
    likeCount: 40,
    dislikeCount: 2,
    durationSeconds: 600,
    ...overrides,
  };
}

/** `n` days before now, as a `Date`. */
export function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

/** The hit ids in the order the engine returned them. */
export function ids(hits: readonly { id: string }[]): string[] {
  return hits.map((hit) => hit.id);
}
