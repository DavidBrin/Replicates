// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db";
import {
  HIGHLIGHT_END,
  HIGHLIGHT_START,
  PostgresSearchIndex,
  prefixTsQuery,
} from "../postgres";

import { daysAgo, doc, freshDatabase, ids } from "./harness";

/**
 * The adapter against a real PGlite, because there is nothing here that a fake
 * could stand in for: every behaviour worth asserting belongs to Postgres'
 * text search — the stopword list, the stemmer, `websearch_to_tsquery`'s
 * grammar, `ts_rank_cd`'s weights and `ts_headline`'s fragment cutting.
 */

let db: SqlDatabase;
let index: PostgresSearchIndex;

beforeEach(async () => {
  db = await freshDatabase();
  index = new PostgresSearchIndex(db);
});

afterEach(async () => {
  await db.close();
});

const page = { limit: 20, offset: 0 } as const;

describe("indexing", () => {
  it("finds a document by a word in its title", async () => {
    await index.index(doc({ id: "v1", title: "Learning Rust in an afternoon" }));

    const results = await index.query({ text: "rust", ...page });

    expect(ids(results.hits)).toEqual(["v1"]);
    expect(results.total).toBe(1);
  });

  it("stems, so a query in one form finds a title in another", async () => {
    await index.index(doc({ id: "v1", title: "Debugging memory leaks" }));

    const results = await index.query({ text: "debug leak", ...page });

    expect(ids(results.hits)).toEqual(["v1"]);
  });

  it("matches the channel name, the description and the tags", async () => {
    await index.indexMany([
      doc({ id: "channel", channelName: "Fireship" }),
      doc({ id: "description", description: "A word about kubernetes here." }),
      doc({ id: "tags", tags: ["webgpu", "graphics"] }),
    ]);

    expect(ids((await index.query({ text: "fireship", ...page })).hits)) //
      .toEqual(["channel"]);
    expect(ids((await index.query({ text: "kubernetes", ...page })).hits)) //
      .toEqual(["description"]);
    expect(ids((await index.query({ text: "webgpu", ...page })).hits)) //
      .toEqual(["tags"]);
  });

  it("replaces a document rather than duplicating it", async () => {
    await index.index(doc({ id: "v1", title: "Original title about otters" }));
    await index.index(doc({ id: "v1", title: "Revised title about badgers" }));

    expect((await index.query({ text: "otters", ...page })).total).toBe(0);
    expect(ids((await index.query({ text: "badgers", ...page })).hits)) //
      .toEqual(["v1"]);
  });

  it("removes a document", async () => {
    await index.index(doc({ id: "v1", title: "Ephemeral otters" }));
    await index.remove("v1");

    expect((await index.query({ text: "otters", ...page })).total).toBe(0);
  });

  it("removing an absent id is not an error", async () => {
    await expect(index.remove("never-existed")).resolves.toBeUndefined();
  });

  it("indexMany accepts an empty batch without opening a transaction", async () => {
    await expect(index.indexMany([])).resolves.toBeUndefined();
  });

  /**
   * `schema.sql` is applied unconditionally on boot, so it has to be free to
   * re-run — every statement in it is `create … if not exists`. Asserted here
   * rather than trusted because `search_documents` is the one table this slice
   * owns, and a column added to it in a way that is not idempotent breaks
   * every boot after the first rather than the boot that introduced it.
   */
  it("re-applies the schema without error and without losing data", async () => {
    await index.index(doc({ id: "v1", title: "Persistent otters" }));

    await db.migrate();
    await db.migrate();

    expect(ids((await index.query({ text: "otters", ...page })).hits)) //
      .toEqual(["v1"]);

    const columns = await db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_name = 'search_documents'`,
    );
    const names = columns.map((c) => c.column_name);
    expect(names).toContain("like_count");
    expect(names).toContain("dislike_count");
  });

  /**
   * The highlight delimiters are control characters precisely so a document
   * cannot contain one. That is only true because they are stripped on the way
   * in — without this, an uploader could put U+0002 in a description and have
   * every search result render a bolded run they chose.
   */
  it("strips the highlight delimiters out of indexed text", async () => {
    await index.index(
      doc({
        id: "v1",
        title: `Forged ${HIGHLIGHT_START}highlight${HIGHLIGHT_END} attempt`,
        description: `Prefix ${HIGHLIGHT_START}injected${HIGHLIGHT_END} otters follow`,
      }),
    );

    const rows = await db.query<{ title: string; description: string }>(
      "select title, description from search_documents where id = $1",
      ["v1"],
    );

    expect(rows[0]?.title).toBe("Forged highlight attempt");
    expect(rows[0]?.description).not.toContain(HIGHLIGHT_START);

    const results = await index.query({ text: "otters", ...page });
    expect(results.hits[0]?.highlight).not.toContain("injected" + HIGHLIGHT_END);
  });
});

describe("query parsing", () => {
  beforeEach(async () => {
    await index.indexMany([
      doc({ id: "ml", title: "Machine learning from scratch" }),
      doc({ id: "split", title: "Learning to build a machine shop" }),
      doc({ id: "py", title: "Machine learning with python" }),
    ]);
  });

  /**
   * The case that must not 500. `websearch_to_tsquery('english', 'the a of')`
   * is the *empty* tsquery, and the empty tsquery matches nothing — so this
   * comes back as a legitimately empty result rather than as an error or, far
   * worse, as the whole corpus.
   */
  it("returns nothing for a query of only stopwords", async () => {
    const results = await index.query({ text: "the a of", ...page });

    expect(results.hits).toEqual([]);
    expect(results.total).toBe(0);
    expect(results.correction).toBeNull();
  });

  it("returns nothing for an empty or whitespace-only query", async () => {
    expect(await index.query({ text: "", ...page })).toEqual({
      hits: [],
      total: 0,
      correction: null,
    });
    expect((await index.query({ text: "   \n\t ", ...page })).total).toBe(0);
  });

  it("treats a quoted phrase as a phrase", async () => {
    const results = await index.query({ text: '"machine learning"', ...page });

    expect(ids(results.hits).sort()).toEqual(["ml", "py"]);
  });

  it("excludes documents matching a -term", async () => {
    const results = await index.query({
      text: '"machine learning" -python',
      ...page,
    });

    expect(ids(results.hits)).toEqual(["ml"]);
  });

  it("ANDs bare words, so both must appear somewhere", async () => {
    const results = await index.query({ text: "machine python", ...page });

    expect(ids(results.hits)).toEqual(["py"]);
  });

  it("does not throw on tsquery metacharacters in the query text", async () => {
    for (const text of ["&&&", "a & b", "!", "(((", "rust:*", "'", "|||"]) {
      await expect(index.query({ text, ...page })).resolves.toBeDefined();
    }
  });
});

describe("field weighting", () => {
  /**
   * The property the weights exist for. Both documents are identical apart
   * from *where* the word appears, so text rank is the only signal that
   * differs and the title match must win.
   */
  it("ranks a title match above a description-only match", async () => {
    await index.indexMany([
      doc({
        id: "in-title",
        title: "Kayaking the fjords",
        description: "A trip report with photographs.",
      }),
      doc({
        id: "in-description",
        title: "A trip report with photographs",
        description: "Kayaking the fjords, filmed over a week.",
      }),
    ]);

    const results = await index.query({ text: "kayaking", ...page });

    expect(ids(results.hits)).toEqual(["in-title", "in-description"]);
  });

  it("ranks title above channel above description above tags", async () => {
    const term = "aurora";
    await index.indexMany([
      doc({ id: "title", title: `${term} timelapse` }),
      doc({ id: "channel", channelName: `${term} Films` }),
      doc({ id: "description", description: `Shot during the ${term}.` }),
      doc({ id: "tags", tags: [term, "night"] }),
    ]);

    const results = await index.query({ text: term, ...page });

    expect(ids(results.hits)).toEqual([
      "title",
      "channel",
      "description",
      "tags",
    ]);
  });
});

describe("filters", () => {
  beforeEach(async () => {
    await index.indexMany([
      doc({
        id: "video",
        kind: "video",
        title: "Aurora over Tromso",
        durationSeconds: 120,
        publishedAt: daysAgo(2),
      }),
      doc({
        id: "channel",
        kind: "channel",
        title: "Aurora Films",
        durationSeconds: 0,
        publishedAt: daysAgo(900),
      }),
      doc({
        id: "playlist",
        kind: "playlist",
        title: "Aurora playlist",
        durationSeconds: 0,
        publishedAt: daysAgo(400),
      }),
      doc({
        id: "medium",
        title: "Aurora explained",
        durationSeconds: 600,
        publishedAt: daysAgo(40),
      }),
      doc({
        id: "long",
        title: "Aurora, the full lecture",
        durationSeconds: 3600,
        publishedAt: daysAgo(1200),
      }),
    ]);
  });

  const aurora = { text: "aurora", ...page } as const;

  it("filters by kind", async () => {
    const results = await index.query({ ...aurora, filters: { kind: "video" } });

    expect(ids(results.hits).sort()).toEqual(["long", "medium", "video"]);
    expect(results.total).toBe(3);
  });

  it("filters by upload date", async () => {
    const results = await index.query({
      ...aurora,
      filters: { uploadedAfter: daysAgo(100) },
    });

    expect(ids(results.hits).sort()).toEqual(["medium", "video"]);
  });

  it("filters by each duration bucket", async () => {
    const bucket = async (duration: "under4" | "4to20" | "over20") =>
      ids((await index.query({ ...aurora, filters: { duration } })).hits).sort();

    expect(await bucket("under4")).toEqual(["video"]);
    expect(await bucket("4to20")).toEqual(["medium"]);
    expect(await bucket("over20")).toEqual(["long"]);
  });

  /**
   * A channel has no duration, so it belongs to no duration bucket. Without
   * the `> 0` guard on `under4` every channel in the corpus would answer
   * "under 4 minutes".
   */
  it("excludes documents with no duration from every duration bucket", async () => {
    for (const duration of ["under4", "4to20", "over20"] as const) {
      const results = await index.query({ ...aurora, filters: { duration } });
      expect(ids(results.hits)).not.toContain("channel");
      expect(ids(results.hits)).not.toContain("playlist");
    }
  });

  it("puts the bucket boundaries at exactly 4:00 and 20:00", async () => {
    await index.indexMany([
      doc({ id: "at-4", title: "Aurora at four", durationSeconds: 240 }),
      doc({ id: "at-20", title: "Aurora at twenty", durationSeconds: 1200 }),
    ]);

    const inBucket = async (duration: "under4" | "4to20" | "over20") =>
      ids((await index.query({ ...aurora, filters: { duration } })).hits);

    expect(await inBucket("under4")).not.toContain("at-4");
    expect(await inBucket("4to20")).toContain("at-4");
    expect(await inBucket("4to20")).toContain("at-20");
    expect(await inBucket("over20")).not.toContain("at-20");
  });

  it("combines filters", async () => {
    const results = await index.query({
      ...aurora,
      filters: {
        kind: "video",
        duration: "over20",
        uploadedAfter: daysAgo(2000),
      },
    });

    expect(ids(results.hits)).toEqual(["long"]);
  });

  it("counts only the filtered rows in total", async () => {
    const unfiltered = await index.query(aurora);
    const filtered = await index.query({
      ...aurora,
      filters: { kind: "video" },
    });

    expect(unfiltered.total).toBe(5);
    expect(filtered.total).toBe(3);
  });
});

describe("sorting", () => {
  beforeEach(async () => {
    await index.indexMany([
      doc({
        id: "oldest",
        title: "Sourdough, the original",
        viewCount: 9_000_000,
        publishedAt: daysAgo(2000),
      }),
      doc({
        id: "middle",
        title: "Sourdough revisited",
        viewCount: 10,
        publishedAt: daysAgo(200),
      }),
      doc({
        id: "newest",
        title: "Sourdough again",
        viewCount: 500,
        publishedAt: daysAgo(1),
      }),
    ]);
  });

  const sourdough = { text: "sourdough", ...page } as const;

  it("sorts by date, newest first", async () => {
    const results = await index.query({ ...sourdough, sort: "date" });

    expect(ids(results.hits)).toEqual(["newest", "middle", "oldest"]);
  });

  it("sorts by views, most first", async () => {
    const results = await index.query({ ...sourdough, sort: "views" });

    expect(ids(results.hits)).toEqual(["oldest", "newest", "middle"]);
  });

  it("sorts by relevance when no sort is given", async () => {
    const explicit = await index.query({ ...sourdough, sort: "relevance" });
    const defaulted = await index.query(sourdough);

    expect(ids(defaulted.hits)).toEqual(ids(explicit.hits));
  });

  /**
   * Every ordering ends `, id asc`. Without it, three documents with equal
   * view counts can come back in a different order per page and pagination
   * stops partitioning the result set — a row appears twice, another never.
   */
  it("is stable across pages when the sort key ties", async () => {
    await index.indexMany(
      Array.from({ length: 6 }, (_, n) =>
        doc({ id: `tie-${n}`, title: "Sourdough tie", viewCount: 0 }),
      ),
    );

    const first = await index.query({
      ...sourdough,
      sort: "views",
      limit: 4,
      offset: 0,
    });
    const second = await index.query({
      ...sourdough,
      sort: "views",
      limit: 4,
      offset: 4,
    });

    const seen = [...ids(first.hits), ...ids(second.hits)];
    expect(seen).toHaveLength(8);
    expect(new Set(seen).size).toBe(8);
  });
});

describe("the rating sort", () => {
  /**
   * Five documents whose naive like ratios order them almost backwards from
   * their Wilson lower bounds. The measured values, at z = 1.96:
   *
   *   well-liked   10000 + /   3 −    naive 0.9997   wilson 0.9991
   *   mixed           60 + /  40 −    naive 0.6000   wilson 0.5020
   *   one-vote         1 + /   0 −    naive 1.0000   wilson 0.2065
   *   disliked         2 + / 200 −    naive 0.0099   wilson 0.0027
   *   unrated          0 + /   0 −    naive 0.0000   wilson 0.0000
   *
   * Under the naive ratio `one-vote` comes first and `well-liked` second; the
   * assertion below is exactly the inversion of that, so it cannot pass
   * against `likes / (likes + dislikes)`. Verified by mutation rather than by
   * inspection.
   */
  beforeEach(async () => {
    await index.indexMany([
      doc({ id: "one-vote", title: "Chai", likeCount: 1, dislikeCount: 0 }),
      doc({
        id: "well-liked",
        title: "Chai",
        likeCount: 10_000,
        dislikeCount: 3,
      }),
      doc({ id: "mixed", title: "Chai", likeCount: 60, dislikeCount: 40 }),
      doc({ id: "unrated", title: "Chai", likeCount: 0, dislikeCount: 0 }),
      doc({ id: "disliked", title: "Chai", likeCount: 2, dislikeCount: 200 }),
    ]);
  });

  const chai = { text: "chai", sort: "rating", ...page } as const;

  it("orders by a confidence bound, not by the raw like ratio", async () => {
    const results = await index.query(chai);

    expect(ids(results.hits)).toEqual([
      "well-liked",
      "mixed",
      "one-vote",
      "disliked",
      "unrated",
    ]);
  });

  it("does not let a single unopposed like reach the top", async () => {
    const results = await index.query(chai);

    expect(ids(results.hits).indexOf("one-vote")).toBeGreaterThan(
      ids(results.hits).indexOf("well-liked"),
    );
    expect(ids(results.hits).indexOf("one-vote")).toBeGreaterThan(
      ids(results.hits).indexOf("mixed"),
    );
  });

  /**
   * More votes at the same ratio is more evidence, so it must rank higher — the
   * property that a raw ratio cannot express at all, since all three of these
   * are exactly 1.0.
   */
  it("prefers the larger sample when the ratio is identical", async () => {
    await index.indexMany([
      doc({ id: "ten", title: "Chai perfect", likeCount: 10, dislikeCount: 0 }),
      doc({
        id: "hundred",
        title: "Chai perfect",
        likeCount: 100,
        dislikeCount: 0,
      }),
      doc({
        id: "thousand",
        title: "Chai perfect",
        likeCount: 1_000,
        dislikeCount: 0,
      }),
    ]);

    const results = await index.query({
      text: "chai perfect",
      sort: "rating",
      ...page,
    });

    expect(ids(results.hits)).toEqual(["thousand", "hundred", "ten"]);
  });

  /**
   * A lower bound rewards evidence over absence, so two likes against two
   * hundred dislikes still edges above a video nobody has voted on. Written
   * down as a decision rather than left to be filed as a bug: inverting it
   * would mean claiming to know something about the unrated video.
   */
  it("puts a badly-rated video above an unrated one", async () => {
    const results = await index.query(chai);
    const order = ids(results.hits);

    expect(order.indexOf("disliked")).toBeLessThan(order.indexOf("unrated"));
  });

  /**
   * Zero votes is the common case in a real corpus, so the bottom of this sort
   * is a large block of exact ties. `view_count desc` before `id asc` is what
   * stops that block rendering as an id-ordered list.
   */
  it("breaks ties among unrated documents by popularity", async () => {
    await index.indexMany([
      doc({
        id: "quiet",
        title: "Chai new",
        likeCount: 0,
        dislikeCount: 0,
        viewCount: 10,
      }),
      doc({
        id: "watched",
        title: "Chai new",
        likeCount: 0,
        dislikeCount: 0,
        viewCount: 900_000,
      }),
    ]);

    const results = await index.query({
      text: "chai new",
      sort: "rating",
      ...page,
    });

    expect(ids(results.hits)).toEqual(["watched", "quiet"]);
  });

  /**
   * Votes are the one field on a search document that moves constantly, so the
   * upsert has to carry *both* counts on every re-index. Dropping
   * `dislike_count` from the update list is invisible to a test that only ever
   * adds likes — the mutation stays green — so this one review-bombs a
   * well-liked video and asserts it falls, which requires the new dislike
   * count to have actually landed.
   */
  it("re-indexing updates both vote counts, not just the likes", async () => {
    await index.index(
      doc({
        id: "well-liked",
        title: "Chai",
        likeCount: 10_000,
        dislikeCount: 100_000,
      }),
    );

    const results = await index.query(chai);

    expect(ids(results.hits)).toEqual([
      "mixed",
      "one-vote",
      "well-liked",
      "disliked",
      "unrated",
    ]);
  });

  it("pages the rating order without repeating or dropping a document", async () => {
    const first = await index.query({ ...chai, limit: 2, offset: 0 });
    const second = await index.query({ ...chai, limit: 2, offset: 2 });
    const third = await index.query({ ...chai, limit: 2, offset: 4 });

    const seen = [
      ...ids(first.hits),
      ...ids(second.hits),
      ...ids(third.hits),
    ];
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    expect(first.total).toBe(5);
  });
});

describe("pagination and total", () => {
  beforeEach(async () => {
    await index.indexMany(
      Array.from({ length: 7 }, (_, n) =>
        doc({
          id: `p${n}`,
          title: `Pancake recipe number ${n}`,
          viewCount: 1_000 - n,
        }),
      ),
    );
  });

  const pancake = { text: "pancake", sort: "views" } as const;

  it("returns the requested slice with the whole total", async () => {
    const results = await index.query({ ...pancake, limit: 3, offset: 0 });

    expect(ids(results.hits)).toEqual(["p0", "p1", "p2"]);
    expect(results.total).toBe(7);
  });

  it("returns the tail slice", async () => {
    const results = await index.query({ ...pancake, limit: 3, offset: 6 });

    expect(ids(results.hits)).toEqual(["p6"]);
    expect(results.total).toBe(7);
  });

  /**
   * The reason `total` is joined on rather than read off a hit. `count(*)
   * over ()` rides on the rows, and an offset past the end has no rows.
   */
  it("returns an empty page with a correct total past the end", async () => {
    const results = await index.query({ ...pancake, limit: 3, offset: 99 });

    expect(results.hits).toEqual([]);
    expect(results.total).toBe(7);
  });

  it("returns zero hits and zero total when nothing matches", async () => {
    const results = await index.query({
      text: "waffle",
      limit: 10,
      offset: 0,
    });

    expect(results.hits).toEqual([]);
    expect(results.total).toBe(0);
  });

  it("accepts a zero limit and still reports the total", async () => {
    const results = await index.query({ ...pancake, limit: 0, offset: 0 });

    expect(results.hits).toEqual([]);
    expect(results.total).toBe(7);
  });

  it("clamps a negative limit or offset rather than letting Postgres refuse", async () => {
    const results = await index.query({ ...pancake, limit: -5, offset: -5 });

    expect(results.hits).toEqual([]);
    expect(results.total).toBe(7);
  });

  it("caps an absurd page size", async () => {
    const results = await index.query({
      ...pancake,
      limit: 1_000_000,
      offset: 0,
    });

    expect(results.hits).toHaveLength(7);
  });
});

describe("highlighting", () => {
  it("marks the matched terms inside the fragment", async () => {
    await index.index(
      doc({
        id: "v1",
        title: "A morning in the workshop",
        description:
          "We spend a long time on the dovetail joint, then sharpen the " +
          "chisels and talk about grain direction for a while.",
      }),
    );

    const results = await index.query({ text: "dovetail", ...page });
    const highlight = results.hits[0]?.highlight;

    expect(highlight).toContain(`${HIGHLIGHT_START}dovetail${HIGHLIGHT_END}`);
  });

  it("cuts a fragment rather than returning the whole description", async () => {
    const filler = "words ".repeat(200);
    await index.index(
      doc({ id: "v1", description: `${filler} dovetail ${filler}` }),
    );

    const results = await index.query({ text: "dovetail", ...page });
    const highlight = results.hits[0]?.highlight ?? "";

    expect(highlight.length).toBeGreaterThan(0);
    expect(highlight.length).toBeLessThan(400);
  });

  /**
   * `ts_headline` never refuses: asked to highlight a description that does
   * not contain the term, it hands back the opening words unmarked. That is a
   * fragment but not a highlight, and the port's `null` is what says so.
   */
  it("is null when the match was in the title and not the description", async () => {
    await index.index(
      doc({
        id: "v1",
        title: "Dovetail joints by hand",
        description: "A quiet workshop session with no narration at all.",
      }),
    );

    const results = await index.query({ text: "dovetail", ...page });

    expect(results.hits[0]?.highlight).toBeNull();
  });

  it("is null when the document has no description", async () => {
    await index.index(doc({ id: "v1", title: "Dovetails", description: "" }));

    const results = await index.query({ text: "dovetail", ...page });

    expect(results.hits[0]?.highlight).toBeNull();
  });
});

describe("scores", () => {
  it("are inside [0, 1] and ordered with the hits", async () => {
    await index.indexMany([
      doc({ id: "strong", title: "Ferment everything", viewCount: 5_000_000 }),
      doc({ id: "weak", description: "ferment", viewCount: 1 }),
    ]);

    const results = await index.query({ text: "ferment", ...page });
    const scores = results.hits.map((hit) => hit.score);

    expect(scores).toHaveLength(2);
    for (const score of scores) {
      expect(score).toBeGreaterThan(0);
      expect(score).toBeLessThanOrEqual(1);
      expect(Number.isFinite(score)).toBe(true);
    }
    expect(scores[0]).toBeGreaterThan(scores[1] ?? 0);
  });

  /**
   * A publication date in the future raises 0.5 to a negative power, so the
   * freshness term runs away rather than saturating: five years ahead is a
   * factor of 32, which alone is worth more than a perfect score on all three
   * axes. Clock skew between the app and the database is enough to produce a
   * small one, and a scheduled premiere is a large one on purpose. Without the
   * clamp this document takes the top of every page it appears on — verified
   * by removing the clamp and watching both assertions below fail.
   */
  it("does not let a far-future publication date run the score away", async () => {
    await index.indexMany([
      doc({
        id: "real",
        title: "Ferment everything",
        viewCount: 5_000_000,
        publishedAt: daysAgo(1),
      }),
      doc({
        id: "premiere",
        title: "A quiet week",
        description: "Next month we ferment.",
        viewCount: 1,
        publishedAt: new Date(Date.now() + 5 * 365 * 86_400_000),
      }),
    ]);

    const results = await index.query({ text: "ferment", ...page });

    for (const hit of results.hits) {
      expect(hit.score).toBeLessThanOrEqual(1);
    }
    expect(ids(results.hits)).toEqual(["real", "premiere"]);
  });
});

describe("suggest", () => {
  beforeEach(async () => {
    await index.indexMany([
      doc({ id: "s1", title: "Rust ownership explained", viewCount: 500 }),
      doc({ id: "s2", title: "Rust async in practice", viewCount: 9_000 }),
      doc({ id: "s3", title: "Rusty tools restoration", viewCount: 20 }),
      doc({ id: "s4", title: "Baking bread at home", viewCount: 80_000 }),
    ]);
  });

  it("matches on a prefix, before the word is finished", async () => {
    const suggestions = await index.suggest("rus", 10);

    expect(suggestions).toContain("Rust async in practice");
    expect(suggestions).toContain("Rusty tools restoration");
    expect(suggestions).not.toContain("Baking bread at home");
  });

  it("orders suggestions by popularity", async () => {
    const suggestions = await index.suggest("rust", 10);

    expect(suggestions[0]).toBe("Rust async in practice");
  });

  it("ANDs the completed words and wildcards only the last", async () => {
    expect(await index.suggest("rust asyn", 10)).toEqual([
      "Rust async in practice",
    ]);
    expect(await index.suggest("rust bread", 10)).toEqual([]);
  });

  /**
   * A trap worth pinning rather than discovering. `own` is in Postgres'
   * English stopword list, so `own:*` is dropped from the tsquery entirely and
   * `rust & own:*` reduces to `rust` — four more keystrokes that narrow
   * nothing. There is no fix inside this adapter that would not mean shipping
   * a second stopword list to disagree with the dictionary the vectors were
   * built from; the honest move is to know it.
   *
   * Note it is not the same result as `suggest("rust")`, and the difference is
   * the wildcard rather than the stopword: with a second term present the
   * first one is matched exactly, so "Rusty" drops out.
   */
  it("silently drops a stopword term from a multi-word prefix", async () => {
    expect(await index.suggest("rust own", 10)).toEqual([
      "Rust async in practice",
      "Rust ownership explained",
    ]);
    expect(await index.suggest("rust ownersh", 10)).toEqual([
      "Rust ownership explained",
    ]);
  });

  it("honours the limit, and caps it", async () => {
    expect(await index.suggest("rus", 1)).toHaveLength(1);
    expect(await index.suggest("rus", 0)).toEqual([]);
    expect(await index.suggest("rus", 10_000)).toHaveLength(3);
  });

  /**
   * `to_tsquery` has a grammar, and these are its operators. Unescaped, `&&&`
   * is a hard parse error and `a & b | !c` is boolean logic the user never
   * typed — the two failure modes that make interpolating keystrokes into a
   * tsquery both a crash and an injection.
   */
  it("survives tsquery metacharacters", async () => {
    for (const input of [
      "&&&",
      "rust & bread",
      "rust | bread",
      "!rust",
      "(rust",
      "rust:*",
      "rust'; drop table search_documents; --",
      "<->",
      "rust <2> bread",
      ":",
      "\\",
    ]) {
      await expect(index.suggest(input, 5)).resolves.toBeInstanceOf(Array);
    }

    const still = await db.query<{ n: number }>(
      "select count(*)::int as n from search_documents",
    );
    expect(still[0]?.n).toBe(4);
  });

  it("reads metacharacters as separators, not as operators", async () => {
    // `rust|bread` must mean "both words", which no document has, rather than
    // the tsquery disjunction it looks like — a disjunction would return all
    // four documents. And a trailing `!` must be discarded rather than negate
    // anything, so `rust!` answers exactly as `rust` does: the three documents
    // with a lexeme starting "rust", "Rusty tools" included.
    expect(await index.suggest("rust|bread", 10)).toEqual([]);
    expect(await index.suggest("rust!", 10)).toEqual(
      await index.suggest("rust", 10),
    );
    expect(await index.suggest("rust!", 10)).toHaveLength(3);
  });

  it("returns nothing, without querying, for input with no word characters", async () => {
    for (const input of ["", "   ", "&&&", "!!!", "()", ":::", "'"]) {
      expect(await index.suggest(input, 5)).toEqual([]);
    }
  });

  it("returns nothing for a stopword-only prefix", async () => {
    expect(await index.suggest("the", 5)).toEqual([]);
  });
});

describe("prefixTsQuery", () => {
  it("builds an ANDed query with a wildcard on the last term", () => {
    expect(prefixTsQuery("rust async pat")).toBe("rust & async & pat:*");
  });

  it("wildcards the last term even after a trailing space", () => {
    expect(prefixTsQuery("rust ")).toBe("rust:*");
  });

  it("drops everything that is not a letter or a digit", () => {
    expect(prefixTsQuery("a & b | !c:*")).toBe("a & b & c:*");
    expect(prefixTsQuery("2024's re-cap")).toBe("2024 & s & re & cap:*");
  });

  it("keeps non-ASCII letters", () => {
    expect(prefixTsQuery("café")).toBe("café:*");
  });

  it("is null when nothing survives", () => {
    expect(prefixTsQuery("")).toBeNull();
    expect(prefixTsQuery("  &&& !! ")).toBeNull();
  });

  it("bounds the number and length of terms", () => {
    expect(prefixTsQuery("a b c d e f g h i")?.split(" & ")).toHaveLength(6);
    const long = "x".repeat(200);
    expect(prefixTsQuery(long)).toBe(`${"x".repeat(40)}:*`);
  });
});
