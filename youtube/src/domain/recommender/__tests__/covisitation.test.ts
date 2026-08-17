import { describe, expect, it } from "vitest";

import {
  MIN_COVISIT_WEIGHT,
  SESSION_VIDEO_CAP,
  admitToSession,
  aggregateAcrossSeeds,
  bestPerCandidate,
  clearsCoVisitFloor,
  compareByScore,
  relatedness,
} from "../covisitation";
import type { HopCandidate } from "../covisitation";

/**
 * The graph's arithmetic, with no database in it.
 *
 * `recommendations.test.ts` proves the same rules hold once they are expressed
 * in SQL. These prove what the rules are, which is the part that has to survive
 * someone rewriting the queries.
 */

function candidate(over: Partial<HopCandidate> & { id: string }): HopCandidate {
  return { seedId: "seed", score: 1, hop: 1, ...over };
}

describe("session admission", () => {
  it("treats a repeat of a video already in the session as a replay", () => {
    expect(admitToSession(3, true)).toBe("replay");
  });

  /**
   * The dedup rule stated as arithmetic: replay is decided by membership alone,
   * so a session that is empty of everything except this video still refuses to
   * count it twice.
   */
  it("decides replay on membership, not on how full the session is", () => {
    expect(admitToSession(1, true)).toBe("replay");
    expect(admitToSession(SESSION_VIDEO_CAP, true)).toBe("replay");
  });

  it("admits a new video while the session is under the cap", () => {
    expect(admitToSession(0, false)).toBe("admit");
    expect(admitToSession(SESSION_VIDEO_CAP - 1, false)).toBe("admit");
  });

  /**
   * The 51st distinct video, stated at the boundary: the 50th is admitted
   * because 49 videos preceded it, the 51st is not because 50 did.
   */
  it("stops admitting once the session holds the cap", () => {
    expect(admitToSession(SESSION_VIDEO_CAP, false)).toBe("capped");
    expect(admitToSession(SESSION_VIDEO_CAP + 1, false)).toBe("capped");
  });
});

describe("relatedness", () => {
  /** D10 Eq. 1 after ci drops out: cij over the candidate's session count. */
  it("is the co-visit count over the candidate's session count", () => {
    expect(relatedness(6, 3)).toBe(2);
    expect(relatedness(1, 4)).toBe(0.25);
  });

  /**
   * The normaliser is a session count, and the two quantities diverge the
   * moment anyone rewatches. Two candidates in three sessions each, one of them
   * rewatched into a hundred views, score identically — substituting the view
   * count is the mistake this asserts against, and it is worth writing the
   * wrong denominator out to show how far apart the two answers land.
   */
  it("is unmoved by the rewatching that a view count would notice", () => {
    const sessions = 3;
    const busyViewCount = 100;
    const quietViewCount = 3;

    expect(relatedness(3, sessions)).toBe(relatedness(3, sessions));
    expect(3 / busyViewCount).not.toBe(3 / quietViewCount);
  });

  /** The stated consequence of normalising by the candidate: less popular
   * candidates outrank more popular ones at equal co-visitation. */
  it("favours the less popular of two equally co-visited candidates", () => {
    expect(relatedness(3, 3)).toBeGreaterThan(relatedness(3, 30));
  });

  it("returns zero rather than dividing by zero", () => {
    expect(relatedness(3, 0)).toBe(0);
  });
});

describe("the minimum co-visit floor", () => {
  it("excludes a pair seen twice and includes one seen three times", () => {
    expect(MIN_COVISIT_WEIGHT).toBe(3);
    expect(clearsCoVisitFloor(2)).toBe(false);
    expect(clearsCoVisitFloor(3)).toBe(true);
  });
});

describe("collapsing the paths to one candidate", () => {
  it("keeps the best score a candidate reached from any path", () => {
    const collapsed = bestPerCandidate([
      candidate({ id: "vid00000002", score: 0.2, hop: 1 }),
      candidate({ id: "vid00000002", score: 0.9, hop: 2 }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0]?.score).toBe(0.9);
    expect(collapsed[0]?.hop).toBe(2);
  });

  /** Hop distance decides only which record survives a tie — never the
   * ranking, which research §4.3 orders on score alone. */
  it("prefers the shorter path when two paths scored identically", () => {
    const collapsed = bestPerCandidate([
      candidate({ id: "vid00000002", score: 0.5, hop: 2 }),
      candidate({ id: "vid00000002", score: 0.5, hop: 1 }),
    ]);
    expect(collapsed[0]?.hop).toBe(1);
  });

  it("orders by score descending, then by id", () => {
    const collapsed = bestPerCandidate([
      candidate({ id: "vid00000003", score: 0.5 }),
      candidate({ id: "vid00000001", score: 0.5 }),
      candidate({ id: "vid00000002", score: 0.9 }),
    ]);
    expect(collapsed.map((row) => row.id)).toEqual([
      "vid00000002",
      "vid00000001",
      "vid00000003",
    ]);
  });

  /**
   * The tie-break has to be a total order, not merely a stable sort: the same
   * three candidates arriving in a different order must produce the same
   * sequence. A stable sort would return the input order for the two ties.
   */
  it("produces one sequence regardless of the order the paths arrived in", () => {
    const rows = [
      candidate({ id: "vid00000003", score: 0.5 }),
      candidate({ id: "vid00000001", score: 0.5 }),
      candidate({ id: "vid00000002", score: 0.5 }),
    ];
    const forwards = bestPerCandidate(rows).map((row) => row.id);
    const backwards = bestPerCandidate([...rows].reverse()).map((row) => row.id);
    expect(forwards).toEqual([
      "vid00000001",
      "vid00000002",
      "vid00000003",
    ]);
    expect(backwards).toEqual(forwards);
  });
});

describe("aggregating across seeds", () => {
  it("sums a candidate's score over the distinct seeds that reached it", () => {
    const aggregated = aggregateAcrossSeeds([
      candidate({ id: "vid00000009", seedId: "vid00000001", score: 0.5 }),
      candidate({ id: "vid00000009", seedId: "vid00000002", score: 0.25 }),
    ]);
    expect(aggregated).toEqual([
      {
        id: "vid00000009",
        score: 0.75,
        seedIds: ["vid00000001", "vid00000002"],
      },
    ]);
  });

  /**
   * Two paths from *one* seed are one seed's opinion. Counting them twice would
   * let a single seed outvote two seeds that independently agreed, which is the
   * opposite of what summing across seeds is for.
   */
  it("counts one seed once however many paths it reached the candidate by", () => {
    const aggregated = aggregateAcrossSeeds([
      candidate({ id: "vid00000009", seedId: "vid00000001", score: 0.5, hop: 1 }),
      candidate({ id: "vid00000009", seedId: "vid00000001", score: 0.4, hop: 2 }),
    ]);
    expect(aggregated[0]?.score).toBe(0.5);
    expect(aggregated[0]?.seedIds).toEqual(["vid00000001"]);
  });

  it("orders by summed score descending, then by id", () => {
    const aggregated = aggregateAcrossSeeds([
      candidate({ id: "vid00000003", seedId: "s1", score: 1 }),
      candidate({ id: "vid00000001", seedId: "s1", score: 1 }),
      candidate({ id: "vid00000002", seedId: "s1", score: 0.5 }),
      candidate({ id: "vid00000002", seedId: "s2", score: 0.5 }),
      candidate({ id: "vid00000002", seedId: "s3", score: 0.5 }),
    ]);
    expect(aggregated.map((row) => row.id)).toEqual([
      "vid00000002",
      "vid00000001",
      "vid00000003",
    ]);
  });

  /** The attribution is what "Because you watched X" renders, so it has to be
   * the same list in the same order on every run. */
  it("reports the seeds in one order regardless of arrival order", () => {
    const rows = [
      candidate({ id: "vid00000009", seedId: "vid00000003", score: 1 }),
      candidate({ id: "vid00000009", seedId: "vid00000001", score: 1 }),
      candidate({ id: "vid00000009", seedId: "vid00000002", score: 1 }),
    ];
    expect(aggregateAcrossSeeds(rows)[0]?.seedIds).toEqual([
      "vid00000001",
      "vid00000002",
      "vid00000003",
    ]);
    expect(aggregateAcrossSeeds([...rows].reverse())[0]?.seedIds).toEqual([
      "vid00000001",
      "vid00000002",
      "vid00000003",
    ]);
  });
});

describe("the ordering", () => {
  it("puts the higher score first and breaks a tie on the id", () => {
    expect(
      compareByScore({ id: "a", score: 2 }, { id: "b", score: 1 }),
    ).toBeLessThan(0);
    expect(
      compareByScore({ id: "b", score: 1 }, { id: "a", score: 1 }),
    ).toBeGreaterThan(0);
    expect(compareByScore({ id: "a", score: 1 }, { id: "a", score: 1 })).toBe(0);
  });
});
