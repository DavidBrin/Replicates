import { describe, expect, it } from "vitest";

import {
  HOME_CHANNEL_CAP,
  HOME_FEED_SIZE,
  HOME_SEED_LIMIT,
  MAX_HOPS,
  SHORTS_SEED_LIMIT,
  SIDEBAR_CHANNEL_CAP,
  TOP_K_SERVED,
  TOP_K_STORED,
  backfill,
  capPerChannel,
  compareByAutoplayPriority,
  pickAutoplay,
} from "../index";

/**
 * The rules the four surfaces share, tested without a surface.
 *
 * Diversification, backfill and the autoplay pick are the three places where a
 * recommender normally reaches for randomness — research §6 names each — so
 * every case here also asserts that running it twice, or running it on
 * differently-ordered input, produces one answer.
 *
 * Imported through the barrel rather than the implementation file, so that a
 * rule dropping out of the recommender's public surface fails here.
 */

interface Row {
  readonly id: string;
  readonly channelId: string;
  readonly score: number;
  readonly qualityScore: number;
}

function row(over: Partial<Row> & { id: string }): Row {
  return { channelId: "ch1", score: 1, qualityScore: 0, ...over };
}

describe("the constants the surfaces are built from", () => {
  /**
   * Pinned because they are the research's numbers rather than ours, and a
   * later "tidy-up" that harmonises them would be changing the recommender's
   * behaviour while appearing to change nothing.
   */
  it("are the values research §3, §4.4 and §7 give", () => {
    expect(TOP_K_STORED).toBe(50);
    expect(TOP_K_SERVED).toBe(20);
    expect(MAX_HOPS).toBe(2);
    expect(HOME_SEED_LIMIT).toBe(10);
    expect(SHORTS_SEED_LIMIT).toBe(5);
    expect(HOME_FEED_SIZE).toBe(40);
    expect(HOME_CHANNEL_CAP).toBe(2);
  });

  /** The stored list is deeper than the served one specifically so the channel
   * cap has somewhere to fall back to inside one seed's neighbours. */
  it("store more neighbours per seed than any surface serves", () => {
    expect(TOP_K_STORED).toBeGreaterThan(TOP_K_SERVED);
  });
});

describe("the channel cap", () => {
  it("keeps at most the cap from one channel and drops the rest", () => {
    const capped = capPerChannel(
      [
        row({ id: "v1", channelId: "ch1" }),
        row({ id: "v2", channelId: "ch1" }),
        row({ id: "v3", channelId: "ch1" }),
        row({ id: "v4", channelId: "ch2" }),
      ],
      HOME_CHANNEL_CAP,
    );
    expect(capped.map((item) => item.id)).toEqual(["v1", "v2", "v4"]);
  });

  /** It runs after ranking, so it must not re-order — a cap that sorted would
   * silently become the last word on the order of every surface. */
  it("preserves the order it was given", () => {
    const ranked = [
      row({ id: "v9", channelId: "ch2" }),
      row({ id: "v1", channelId: "ch1" }),
      row({ id: "v5", channelId: "ch3" }),
    ];
    expect(capPerChannel(ranked, SIDEBAR_CHANNEL_CAP).map((i) => i.id)).toEqual([
      "v9",
      "v1",
      "v5",
    ]);
  });

  it("lets the sidebar take one more from a channel than the home feed", () => {
    const fromOneChannel = [
      row({ id: "v1" }),
      row({ id: "v2" }),
      row({ id: "v3" }),
      row({ id: "v4" }),
    ];
    expect(capPerChannel(fromOneChannel, HOME_CHANNEL_CAP)).toHaveLength(2);
    expect(capPerChannel(fromOneChannel, SIDEBAR_CHANNEL_CAP)).toHaveLength(3);
  });
});

describe("the cold-start backfill", () => {
  /** The fresh-database case, at the level where the decision is made: no
   * personalised rows at all is not an error condition, it is Tuesday. */
  it("fills the whole surface from the pool when nothing was personalised", () => {
    const filled = backfill(
      [],
      [row({ id: "v1" }), row({ id: "v2" }), row({ id: "v3" })],
      3,
    );
    expect(filled.map((item) => item.id)).toEqual(["v1", "v2", "v3"]);
  });

  it("puts personalised rows first and tops up from the pool", () => {
    const filled = backfill(
      [row({ id: "p1" }), row({ id: "p2" })],
      [row({ id: "f1" }), row({ id: "f2" })],
      3,
    );
    expect(filled.map((item) => item.id)).toEqual(["p1", "p2", "f1"]);
  });

  /** The pool is queried independently of what was personalised, so an overlap
   * is expected rather than a caller error. */
  it("never repeats a video that the personalised half already returned", () => {
    const filled = backfill(
      [row({ id: "v1" })],
      [row({ id: "v1" }), row({ id: "v2" })],
      4,
    );
    expect(filled.map((item) => item.id)).toEqual(["v1", "v2"]);
  });

  it("does not exceed the requested size, from either half", () => {
    const filled = backfill(
      [row({ id: "p1" }), row({ id: "p2" }), row({ id: "p3" })],
      [row({ id: "f1" })],
      2,
    );
    expect(filled.map((item) => item.id)).toEqual(["p1", "p2"]);
  });
});

describe("the autoplay pick", () => {
  it("never returns a video in the excluded set", () => {
    const picked = pickAutoplay(
      [row({ id: "playing", qualityScore: 1 }), row({ id: "next" })],
      new Set(["playing"]),
    );
    expect(picked?.id).toBe("next");
  });

  it("returns nothing when every candidate is excluded", () => {
    const picked = pickAutoplay(
      [row({ id: "v1" }), row({ id: "v2" })],
      new Set(["v1", "v2"]),
    );
    expect(picked).toBeNull();
  });

  /**
   * Research §7 puts the appreciation proxy ahead of relatedness on this
   * surface, so a lower-scoring candidate with a better ratio takes the slot.
   * That is the ordering it asks for, and it is only defensible because
   * everything being compared already cleared candidate generation.
   */
  it("prefers the better-appreciated candidate over the better-related one", () => {
    const picked = pickAutoplay(
      [
        row({ id: "related", score: 5, qualityScore: 0.01 }),
        row({ id: "appreciated", score: 1, qualityScore: 0.5 }),
      ],
      new Set(),
    );
    expect(picked?.id).toBe("appreciated");
  });

  it("falls back to relatedness when the proxy cannot separate two", () => {
    const picked = pickAutoplay(
      [
        row({ id: "weak", score: 1, qualityScore: 0.2 }),
        row({ id: "strong", score: 5, qualityScore: 0.2 }),
      ],
      new Set(),
    );
    expect(picked?.id).toBe("strong");
  });

  /**
   * The slot is one video, so an unstable tie-break here is not a reordering,
   * it is a different video playing. Both orderings of the same two
   * indistinguishable candidates must pick the same one.
   */
  it("picks the same video however the candidates were ordered", () => {
    const tied = [
      row({ id: "vid00000002", score: 1, qualityScore: 0.2 }),
      row({ id: "vid00000001", score: 1, qualityScore: 0.2 }),
    ];
    expect(pickAutoplay(tied, new Set())?.id).toBe("vid00000001");
    expect(pickAutoplay([...tied].reverse(), new Set())?.id).toBe(
      "vid00000001",
    );
  });

  it("orders quality, then score, then id", () => {
    const ordered = [
      row({ id: "c", score: 1, qualityScore: 0.9 }),
      row({ id: "a", score: 9, qualityScore: 0.1 }),
      row({ id: "b", score: 9, qualityScore: 0.1 }),
    ].sort(compareByAutoplayPriority);
    expect(ordered.map((item) => item.id)).toEqual(["c", "a", "b"]);
  });
});
