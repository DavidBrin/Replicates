// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SqlDatabase } from "@/adapters/db";
import type { SearchResults } from "@/ports/search-index";
import { PostgresSearchIndex } from "../postgres";

import { daysAgo, doc, freshDatabase, ids } from "./harness";

/**
 * What the blend actually decides.
 *
 * `postgres.test.ts` asserts that search works. This file asserts the part
 * that is a *choice*: relevance, popularity and freshness are three signals
 * that disagree, and 0.6 / 0.25 / 0.15 is an answer to that disagreement
 * rather than a fact about it.
 *
 * Every test here is built the same way — documents constructed so that each
 * signal on its own would crown a different winner — because a test that only
 * checked "the most relevant document came first" would pass against a blend
 * that had been quietly simplified back to `ts_rank_cd`, which is exactly the
 * change these constants exist to prevent.
 *
 * Two of these assertions are deliberately uncomfortable. A stale title match
 * losing to a fresh popular description match is not a bug report; it is the
 * trade, written down, so that the next person to look at it argues with the
 * numbers instead of deleting them.
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

/** Score by id, for the assertions that need the margin and not just the order. */
function scores(results: SearchResults): Record<string, number> {
  return Object.fromEntries(results.hits.map((hit) => [hit.id, hit.score]));
}

describe("the three signals disagree", () => {
  /**
   * One corpus, three documents, one query.
   *
   *   relevance — the term is in the title, and the upload is old and ignored.
   *   popularity — the term is only in the description, and it is a huge hit.
   *   freshness — the term is only in the description, and it went up today.
   *
   * Each wins its own axis outright. The blend has to pick one, and which one
   * it picks is the whole design.
   */
  beforeEach(async () => {
    await index.indexMany([
      doc({
        id: "relevance",
        title: "Sourdough starter, step by step",
        description: "A quiet bake with no narration.",
        viewCount: 300,
        publishedAt: daysAgo(3000),
      }),
      doc({
        id: "popularity",
        title: "Everything I cooked this year",
        description: "Chapter four is the sourdough starter.",
        viewCount: 40_000_000,
        publishedAt: daysAgo(3000),
      }),
      doc({
        id: "freshness",
        title: "This week in the kitchen",
        description: "We finally fed the sourdough starter.",
        viewCount: 300,
        publishedAt: daysAgo(0),
      }),
    ]);
  });

  const query = { text: "sourdough starter", ...page } as const;

  it("each document wins the axis it was built to win", async () => {
    // Popularity, isolated: the `views` sort is text rank's absence.
    expect(ids((await index.query({ ...query, sort: "views" })).hits)[0]) //
      .toBe("popularity");

    // Freshness, isolated.
    expect(ids((await index.query({ ...query, sort: "date" })).hits)[0]) //
      .toBe("freshness");

    // Relevance, isolated: same three documents with the other two signals
    // equalised, so only where the term sits can separate them.
    await index.indexMany([
      doc({ id: "relevance", ...flat, title: "Sourdough starter, step by step" }),
      doc({
        id: "popularity",
        ...flat,
        description: "Chapter four is the sourdough starter.",
      }),
      doc({
        id: "freshness",
        ...flat,
        description: "We finally fed the sourdough starter.",
      }),
    ]);
    expect(ids((await index.query(query)).hits)[0]).toBe("relevance");
  });
});

/** Neutral popularity and freshness, so that only text rank varies. */
const flat = {
  title: "An upload",
  description: "Nothing in particular.",
  viewCount: 1_000,
  publishedAt: daysAgo(30),
} as const;

describe("relevance against freshness and popularity", () => {
  /**
   * The headline requirement, stated as a comparison rather than a rule: with
   * the text signal held equal, the newer and more watched document wins. A
   * ranking that was `ts_rank_cd` alone would return these two in an arbitrary
   * order, because their text ranks are identical.
   */
  it("a fresh popular video beats a stale obscure one with the same match", async () => {
    await index.indexMany([
      doc({
        id: "stale",
        title: "Kimchi at home",
        viewCount: 400,
        publishedAt: daysAgo(3650),
      }),
      doc({
        id: "fresh",
        title: "Kimchi at home",
        viewCount: 4_000_000,
        publishedAt: daysAgo(7),
      }),
    ]);

    const results = await index.query({ text: "kimchi at home", ...page });

    expect(ids(results.hits)).toEqual(["fresh", "stale"]);
  });

  /**
   * And the direction that keeps the search a search: popularity alone does
   * not overturn a title match. Both documents are equally fresh, one is four
   * orders of magnitude more watched, and the title match still wins because
   * text carries 0.6 of the score and views carry 0.25.
   */
  it("a title match beats a description match that is far more popular", async () => {
    await index.indexMany([
      doc({
        id: "title",
        title: "Kimchi at home",
        viewCount: 2_000,
        publishedAt: daysAgo(30),
      }),
      doc({
        id: "description",
        title: "A week of cooking",
        description: "Day three is kimchi at home.",
        viewCount: 40_000_000,
        publishedAt: daysAgo(30),
      }),
    ]);

    const results = await index.query({ text: "kimchi at home", ...page });

    expect(ids(results.hits)).toEqual(["title", "description"]);
  });

  /**
   * The crossover, and the uncomfortable one. Give the description match both
   * of the other signals at once — brand new *and* viral — against a title
   * match that is a decade old and unwatched, and it wins.
   *
   * This is not an accident of the constants; it is what they mean. Text is
   * 0.6 of the score and the gap between a title match and a description match
   * is about 0.3 of the text term, so relevance can put at most ~0.18 between
   * two documents. Popularity and freshness together are worth 0.4. Anyone who
   * wants relevance to be lexicographic has to raise `WEIGHT_TEXT` above 0.77,
   * and at that point popularity and freshness stop doing anything at all.
   */
  it("a fresh viral description match beats an ancient obscure title match", async () => {
    await index.indexMany([
      doc({
        id: "ancient-title",
        title: "Kimchi at home",
        viewCount: 200,
        publishedAt: daysAgo(3650),
      }),
      doc({
        id: "viral-description",
        title: "A week of cooking",
        description: "Day three is kimchi at home.",
        viewCount: 40_000_000,
        publishedAt: daysAgo(1),
      }),
    ]);

    const results = await index.query({ text: "kimchi at home", ...page });

    expect(ids(results.hits)).toEqual(["viral-description", "ancient-title"]);
  });
});

describe("the shape of each signal", () => {
  /**
   * Views are logarithmic and saturating, which is what stops one viral video
   * flattening a page. The step from a thousand to a hundred thousand views
   * must be worth more than the step from ten million to a hundred million.
   */
  it("popularity is logarithmic and saturates", async () => {
    await index.indexMany([
      doc({ id: "thousand", title: "Gnocchi", viewCount: 1_000 }),
      doc({ id: "hundred-k", title: "Gnocchi", viewCount: 100_000 }),
      doc({ id: "ten-m", title: "Gnocchi", viewCount: 10_000_000 }),
      doc({ id: "hundred-m", title: "Gnocchi", viewCount: 100_000_000 }),
    ]);

    const s = scores(await index.query({ text: "gnocchi", ...page }));
    const lowStep = (s["hundred-k"] ?? 0) - (s["thousand"] ?? 0);
    const highStep = (s["hundred-m"] ?? 0) - (s["ten-m"] ?? 0);

    expect(lowStep).toBeGreaterThan(0);
    // Past the saturation point the extra ninety million views buy nothing.
    expect(highStep).toBe(0);
    expect(lowStep).toBeGreaterThan(highStep);
  });

  /**
   * Freshness halves once a year. Not asserted to a tolerance on the decay
   * constant itself — that would be pinning arithmetic — but on the property
   * that makes it a half-life: the drop from new to one year old is about the
   * same as the whole remaining drop from one year to never.
   */
  it("freshness halves each year and never reaches zero", async () => {
    await index.indexMany([
      doc({ id: "today", title: "Gnocchi", publishedAt: daysAgo(0) }),
      doc({ id: "one-year", title: "Gnocchi", publishedAt: daysAgo(365) }),
      doc({ id: "two-year", title: "Gnocchi", publishedAt: daysAgo(730) }),
      doc({ id: "ten-year", title: "Gnocchi", publishedAt: daysAgo(3650) }),
    ]);

    const s = scores(await index.query({ text: "gnocchi", ...page }));
    const first = (s["today"] ?? 0) - (s["one-year"] ?? 0);
    const second = (s["one-year"] ?? 0) - (s["two-year"] ?? 0);

    expect(first).toBeGreaterThan(second);
    expect(second).toBeGreaterThan(0);
    // Halving, so the second year's loss is roughly half the first year's.
    expect(second / first).toBeGreaterThan(0.3);
    expect(second / first).toBeLessThan(0.7);
    // Ten years old still scores, because a decade-old classic is not nothing.
    expect(s["ten-year"] ?? 0).toBeGreaterThan(0);
  });

  /**
   * The three weights sum to one and every term is normalised into [0, 1], so
   * the score is too. That is what makes `SearchHit.score` readable rather than
   * an opaque magnitude, and it is the first thing a change to the blend would
   * break.
   */
  it("keeps the blended score inside [0, 1]", async () => {
    await index.indexMany([
      doc({
        id: "max",
        title: "Gnocchi gnocchi gnocchi",
        description: "gnocchi",
        channelName: "Gnocchi",
        tags: ["gnocchi"],
        viewCount: 1_000_000_000,
        publishedAt: daysAgo(0),
      }),
      doc({
        id: "min",
        title: "A film about potatoes",
        description: "gnocchi",
        viewCount: 0,
        publishedAt: new Date("1970-01-02T00:00:00.000Z"),
      }),
    ]);

    const results = await index.query({ text: "gnocchi", ...page });

    for (const hit of results.hits) {
      expect(hit.score).toBeGreaterThan(0);
      expect(hit.score).toBeLessThan(1);
    }
    expect(scores(results)["max"]).toBeGreaterThan(0.6);
    expect(scores(results)["min"]).toBeLessThan(0.3);
  });
});

describe("the non-relevance sorts ignore the blend entirely", () => {
  /**
   * A blend is only defensible if the caller can opt out of it. `sort=date`
   * must be strictly chronological even when that puts a barely-relevant
   * document first — a user who picked "Upload date" has said what they want.
   */
  it("does not let relevance leak into an explicit sort", async () => {
    await index.indexMany([
      doc({
        id: "perfect-old",
        title: "Focaccia",
        viewCount: 5_000_000,
        publishedAt: daysAgo(500),
      }),
      doc({
        id: "weak-new",
        title: "A month of baking",
        description: "One of them was focaccia.",
        viewCount: 3,
        publishedAt: daysAgo(1),
      }),
    ]);

    expect(ids((await index.query({ text: "focaccia", sort: "date", ...page })).hits)) //
      .toEqual(["weak-new", "perfect-old"]);
    expect(ids((await index.query({ text: "focaccia", sort: "views", ...page })).hits)) //
      .toEqual(["perfect-old", "weak-new"]);
    expect(ids((await index.query({ text: "focaccia", ...page })).hits)) //
      .toEqual(["perfect-old", "weak-new"]);
  });
});
