// @vitest-environment node
import { beforeAll, describe, expect, it } from "vitest";

import {
  buildIndex,
  fingerprint,
  matchAgainstIndex,
  HOP_MS,
  MATCH_SCORE_THRESHOLD,
  OFFSET_BUCKET_MS,
  QUERY_SHIFTS,
  type Fingerprint,
  type Posting,
} from "../index";
import {
  addNoise,
  changeSpeed,
  excerpt,
  gain,
  lowPass,
  makeTrack,
} from "./synthetic-audio";

/**
 * The corpus and the calibration.
 *
 * `research/06-audio-fingerprinting.md` §8 is the shape of this file. The two
 * halves are not independent and must be read together: a matcher that returns
 * `true` for everything passes every positive test here, and a threshold set
 * high enough to pass the negative tests can be one that never matches
 * anything. So the positive matrix and the leave-one-out cross-matrix assert
 * against **the same constant**, `MATCH_SCORE_THRESHOLD`, from opposite sides.
 *
 * The corpus: 40 generated tracks of 20 s. The last four pair up on
 * `melodySeed`, which is §8's "near-duplicate but genuinely distinct" case —
 * two arrangements of the same melody, at different tempi and timbres. Without
 * them the non-match test only ever compares acoustically unrelated material
 * and never exercises §3.3's observation that the algorithm is "very sensitive
 * to which particular version of a track has been sampled".
 *
 * Excerpts are cut at 5.0003 s, deliberately **not** on a hop boundary. A
 * hop-aligned cut is the easy case and scores about ten times higher (see
 * `QUERY_SHIFTS`); testing only that would hide the single largest source of
 * loss in the pipeline.
 */

const N = 40;
const SECONDS = 20;
const EXCERPT_START_S = 5.0003;
const EXCERPT_START_MS = EXCERPT_START_S * 1000;

let tracks: Float32Array[];
let references: Fingerprint[];
let index: Map<number, Posting[]>;

function workId(i: number): string {
  return `w${i}`;
}

/** A 10-second excerpt from the middle, per §8, with an optional degradation. */
function query(
  i: number,
  degrade: (clip: Float32Array, seed: number) => Float32Array = (c) => c,
  seconds = 10,
): Fingerprint {
  const clip = excerpt(tracks[i]!, EXCERPT_START_S, seconds);
  return fingerprint(degrade(clip, 7000 + i), { shifts: QUERY_SHIFTS });
}

beforeAll(() => {
  tracks = [];
  for (let i = 0; i < N; i++) {
    const melodySeed = i >= N - 4 ? 1000 + ((i - (N - 4)) % 2) : undefined;
    tracks.push(makeTrack(1000 + i, { seconds: SECONDS, melodySeed }));
  }
  references = tracks.map((t) => fingerprint(t));

  const entries: { hash: number; workId: string; offsetMs: number }[] = [];
  references.forEach((fp, i) => {
    for (let k = 0; k < fp.hashes.length; k++) {
      entries.push({ hash: fp.hashes[k]!, workId: workId(i), offsetMs: fp.offsetsMs[k]! });
    }
  });
  index = buildIndex(entries);
});

/* --------------------------------------------------------------- the rule -- */

describe("the scoring rule", () => {
  it("scores a work by the height of its offset histogram's peak", () => {
    // Hand-built postings, so the count is checkable by eye. Six hashes align
    // at a 1000 ms offset; two more collide at unrelated offsets.
    const aligned = [10, 11, 12, 13, 14, 15];
    const entries = aligned.map((h, k) => ({
      hash: h,
      workId: "a",
      offsetMs: 1000 + k * 200,
    }));
    entries.push({ hash: 99, workId: "a", offsetMs: 400 });
    entries.push({ hash: 98, workId: "a", offsetMs: 17000 });

    const q = {
      hashes: Int32Array.from([...aligned, 99, 98]),
      offsetsMs: Int32Array.from([0, 200, 400, 600, 800, 1000, 5000, 9000]),
    };
    const [best] = matchAgainstIndex(q, buildIndex(entries), { minScore: 0 });

    expect(best?.score).toBe(6);
    expect(best?.deltaMs).toBeCloseTo(1000, -2);
    expect(best?.matchStartMs).toBe(0);
    expect(best?.matchEndMs).toBe(1000);
  });

  it("reports the reference offset as well as the video's own span", () => {
    // What makes a claim checkable by the uploader rather than merely
    // assertable by us: the span in the claimed video AND where that span sits
    // in the reference work.
    const entries = [0, 1, 2].map((k) => ({
      hash: 500 + k,
      workId: "a",
      offsetMs: 30000 + k * 100,
    }));
    const q = {
      hashes: Int32Array.from([500, 501, 502]),
      offsetsMs: Int32Array.from([2000, 2100, 2200]),
    };
    const [best] = matchAgainstIndex(q, buildIndex(entries), { minScore: 0 });

    expect(best?.matchStartMs).toBe(2000);
    expect(best?.matchEndMs).toBe(2200);
    expect(best?.deltaMs).toBeCloseTo(28000, -2);
    expect(best?.referenceOffsetMs).toBeCloseTo(30000, -2);
  });

  it("absorbs a one-bucket jitter into the same spike", () => {
    // OFFSET_BUCKET_TOLERANCE. Three hashes at a 1000 ms offset and three one
    // hop away are one spike of six, not two spikes of three.
    const entries = [
      { hash: 1, workId: "a", offsetMs: 1000 },
      { hash: 2, workId: "a", offsetMs: 1000 },
      { hash: 3, workId: "a", offsetMs: 1000 },
      { hash: 4, workId: "a", offsetMs: 1000 + Math.round(OFFSET_BUCKET_MS) },
      { hash: 5, workId: "a", offsetMs: 1000 + Math.round(OFFSET_BUCKET_MS) },
      { hash: 6, workId: "a", offsetMs: 1000 + Math.round(OFFSET_BUCKET_MS) },
    ];
    const q = {
      hashes: Int32Array.from([1, 2, 3, 4, 5, 6]),
      offsetsMs: Int32Array.from([0, 0, 0, 0, 0, 0]),
    };
    const [best] = matchAgainstIndex(q, buildIndex(entries), { minScore: 0 });
    expect(best?.score).toBe(6);
  });

  it("does not merge two genuinely separate offsets", () => {
    // The other side of the same rule: five hops apart is five hops apart.
    const far = Math.round(5 * OFFSET_BUCKET_MS);
    const entries = [
      { hash: 1, workId: "a", offsetMs: 1000 },
      { hash: 2, workId: "a", offsetMs: 1000 },
      { hash: 3, workId: "a", offsetMs: 1000 },
      { hash: 4, workId: "a", offsetMs: 1000 + far },
      { hash: 5, workId: "a", offsetMs: 1000 + far },
    ];
    const q = {
      hashes: Int32Array.from([1, 2, 3, 4, 5]),
      offsetsMs: Int32Array.from([0, 0, 0, 0, 0]),
    };
    const [best] = matchAgainstIndex(q, buildIndex(entries), { minScore: 0 });
    expect(best?.score).toBe(3);
  });

  it("returns nothing when no hash is shared at all", () => {
    const entries = [{ hash: 1, workId: "a", offsetMs: 0 }];
    const q = { hashes: Int32Array.from([2, 3]), offsetsMs: Int32Array.from([0, 0]) };
    expect(matchAgainstIndex(q, buildIndex(entries), { minScore: 0 })).toEqual([]);
  });

  it("orders candidates by score and breaks ties deterministically", () => {
    const entries = [
      { hash: 1, workId: "b", offsetMs: 0 },
      { hash: 2, workId: "b", offsetMs: 0 },
      { hash: 1, workId: "a", offsetMs: 0 },
      { hash: 2, workId: "a", offsetMs: 0 },
      { hash: 3, workId: "c", offsetMs: 0 },
      { hash: 1, workId: "c", offsetMs: 0 },
      { hash: 2, workId: "c", offsetMs: 0 },
    ];
    const q = {
      hashes: Int32Array.from([1, 2, 3]),
      offsetsMs: Int32Array.from([0, 0, 0]),
    };
    const out = matchAgainstIndex(q, buildIndex(entries), { minScore: 0 });
    expect(out.map((c) => c.workId)).toEqual(["c", "a", "b"]);
  });
});

/* ------------------------------------------------------- true positives -- */

describe("the degradation matrix (§8)", () => {
  /** Assert the correct work wins, above threshold, at the correct offset. */
  function expectMatch(i: number, fp: Fingerprint): number {
    const results = matchAgainstIndex(fp, index, { minScore: 0 });
    const top = results[0];
    expect(top?.workId).toBe(workId(i));
    expect(top!.score).toBeGreaterThanOrEqual(MATCH_SCORE_THRESHOLD);
    // §8 point (c): asserting the offset, not just the identity, is what proves
    // the histogram is implemented rather than "some hash collided a lot".
    // Within two buckets of the excerpt's true position.
    expect(Math.abs(top!.deltaMs - EXCERPT_START_MS)).toBeLessThanOrEqual(2 * HOP_MS);
    return top!.score;
  }

  it("matches a clean 10-second excerpt from the middle, at the right offset", () => {
    for (let i = 0; i < N; i++) expectMatch(i, query(i));
  });

  it("matches a whole track against itself", () => {
    for (let i = 0; i < N; i++) {
      const results = matchAgainstIndex(
        fingerprint(tracks[i]!, { shifts: QUERY_SHIFTS }),
        index,
        { minScore: 0 },
      );
      expect(results[0]?.workId).toBe(workId(i));
      expect(Math.abs(results[0]!.deltaMs)).toBeLessThanOrEqual(2 * HOP_MS);
    }
  });

  it("is unaffected by gain — the same landmarks, not merely a similar score", () => {
    // §2: "Level changes are therefore a non-issue by construction, not merely
    // 'survived'." 0.25 and 4 are exact powers of two, so every float scales
    // exactly and the fingerprint is bit-identical. §8 says a score drop here is
    // "worth investigating, not shrugging off" — this asserts there is no drop
    // at all to investigate.
    for (let i = 0; i < N; i++) {
      const base = query(i);
      for (const factor of [0.25, 4]) {
        const scaled = query(i, (clip) => gain(clip, factor));
        expect(Array.from(scaled.hashes)).toEqual(Array.from(base.hashes));
        expect(Array.from(scaled.offsetsMs)).toEqual(Array.from(base.offsetsMs));
      }
    }
  });

  it("survives a non-power-of-two gain change too", () => {
    // -6 dB is 0.501187…, which is not exact, so this is the real-world version
    // of the test above: rounding may perturb an ordering somewhere, and the
    // score must not care.
    for (let i = 0; i < N; i++) {
      const clean = matchAgainstIndex(query(i), index, { minScore: 0 })[0]!.score;
      const quiet = expectMatch(i, query(i, (clip) => gain(clip, 0.501187)));
      expect(quiet).toBeGreaterThan(0.95 * clean);
    }
  });

  it("survives band-limiting down to 1.5 kHz", () => {
    // §2's EQ argument: "a peak in the spectrum is still a peak with the same
    // coordinates in a filtered spectrum". A brick-wall low-pass is the harsher
    // version — it does not attenuate the top of the band, it deletes it — and
    // the constellation below the cutoff is unmoved.
    for (const cutoff of [3000, 2000, 1500]) {
      for (let i = 0; i < N; i++) {
        expectMatch(i, query(i, (clip) => lowPass(clip, cutoff)));
      }
    }
  });

  it("matches excerpts down to three seconds", () => {
    for (const seconds of [10, 5, 3]) {
      for (let i = 0; i < N; i++) expectMatch(i, query(i, (c) => c, seconds));
    }
  });

  it("degrades gracefully with SNR rather than falling off a cliff", () => {
    // §8's expectation for the noise row, and the reason the assertion is a
    // *proportion* rather than an all-of-40: Wang's own Figure 4 reports 50%
    // recognition at about -6 dB for a 10-second clip, so a test demanding
    // every track at every SNR would be demanding better than the paper.
    //
    // The numbers on MATCH_SCORE_THRESHOLD are where these bounds come from.
    const expectations: [number, number][] = [
      [30, 1.0],
      [20, 0.9],
      [15, 0.85],
      [10, 0.7],
      [6, 0.5],
    ];
    let previous = Number.POSITIVE_INFINITY;
    for (const [snr, floor] of expectations) {
      let detected = 0;
      for (let i = 0; i < N; i++) {
        const results = matchAgainstIndex(
          query(i, (clip, seed) => addNoise(clip, snr, seed)),
          index,
          { minScore: 0 },
        );
        const mine = results.find((r) => r.workId === workId(i));
        if (
          results[0]?.workId === workId(i) &&
          (mine?.score ?? 0) >= MATCH_SCORE_THRESHOLD &&
          Math.abs(mine!.deltaMs - EXCERPT_START_MS) <= 2 * HOP_MS
        ) {
          detected++;
        }
      }
      const rate = detected / N;
      expect(rate).toBeGreaterThanOrEqual(floor);
      // Monotone: less noise never detects less. This is the "not cliff-edge"
      // half, and it is the half a lucky threshold cannot fake.
      expect(rate).toBeLessThanOrEqual(previous + 1e-9);
      previous = rate;
    }
  });

  it("still identifies the right work under noise it cannot claim", () => {
    // Discontinuity tolerance, §1.6: even where the score has fallen below the
    // threshold, the surviving points still line up, so the *ranking* is right
    // long after the confidence has gone. That separation — right answer, not
    // enough evidence — is what a threshold is for.
    let ranked = 0;
    for (let i = 0; i < N; i++) {
      const results = matchAgainstIndex(
        query(i, (clip, seed) => addNoise(clip, 0, seed)),
        index,
        { minScore: 0 },
      );
      if (results[0]?.workId === workId(i)) ranked++;
    }
    expect(ranked).toBe(N);
  });
});

/* --------------------------------------- the documented non-robustness -- */

describe("what the algorithm cannot do (§2)", () => {
  it("does NOT match a 5% speed change, and that is the expected result", () => {
    // Not a gap in the tests — the tested behaviour. A hash is the exact
    // quantised triple (f1, f2, Δt); a playback-speed change rescales both axes,
    // so every one of those bin indices moves and the equality lookup misses.
    // The keys have diverged; no threshold reaches them.
    //
    // §8: "A pitch-shift test that unexpectedly *passes* is a signal something's
    // wrong with the test's degradation, not evidence the matcher secretly
    // handles pitch shift."
    for (let i = 0; i < N; i++) {
      const results = matchAgainstIndex(
        query(i, (clip) => changeSpeed(clip, 1.05)),
        index,
        { minScore: 0 },
      );
      const mine = results.find((r) => r.workId === workId(i));
      expect(mine?.score ?? 0).toBeLessThan(MATCH_SCORE_THRESHOLD);
    }
  });

  it("does not match a 2% speed change either", () => {
    // The tolerance bounds §2 cites for other systems — 4% for Philips, 2% for
    // Waveprint — do not apply to plain linear-frequency landmark hashing.
    for (let i = 0; i < N; i++) {
      const results = matchAgainstIndex(
        query(i, (clip) => changeSpeed(clip, 1.02)),
        index,
        { minScore: 0 },
      );
      const mine = results.find((r) => r.workId === workId(i));
      expect(mine?.score ?? 0).toBeLessThan(MATCH_SCORE_THRESHOLD);
    }
  });
});

/* ------------------------------------------------------ false positives -- */

describe("the leave-one-out calibration (§8, §2.3.1)", () => {
  /**
   * Every track queried against every *other* track — both as a 10-second
   * excerpt and whole — collecting the score of each non-matching pair.
   *
   * Filtering the self-work out of one full-index query is exactly equivalent
   * to rebuilding the index without it: a work's score depends only on its own
   * postings. It is also N times faster, which is the difference between this
   * suite running and this suite being skipped.
   */
  let memo: number[] | null = null;

  function crossMatrix(): number[] {
    // Memoised: both tests below need the whole distribution, and recomputing
    // 80 four-shift queries against a 40-work index to get the same numbers
    // twice is most of this file's runtime.
    if (memo) return memo;
    const scores: number[] = [];
    for (let i = 0; i < N; i++) {
      for (const fp of [query(i), fingerprint(tracks[i]!, { shifts: QUERY_SHIFTS })]) {
        for (const c of matchAgainstIndex(fp, index, { minScore: 0, limit: 999 })) {
          if (c.workId !== workId(i)) scores.push(c.score);
        }
      }
    }
    memo = scores.sort((a, b) => a - b);
    return memo;
  }

  it("puts no unrelated pair above the threshold, out of thousands", () => {
    const scores = crossMatrix();

    // The measurement itself, pinned. A single "unrelated audio doesn't match"
    // assertion is worthless — §8 says so directly — because any threshold,
    // however miscalibrated, passes it. What has to hold is the shape of the
    // whole distribution.
    expect(scores.length).toBeGreaterThan(2000);
    expect(scores.at(-1)!).toBeLessThan(MATCH_SCORE_THRESHOLD);

    const pct = (p: number) => scores[Math.floor(scores.length * p)]!;
    expect(pct(0.5)).toBeLessThan(30);
    expect(pct(0.99)).toBeLessThan(150);
    expect(pct(0.999)).toBeLessThan(220);
  });

  it("keeps a clear gap between the worst coincidence and the worst true match", () => {
    // §8's second property, and the one that actually validates the threshold:
    // not "the threshold happens to sit between them" but a comfortable margin
    // on both sides. If this ever narrows, the fan-out and density of §3 need
    // re-tuning before the matcher is trustworthy at a real catalogue size.
    const worstFalse = crossMatrix().at(-1)!;

    let worstTrue = Number.POSITIVE_INFINITY;
    for (let i = 0; i < N; i++) {
      for (const degrade of [
        (c: Float32Array) => c,
        (c: Float32Array) => lowPass(c, 1500),
        (c: Float32Array) => gain(c, 0.501187),
      ]) {
        const results = matchAgainstIndex(query(i, degrade), index, { minScore: 0 });
        worstTrue = Math.min(worstTrue, results[0]!.score);
      }
    }

    expect(worstFalse).toBeLessThan(MATCH_SCORE_THRESHOLD);
    expect(worstTrue).toBeGreaterThan(MATCH_SCORE_THRESHOLD);
    expect(worstTrue).toBeGreaterThan(2 * worstFalse);
  });

  it("does not confuse two arrangements of the same melody", () => {
    // §3.3: the algorithm is "very sensitive to which particular version of a
    // track has been sampled". The last four tracks are two pairs sharing a
    // melody seed and differing in tempo and timbre — the case a corpus of
    // acoustically unrelated tracks never exercises.
    for (const [a, b] of [
      [N - 4, N - 2],
      [N - 3, N - 1],
    ]) {
      const results = matchAgainstIndex(query(a!), index, { minScore: 0, limit: 999 });
      expect(results[0]?.workId).toBe(workId(a!));
      const sibling = results.find((r) => r.workId === workId(b!));
      expect(sibling?.score ?? 0).toBeLessThan(MATCH_SCORE_THRESHOLD);
    }
  });
});

/* ------------------------------------------------------------ structure -- */

describe("transparency (§1.6)", () => {
  it("surfaces both tracks in a mixture of two, at both correct offsets", () => {
    // "Multiple overlapping tracks mixed together can each be independently
    // identified", because peaks approximately superpose. §8 names this as a
    // sanity check worth running, and it is the shape of the real product case:
    // a song under a talking-head video is a mixture.
    //
    // **Measured, and weaker than the paper's claim reads.** Across six mixed
    // pairs at matched RMS, both tracks always take the top two places and both
    // recover the right offset — but the *stronger* of the two takes most of
    // the score, and the weaker often lands below MATCH_SCORE_THRESHOLD (130
    // against 596 for the first pair here). The mechanism is our density quota:
    // it is a single budget of 32 slots per half-second window, shared, so the
    // track with the denser or louder constellation evicts the other's peaks
    // rather than the two coexisting. Superposition holds for the *spectrum*;
    // it does not survive a hard cap applied afterwards.
    //
    // So the assertion is what the pipeline actually delivers: both identified
    // and separated from the field, not both claimable.
    for (const [x, y] of [
      [0, 1],
      [6, 7],
      [10, 11],
    ]) {
      const a = excerpt(tracks[x!]!, EXCERPT_START_S, 10);
      const b = excerpt(tracks[y!]!, EXCERPT_START_S, 10);
      const mixed = new Float32Array(a.length);
      for (let i = 0; i < mixed.length; i++) mixed[i] = a[i]! + b[i]!;

      const results = matchAgainstIndex(
        fingerprint(mixed, { shifts: QUERY_SHIFTS }),
        index,
        { minScore: 0, limit: 999 },
      );

      expect(results.slice(0, 2).map((r) => r.workId).sort()).toEqual(
        [workId(x!), workId(y!)].sort(),
      );
      for (const id of [workId(x!), workId(y!)]) {
        const hit = results.find((r) => r.workId === id)!;
        expect(Math.abs(hit.deltaMs - EXCERPT_START_MS)).toBeLessThanOrEqual(2 * HOP_MS);
      }
      // Both stand clear of the coincidence floor, which is the part that shows
      // two independent identifications rather than one plus an accident.
      const thirdPlace = results[2]?.score ?? 0;
      expect(results[1]!.score).toBeGreaterThan(1.5 * thirdPlace);
      // And the louder of the two is claimable on its own.
      expect(results[0]!.score).toBeGreaterThanOrEqual(MATCH_SCORE_THRESHOLD);
    }
  });
});

describe("sub-hop query analysis", () => {
  it("is what makes a non-hop-aligned excerpt matchable", () => {
    // The measurement recorded on QUERY_SHIFTS, as an assertion. A cut at an
    // arbitrary sample offset displaces the query's STFT grid from the
    // reference's, Δt is a difference of frame indices, and the hash breaks.
    // Analysing the query at four alignments is worth an order of magnitude.
    const clip = excerpt(tracks[0]!, EXCERPT_START_S, 10);
    const one = matchAgainstIndex(fingerprint(clip, { shifts: 1 }), index, { minScore: 0 })[0];
    const four = matchAgainstIndex(fingerprint(clip, { shifts: 4 }), index, { minScore: 0 })[0];

    expect(one?.workId).toBe(workId(0));
    expect(four?.workId).toBe(workId(0));
    expect(four!.score).toBeGreaterThan(5 * one!.score);
  });

  it("is unnecessary when the cut happens to be hop-aligned", () => {
    // The control for the test above: with the grids in phase, one pass already
    // recovers most of the reference's tokens, and the shifts add little. If
    // this ever fails, the loss being attributed to grid displacement is coming
    // from somewhere else.
    const hopAlignedStart = (107 * 512) / 11025;
    const clip = excerpt(tracks[0]!, hopAlignedStart, 10);
    const one = matchAgainstIndex(fingerprint(clip, { shifts: 1 }), index, { minScore: 0 })[0]!;
    expect(one.workId).toBe(workId(0));
    expect(one.score).toBeGreaterThan(0.8 * fingerprint(clip).hashes.length);
  });
});
