// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createPGliteDatabase } from "@/adapters/db/pglite";
import type { SqlDatabase } from "@/adapters/db";
import {
  HOME_SEED_LIMIT,
  MIN_COVISIT_WEIGHT,
  SESSION_VIDEO_CAP,
  relatedness,
} from "@/domain/recommender";
import type { Viewer } from "@/domain/recommender";

import {
  autoplayNext,
  homeFeed,
  relatedCandidates,
  shortsFeed,
  watchNextSidebar,
} from "../recommendations";
import { recordWatch, refreshRelatedVideos } from "../watch-events";

/**
 * The graph and the four surfaces, against a real Postgres.
 *
 * PGlite in memory rather than a fake: the parts of this slice most likely to
 * be wrong are a window function's tie-break, an upsert's conflict target and a
 * `check` constraint on collation order, none of which a fake would have an
 * opinion about. `covisitation.test.ts` proves the rules; this proves the SQL
 * expresses them.
 *
 * Every watch is stamped with an explicit time. Research §6 lists wall-clock
 * timestamps as one of the four ways a recommender with no `random()` call in
 * it stops being deterministic, and the recency ordering of the seed set is
 * exactly where it would bite.
 */

const OWNER = "usr00000001";
const VIEWER: Viewer = { userId: null, sessionKey: "cookie-1" };

/** Digits and lowercase only, and the same length. Video ids are compared by
 * Postgres under one collation and by TypeScript under another, and these sort
 * identically under both — a fixture is the wrong place to be testing that. */
function video(n: number): string {
  return `vid${String(n).padStart(8, "0")}`;
}

interface VideoSpec {
  readonly id: string;
  readonly channelId?: string;
  readonly viewCount?: number;
  readonly likeCount?: number;
  readonly isShort?: boolean;
}

async function createTestDatabase(): Promise<SqlDatabase> {
  const db = await createPGliteDatabase(":memory:");
  await db.migrate();
  return db;
}

async function seedCatalogue(
  db: SqlDatabase,
  specs: readonly VideoSpec[],
): Promise<void> {
  await db.execute(
    `insert into users (id, email, password_hash, display_name)
     values ($1, 'owner@example.test', '', 'Owner')
     on conflict do nothing`,
    [OWNER],
  );

  const channelIds = [...new Set(specs.map((spec) => spec.channelId ?? "ch1"))];
  for (const channelId of channelIds) {
    await db.execute(
      `insert into channels (id, owner_id, handle, name)
       values ($1, $2, $1, $1)
       on conflict do nothing`,
      [channelId, OWNER],
    );
  }

  for (const [index, spec] of specs.entries()) {
    await db.execute(
      `insert into videos
         (id, channel_id, title, visibility, upload_status, duration_seconds,
          is_short, view_count, like_count, published_at, thumbnail_key)
       values ($1, $2, $3, 'public', 'ready', $4, $5, $6, $7, $8, $9)`,
      [
        spec.id,
        spec.channelId ?? "ch1",
        `Video ${spec.id}`,
        spec.isShort === true ? 30 : 300,
        spec.isShort === true,
        spec.viewCount ?? 0,
        spec.likeCount ?? 0,
        new Date(Date.UTC(2026, 0, 1) + index * 86_400_000).toISOString(),
        `thumb/${spec.id}`,
      ],
    );
  }
}

/**
 * Watches, one a minute from a fixed epoch, in the order they are asked for.
 *
 * A minute apart rather than "as fast as the loop runs": PGlite's `now()`
 * resolves to the millisecond and real Postgres to the microsecond, so watches
 * written back to back are separable on Neon and identical here. Any assertion
 * that depends on watch order has to be given the separation explicitly.
 */
function recorder(db: SqlDatabase): (
  sessionKey: string,
  videoIds: readonly string[],
  userId?: string | null,
) => Promise<void> {
  let tick = 0;
  return async (sessionKey, videoIds, userId = null) => {
    for (const videoId of videoIds) {
      await recordWatch(
        {
          sessionKey,
          videoId,
          userId,
          watchedSeconds: 120,
          watchedAt: new Date(Date.UTC(2026, 0, 1) + tick++ * 60_000),
        },
        db,
      );
    }
  };
}

async function pairWeight(
  db: SqlDatabase,
  one: string,
  other: string,
): Promise<number | null> {
  const rows = await db.query<{ weight: number }>(
    `select weight from covisitation
      where video_a = least($1, $2) and video_b = greatest($1, $2)`,
    [one, other],
  );
  return rows[0]?.weight ?? null;
}

async function sessionCount(db: SqlDatabase, id: string): Promise<number> {
  const rows = await db.query<{ session_count: number }>(
    `select session_count from video_session_counts where video_id = $1`,
    [id],
  );
  return Number(rows[0]?.session_count ?? 0);
}

async function neighboursOf(
  db: SqlDatabase,
  seedId: string,
): Promise<{ candidateId: string; score: number; rank: number }[]> {
  const rows = await db.query<{
    candidate_id: string;
    score: number;
    rank: number;
  }>(
    `select candidate_id, score, rank from related_videos
      where seed_id = $1 order by rank`,
    [seedId],
  );
  return rows.map((row) => ({
    candidateId: row.candidate_id,
    score: Number(row.score),
    rank: Number(row.rank),
  }));
}

let db: SqlDatabase;

beforeEach(async () => {
  db = await createTestDatabase();
});

afterEach(async () => {
  await db.close();
});

/* ------------------------------------------------------------ the graph -- */

describe("recording a watch", () => {
  /**
   * The defect research §2 calls the most common one in a from-scratch
   * implementation. It is invisible in the output — inflating the pair counts
   * of a replayed video biases the recommender toward exactly the popular pairs
   * it leans on hardest, so the recommendations still look plausible — which is
   * why it is asserted against the counter rather than against a surface.
   */
  it("counts a pair once however many times the session replays a video", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);

    await watch("s1", [video(1), video(2), video(1), video(1), video(1)]);

    expect(await pairWeight(db, video(1), video(2))).toBe(1);
    expect(await sessionCount(db, video(1))).toBe(1);
    expect(await sessionCount(db, video(2))).toBe(1);
  });

  it("logs every watch even when the counters do not move", async () => {
    await seedCatalogue(db, [{ id: video(1) }]);
    const watch = recorder(db);

    await watch("s1", [video(1), video(1), video(1)]);

    const [logged] = await db.query<{ n: number }>(
      `select count(*)::int as n from watch_events`,
    );
    expect(logged?.n).toBe(3);
    expect(await sessionCount(db, video(1))).toBe(1);
  });

  it("reports a replay as such and a first watch as new", async () => {
    await seedCatalogue(db, [{ id: video(1) }]);
    const at = new Date(Date.UTC(2026, 0, 1));

    const first = await recordWatch(
      { sessionKey: "s1", videoId: video(1), watchedAt: at },
      db,
    );
    const second = await recordWatch(
      { sessionKey: "s1", videoId: video(1), watchedAt: at },
      db,
    );

    expect(first).toEqual({ newToSession: true, pairsTouched: 0 });
    expect(second).toEqual({ newToSession: false, pairsTouched: 0 });
  });

  it("counts a pair once per distinct session that contains both", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);

    await watch("s1", [video(1), video(2)]);
    await watch("s2", [video(2), video(1)]);
    await watch("s3", [video(1), video(2), video(1)]);

    expect(await pairWeight(db, video(1), video(2))).toBe(3);
    expect(await sessionCount(db, video(1))).toBe(3);
  });

  /**
   * The canonical row is the one the `check (video_a < video_b)` constraint
   * allows, and it has to be the same row whichever way round the two videos
   * were watched — a second row for the same unordered pair would split its
   * count across the two and halve every score derived from it.
   */
  it("stores one canonical row per unordered pair", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);

    await watch("s1", [video(1), video(2)]);
    await watch("s2", [video(2), video(1)]);

    const rows = await db.query<{ video_a: string; video_b: string }>(
      `select video_a, video_b from covisitation`,
    );
    expect(rows).toEqual([{ video_a: video(1), video_b: video(2) }]);
  });

  /**
   * Research §3's session cap, asserted at the boundary it is defined by: the
   * 50th distinct video still pairs with the 49 before it, the 51st pairs with
   * nothing and does not join the session at all.
   *
   * The membership row and the session count are asserted together because the
   * invariant is that they move together — recording membership without
   * generating pairs would grow the 51st video's denominator while its
   * numerator stayed at zero, penalising it on every surface forever.
   */
  it("stops generating pairs at the video after the session cap", async () => {
    const ids = Array.from({ length: SESSION_VIDEO_CAP + 1 }, (_, i) =>
      video(i + 1),
    );
    await seedCatalogue(
      db,
      ids.map((id) => ({ id })),
    );
    const watch = recorder(db);

    await watch("s1", ids);

    const beyondCap = ids[SESSION_VIDEO_CAP];
    expect(beyondCap).toBeDefined();

    const [members] = await db.query<{ n: number }>(
      `select count(*)::int as n from session_videos where session_key = 's1'`,
    );
    expect(members?.n).toBe(SESSION_VIDEO_CAP);

    const [pairs] = await db.query<{ n: number }>(
      `select count(*)::int as n from covisitation
        where video_a = $1 or video_b = $1`,
      [beyondCap ?? ""],
    );
    expect(pairs?.n).toBe(0);
    expect(await sessionCount(db, beyondCap ?? "")).toBe(0);

    const [logged] = await db.query<{ n: number }>(
      `select count(*)::int as n from watch_events where video_id = $1`,
      [beyondCap ?? ""],
    );
    expect(logged?.n).toBe(1);

    // The 50th is inside the cap and pairs with all 49 before it.
    const [atCap] = await db.query<{ n: number }>(
      `select count(*)::int as n from covisitation
        where video_a = $1 or video_b = $1`,
      [ids[SESSION_VIDEO_CAP - 1] ?? ""],
    );
    expect(atCap?.n).toBe(SESSION_VIDEO_CAP - 1);
  });
});

/* ---------------------------------------------------------- the scoring -- */

describe("the neighbour lists", () => {
  /**
   * The minimum co-visit floor, at the boundary. A pair seen twice has a row in
   * `covisitation` and no row anywhere in `related_videos`; the third session
   * is what makes it readable.
   */
  it("excludes a pair seen twice and includes one seen three times", async () => {
    expect(MIN_COVISIT_WEIGHT).toBe(3);
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);

    await watch("s1", [video(1), video(2)]);
    await watch("s2", [video(1), video(2)]);

    expect(await pairWeight(db, video(1), video(2))).toBe(2);
    expect(await neighboursOf(db, video(1))).toEqual([]);

    await watch("s3", [video(1), video(2)]);

    // 3 co-visits over 3 seed sessions × 3 candidate sessions. This read
    // `score: 1` while the denominator was the candidate's count alone; the
    // pair is unchanged, the scale is not.
    expect(await neighboursOf(db, video(1))).toEqual([
      { candidateId: video(2), score: relatedness(3, 3, 3), rank: 1 },
    ]);
  });

  /**
   * The normaliser is `video_session_counts.session_count`, not
   * `videos.view_count`. Both candidates are co-visited with the seed in three
   * sessions and appear in three sessions; one of them was replayed to a
   * hundred views and the other watched once each time. Equal scores is the
   * assertion, and the view counts in the fixture are what makes it mean
   * something — the wrong denominator would produce 3/100 against 3/3.
   */
  it("normalises by session count, so rewatching changes no score", async () => {
    const seed = video(1);
    const replayed = video(2);
    const watchedOnce = video(3);
    await seedCatalogue(db, [
      { id: seed },
      { id: replayed, viewCount: 100, channelId: "ch2" },
      { id: watchedOnce, viewCount: 3, channelId: "ch3" },
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [
        seed,
        replayed,
        replayed,
        replayed,
        replayed,
        watchedOnce,
      ]);
    }

    expect(await sessionCount(db, replayed)).toBe(3);
    expect(await sessionCount(db, watchedOnce)).toBe(3);

    const neighbours = await neighboursOf(db, seed);
    const scoreOf = (id: string) =>
      neighbours.find((row) => row.candidateId === id)?.score;

    expect(scoreOf(replayed)).toBe(scoreOf(watchedOnce));
    expect(scoreOf(replayed)).toBe(relatedness(3, await sessionCount(db, seed), 3));
  });

  /**
   * The score exists twice — as `relatedness` in TypeScript and as a division
   * inside the refresh query — because the refresh runs over the whole pair
   * table and cannot call into the domain. This is the assertion that keeps two
   * expressions of one rule from becoming two rules.
   */
  it("computes the same score the domain defines", async () => {
    await seedCatalogue(db, [
      { id: video(1) },
      { id: video(2) },
      { id: video(3) },
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }
    for (const session of ["s4", "s5", "s6"]) {
      await watch(session, [video(2), video(3)]);
    }

    const weight = await pairWeight(db, video(1), video(2));
    const seedSessions = await sessionCount(db, video(1));
    const candidateSessions = await sessionCount(db, video(2));
    const [stored] = await neighboursOf(db, video(1));

    // Both counts, and they differ here — video(2) is in six sessions and
    // video(1) in three — so an implementation that dropped either one would
    // land on a different number rather than coincidentally agreeing.
    expect(seedSessions).not.toBe(candidateSessions);
    expect(stored?.score).toBe(
      relatedness(weight ?? 0, seedSessions, candidateSessions),
    );
  });

  /**
   * `recordWatch` refreshes only the seeds whose lists this watch could have
   * changed; `refreshRelatedVideos` rebuilds everything from the pair counts.
   * The incremental one is our design rather than the paper's (research §2), so
   * the batch rebuild is the definition it has to agree with — including for
   * the seed that is *not* in the session but whose denominator moved.
   *
   * It is also, measured by deleting it, the only test that holds the window
   * function's `, d.candidate_id` tie-break. The ordering assertions further
   * down do not: the domain re-sorts on id before anything is returned, so a
   * rank assigned arbitrarily among ties still comes back in id order. What an
   * arbitrary rank actually changes is *which* candidates survive the top-K
   * cutoff, and two rebuilds disagreeing about that is what this notices.
   */
  it("keeps the incremental refresh identical to a full rebuild", async () => {
    await seedCatalogue(
      db,
      [1, 2, 3, 4, 5].map((n) => ({ id: video(n), channelId: `ch${n}` })),
    );
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2), video(3)]);
    }
    for (const session of ["s4", "s5", "s6"]) {
      await watch(session, [video(3), video(4)]);
    }
    await watch("s7", [video(2), video(5)]);
    await watch("s8", [video(2), video(5)]);
    await watch("s9", [video(2), video(5)]);

    const snapshot = async () =>
      db.query(
        `select seed_id, candidate_id, score, rank from related_videos
          order by seed_id, rank, candidate_id`,
      );

    const incremental = await snapshot();
    await refreshRelatedVideos(db);
    expect(await snapshot()).toEqual(incremental);
    expect(incremental.length).toBeGreaterThan(0);
  });
});

/* --------------------------------------------------------- the surfaces -- */

describe("candidate generation", () => {
  /**
   * D10 Eq. 3's second hop, on a corpus where it is the only way to arrive: the
   * two videos are never in a session together, so they have no row in
   * `covisitation` at all and the first hop cannot see one from the other.
   */
  it("reaches a video that never shared a session with the seed", async () => {
    const seed = video(1);
    const bridge = video(2);
    const distant = video(3);
    await seedCatalogue(db, [
      { id: seed },
      { id: bridge, channelId: "ch2" },
      { id: distant, channelId: "ch3" },
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [seed, bridge]);
    }
    for (const session of ["s4", "s5", "s6"]) {
      await watch(session, [bridge, distant]);
    }

    expect(await pairWeight(db, seed, distant)).toBeNull();

    const reached = await relatedCandidates(seed, VIEWER, db);
    expect(reached.map((row) => row.card.id).sort()).toEqual([bridge, distant]);
  });

  /** D10 §2.3 associates a candidate with a video in the *seed set*, which is
   * what "Because you watched X" renders. A two-hop candidate is credited to
   * the seed, not to the intermediate it travelled through. */
  it("credits a two-hop candidate to the seed, not the intermediate", async () => {
    const seed = video(1);
    const bridge = video(2);
    const distant = video(3);
    await seedCatalogue(db, [
      { id: seed },
      { id: bridge, channelId: "ch2" },
      { id: distant, channelId: "ch3" },
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [seed, bridge]);
    }
    for (const session of ["s4", "s5", "s6"]) {
      await watch(session, [bridge, distant]);
    }

    const reached = await relatedCandidates(seed, VIEWER, db);
    const twoHop = reached.find((row) => row.card.id === distant);
    expect(twoHop?.seedIds).toEqual([seed]);
  });

  /**
   * A candidate sitting behind *two* of the viewer's videos must be scored as
   * such.
   *
   * The expansion visits each video once, which is the intended saving, and it
   * used to keep one origin per video along with it — whichever seed's row
   * happened to come first. So for S1→B, S2→B, B→X, the second hop credited X
   * to one seed and `aggregateAcrossSeeds` summed one contribution instead of
   * two. The evidence that X is the best thing to show this viewer is exactly
   * that both their videos lead to it, and that evidence was being halved.
   *
   * The corpus below is built so the two answers differ in *order*, not just
   * in score: `far` is reachable only from `s1`, `shared` from both. With the
   * bug they tie on one contribution each and `far` wins on the id tie-break;
   * with both contributions counted, `shared` comes first.
   */
  it("credits a candidate reached from two seeds to both of them", async () => {
    const s1 = video(1);
    const s2 = video(2);
    const bridge = video(3);
    const shared = video(4);
    const far = video(5);

    await seedCatalogue(db, [
      { id: s1 },
      { id: s2, channelId: "ch2" },
      { id: bridge, channelId: "ch3" },
      { id: shared, channelId: "ch4" },
      { id: far, channelId: "ch5" },
    ]);
    const watch = recorder(db);

    // Both of the viewer's videos lead into the same bridge…
    for (const session of ["a1", "a2", "a3"]) await watch(session, [s1, bridge]);
    for (const session of ["b1", "b2", "b3"]) await watch(session, [s2, bridge]);
    // …which leads on to `shared`.
    for (const session of ["c1", "c2", "c3"]) await watch(session, [bridge, shared]);
    // `far` hangs off s1 alone, at the same hop and the same weight.
    for (const session of ["d1", "d2", "d3"]) await watch(session, [s1, far]);

    // The viewer has watched both seeds, in their own session.
    await watch(VIEWER.sessionKey, [s1, s2]);

    const feed = (await homeFeed(VIEWER, db)).map((card) => card.id);
    expect(feed).toContain(shared);
    expect(feed).toContain(far);
    expect(feed.indexOf(shared)).toBeLessThan(feed.indexOf(far));
  });

  it("never returns the seed itself", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);
    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }

    const reached = await relatedCandidates(video(1), VIEWER, db);
    expect(reached.map((row) => row.card.id)).not.toContain(video(1));
  });

  /**
   * A private or still-processing video may bridge two public ones without ever
   * being recommended. Filtering it out of the expansion instead would silently
   * disconnect its neighbours from each other.
   */
  it("expands through an ineligible video without returning it", async () => {
    await seedCatalogue(db, [
      { id: video(1) },
      { id: video(2), channelId: "ch2" },
      { id: video(3), channelId: "ch3" },
    ]);
    await db.execute(`update videos set visibility = 'private' where id = $1`, [
      video(2),
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }
    for (const session of ["s4", "s5", "s6"]) {
      await watch(session, [video(2), video(3)]);
    }

    const reached = await relatedCandidates(video(1), VIEWER, db);
    expect(reached.map((row) => row.card.id)).toEqual([video(3)]);
  });
});

describe("the watch-next sidebar", () => {
  /**
   * Three candidates whose scores are exactly equal — routine on a small
   * corpus, per research §6, not contrived. The sequence is the id order, and
   * it must not be the order the sessions happened to arrive in.
   */
  it("orders exact ties by id, whatever order the watches arrived in", async () => {
    const seed = video(1);
    const candidates = [video(4), video(2), video(3)];

    const build = async (order: readonly string[]) => {
      const fresh = await createTestDatabase();
      await seedCatalogue(fresh, [
        { id: seed },
        { id: video(2), channelId: "ch2" },
        { id: video(3), channelId: "ch3" },
        { id: video(4), channelId: "ch4" },
      ]);
      const watch = recorder(fresh);
      let session = 0;
      for (const candidate of order) {
        // Three sessions each, so every pair clears the co-visit floor and all
        // three candidates land on exactly the same score.
        for (let repeat = 0; repeat < MIN_COVISIT_WEIGHT; repeat++) {
          await watch(`s${session++}`, [seed, candidate]);
        }
      }
      return fresh;
    };

    const forwards = await build(candidates);
    const backwards = await build([...candidates].reverse());

    const expected = [video(2), video(3), video(4)];
    expect(
      (await relatedCandidates(seed, VIEWER, forwards)).map((r) => r.card.id),
    ).toEqual(expected);
    expect(
      (await relatedCandidates(seed, VIEWER, backwards)).map((r) => r.card.id),
    ).toEqual(expected);
    expect(
      (await watchNextSidebar(seed, VIEWER, forwards)).slice(0, 3).map((c) => c.id),
    ).toEqual(expected);

    await forwards.close();
    await backwards.close();
  });

  /** Cold start on the surface where it is least expected: a watch page on a
   * corpus with no co-visitation at all still has a sidebar. */
  it("backfills rather than returning nothing on a cold corpus", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 10 },
      { id: video(2), viewCount: 30, channelId: "ch2" },
      { id: video(3), viewCount: 20, channelId: "ch3" },
    ]);

    const sidebar = await watchNextSidebar(video(1), VIEWER, db);
    expect(sidebar.map((card) => card.id)).toEqual([video(2), video(3)]);
  });

  it("never puts the video being watched in its own sidebar", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 99 },
      { id: video(2), viewCount: 30, channelId: "ch2" },
    ]);
    const watch = recorder(db);
    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }

    const sidebar = await watchNextSidebar(video(1), VIEWER, db);
    expect(sidebar.map((card) => card.id)).not.toContain(video(1));
  });
});

describe("the home feed", () => {
  /**
   * Research §5's reframing, asserted: on a database with no watch events at
   * all, a non-empty home feed is not a co-visitation result, it is the
   * fallback pool being queried unconditionally. Ordered by view count, then by
   * recency, then by id.
   */
  it("is populated on a fresh database with no watch events", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 10 },
      { id: video(2), viewCount: 30 },
      { id: video(3), viewCount: 20 },
    ]);

    const feed = await homeFeed(VIEWER, db);
    expect(feed.map((card) => card.id)).toEqual([video(2), video(3), video(1)]);
  });

  it("is populated for a signed-out viewer who has watched nothing", async () => {
    await seedCatalogue(db, [{ id: video(1), viewCount: 5 }]);

    const feed = await homeFeed({ userId: null, sessionKey: "brand-new" }, db);
    expect(feed.map((card) => card.id)).toEqual([video(1)]);
  });

  /** Signed-out viewers are the reason `watch_events.session_key` exists: the
   * graph has to be built and read before anyone has an account. */
  it("personalises a signed-out viewer from their session cookie", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 1 },
      { id: video(2), viewCount: 1, channelId: "ch2" },
      { id: video(3), viewCount: 900, channelId: "ch3" },
    ]);
    const watch = recorder(db);

    // The graph learns that 1 and 2 go together, from other people's sessions.
    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }
    // This viewer has watched only 1, in their own session.
    await watch(VIEWER.sessionKey, [video(1)]);

    /**
     * Unpersonalised, the fallback's own order would put the 900-view video
     * first. The recommendation from a one-view video's neighbour list leading
     * it is the seed cookie doing its job; 3 and 1 behind it are the backfill,
     * which does not drop the already-watched 1.
     */
    const feed = await homeFeed(VIEWER, db);
    expect(feed.map((card) => card.id)).toEqual([video(2), video(3), video(1)]);
  });

  /**
   * The personalised half drops what the viewer has watched; the fallback half
   * does not, because its job is that the page is never empty. A viewer who has
   * seen the whole corpus still gets a home feed.
   */
  it("backfills with already-watched videos rather than showing nothing", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 10 },
      { id: video(2), viewCount: 20 },
    ]);
    const watch = recorder(db);
    await watch(VIEWER.sessionKey, [video(1), video(2)]);

    const feed = await homeFeed(VIEWER, db);
    expect(feed.map((card) => card.id)).toEqual([video(2), video(1)]);
  });

  /**
   * The seed set is the *recent* part of the history, not a sample of it, and
   * this is the only place in the slice where a timestamp decides an outcome.
   * Twelve watched videos, each with one strong neighbour of its own, and a
   * seed limit of ten: the neighbours of the two oldest must not appear where
   * the personalised rows do.
   *
   * The fixture stamps every watch a minute apart deliberately. PGlite's
   * `now()` resolves only to the millisecond where real Postgres resolves to
   * the microsecond, so a fixture that let the write path stamp its own times
   * would give twelve watches the same instant here and twelve distinct ones on
   * Neon — the seed set would then differ by engine, and so would every
   * recommendation derived from it.
   */
  it("seeds from the most recently watched videos, not the oldest", async () => {
    const history = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    await seedCatalogue(db, [
      ...history.map((n) => ({ id: video(n) })),
      ...history.map((n) => ({
        id: video(100 + n),
        channelId: `chp${n}`,
      })),
    ]);
    const watch = recorder(db);

    for (const n of history) {
      for (let repeat = 0; repeat < MIN_COVISIT_WEIGHT; repeat++) {
        await watch(`pair-${n}-${repeat}`, [video(n), video(100 + n)]);
      }
    }
    await watch(
      VIEWER.sessionKey,
      history.map((n) => video(n)),
    );

    const feed = await homeFeed(VIEWER, db);
    expect(feed.slice(0, HOME_SEED_LIMIT).map((card) => card.id)).toEqual(
      history.slice(2).map((n) => video(100 + n)),
    );
  });

  it("caps how many rows one channel may contribute", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 50, channelId: "ch1" },
      { id: video(2), viewCount: 40, channelId: "ch1" },
      { id: video(3), viewCount: 30, channelId: "ch1" },
      { id: video(4), viewCount: 20, channelId: "ch2" },
      { id: video(5), viewCount: 10, channelId: "ch2" },
    ]);
    const watch = recorder(db);

    // Every candidate co-visits with the seed equally, so only the cap can
    // separate them.
    for (const session of ["s1", "s2", "s3"]) {
      for (const candidate of [video(2), video(3), video(4), video(5)]) {
        await watch(`${session}-${candidate}`, [video(1), candidate]);
      }
    }
    await watch(VIEWER.sessionKey, [video(1)]);

    const feed = await homeFeed(VIEWER, db);
    const fromCh1 = feed
      .slice(0, 3)
      .filter((card) => card.channelId === "ch1").length;
    expect(fromCh1).toBeLessThanOrEqual(2);
  });
});

describe("autoplay", () => {
  it("never returns the video currently playing", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 900, likeCount: 900 },
      { id: video(2), viewCount: 10, likeCount: 1, channelId: "ch2" },
    ]);
    const watch = recorder(db);
    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
    }
    await watch(VIEWER.sessionKey, [video(1)]);

    const next = await autoplayNext(video(1), VIEWER, db);
    expect(next?.id).toBe(video(2));
  });

  /** The cold path is the one where the currently-playing video could sneak
   * back in, because the fallback pool is the whole catalogue ordered by
   * popularity and the playing video is usually near the top of it. */
  it("never returns the video currently playing on a cold corpus", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 900 },
      { id: video(2), viewCount: 10, channelId: "ch2" },
    ]);

    const next = await autoplayNext(video(1), VIEWER, db);
    expect(next?.id).toBe(video(2));
  });

  it("does not roll back into anything else watched this sitting", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 900 },
      { id: video(2), viewCount: 800, channelId: "ch2" },
      { id: video(3), viewCount: 1, channelId: "ch3" },
    ]);
    const watch = recorder(db);
    await watch(VIEWER.sessionKey, [video(2), video(1)]);

    const next = await autoplayNext(video(1), VIEWER, db);
    expect(next?.id).toBe(video(3));
  });

  it("returns nothing when every eligible video has been watched", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    const watch = recorder(db);
    await watch(VIEWER.sessionKey, [video(1), video(2)]);

    expect(await autoplayNext(video(1), VIEWER, db)).toBeNull();
  });

  /**
   * Research §7 ranks this surface on the appreciation proxy ahead of
   * relatedness. Both candidates are related to the seed identically; the one
   * a larger share of its viewers liked takes the slot.
   */
  it("prefers the better-appreciated of two equally related candidates", async () => {
    await seedCatalogue(db, [
      { id: video(1) },
      { id: video(2), viewCount: 1000, likeCount: 10, channelId: "ch2" },
      { id: video(3), viewCount: 100, likeCount: 50, channelId: "ch3" },
    ]);
    const watch = recorder(db);
    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
      await watch(`${session}b`, [video(1), video(3)]);
    }

    const next = await autoplayNext(video(1), VIEWER, db);
    expect(next?.id).toBe(video(3));
  });
});

describe("the shorts feed", () => {
  it("returns vertical videos only", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 900 },
      { id: video(2), viewCount: 10, isShort: true, channelId: "ch2" },
      { id: video(3), viewCount: 5, isShort: true, channelId: "ch3" },
    ]);

    const feed = await shortsFeed(VIEWER, db);
    expect(feed.every((card) => card.isShort)).toBe(true);
    expect(feed.map((card) => card.id)).not.toContain(video(1));
  });

  /** Research §7 weights this surface's fallback toward freshness rather than
   * popularity, because a healthy Shorts corpus is mostly content too new to
   * have accumulated co-visits. */
  it("backfills newest first rather than most-viewed first", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 900, isShort: true },
      { id: video(2), viewCount: 10, isShort: true, channelId: "ch2" },
    ]);

    const feed = await shortsFeed(VIEWER, db);
    expect(feed.map((card) => card.id)).toEqual([video(2), video(1)]);
  });

  it("seeds only from shorts the viewer has watched", async () => {
    await seedCatalogue(db, [
      { id: video(1), viewCount: 1 },
      { id: video(2), viewCount: 1, channelId: "ch2" },
      { id: video(3), viewCount: 1, isShort: true, channelId: "ch3" },
      { id: video(4), viewCount: 1, isShort: true, channelId: "ch4" },
    ]);
    const watch = recorder(db);

    for (const session of ["s1", "s2", "s3"]) {
      await watch(session, [video(1), video(2)]);
      await watch(`${session}b`, [video(3), video(4)]);
    }
    await watch(VIEWER.sessionKey, [video(1), video(3)]);

    const feed = await shortsFeed(VIEWER, db);
    expect(feed[0]?.id).toBe(video(4));
  });
});

describe("the video card", () => {
  it("carries what a feed row renders and nothing that needs a second query", async () => {
    await seedCatalogue(db, [{ id: video(1), viewCount: 42 }]);

    const [card] = await homeFeed(VIEWER, db);
    expect(card).toEqual({
      id: video(1),
      title: `Video ${video(1)}`,
      channelId: "ch1",
      channelName: "ch1",
      channelHandle: "ch1",
      channelAvatarKey: null,
      // Off the same channel join the rest of this row comes from — the point
      // of this assertion is that nothing here needed a second query.
      channelVerified: false,
      thumbnailKey: `thumb/${video(1)}`,
      previewKey: null,
      durationSeconds: 300,
      viewCount: 42,
      publishedAt: new Date(Date.UTC(2026, 0, 1)),
      isShort: false,
      watchedSeconds: null,
    });
  });

  /** `watchedSeconds` is the red bar under the thumbnail, and it is the
   * viewer's position rather than a count — `null` for a video they have not
   * started, which is not the same as `0`. */
  it("carries the signed-in viewer's position when there is one", async () => {
    await seedCatalogue(db, [{ id: video(1) }, { id: video(2) }]);
    await db.execute(
      `insert into watch_progress (user_id, video_id, position_seconds)
       values ($1, $2, 42)`,
      [OWNER, video(1)],
    );

    const feed = await homeFeed({ userId: OWNER, sessionKey: "s1" }, db);
    const byId = new Map(feed.map((card) => [card.id, card]));
    expect(byId.get(video(1))?.watchedSeconds).toBe(42);
    expect(byId.get(video(2))?.watchedSeconds).toBeNull();
  });
});
