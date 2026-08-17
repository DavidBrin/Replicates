import type { Landmarks } from "./hash";
import { HOP_MS } from "./spectrogram";

/**
 * Matching: the offset histogram, and a score that is a count.
 *
 * `research/06-audio-fingerprinting.md` §1.5 is the whole of this file, and the
 * trick it describes is worth restating because it is the algorithm's second
 * good idea (combinatorial hashing being the first).
 *
 * Every hash the query and a reference share yields a pair of times: where it
 * occurs in the query, and where it occurs in the reference. If the query
 * really is a clip of that reference, then for *every* correctly-matched hash
 * the reference time is the query time plus one and the same offset — the true
 * alignment — so the differences collapse into a single histogram bin. If the
 * query is unrelated, the shared hashes are coincidences of the hash's finite
 * entropy, they land at unrelated offsets, and the differences spread flat.
 *
 * So "does this look like a match" becomes "is there an outlier bin in a 1-D
 * histogram" — sortable in O(N log N), and a `GROUP BY` in SQL. The paper
 * explicitly rejects the general form of the same question (2-D robust
 * regression, Hough transforms) as "overly general, computationally expensive,
 * and susceptible to outliers".
 *
 * Two structural consequences §1.6 calls out, which are why this is worth doing
 * rather than merely correlating waveforms:
 *
 *   - **Discontinuities are irrelevant.** A dropout removes points from the
 *     scatter; the survivors still line up. The paper reports a significant
 *     match from a heavily corrupted 15-second sample with only 1–2% of hash
 *     tokens surviving.
 *   - **Overlapping tracks are separable.** Peaks approximately superpose, so a
 *     mix of two references produces two spikes and can be claimed twice.
 */

/**
 * The histogram bucket: one STFT hop, 46.44 ms.
 *
 * §6's example SQL rounds to a flat 50 ms; this uses the hop itself because
 * that is what the quantisation actually is — the offset difference between a
 * query hash and a reference hash can only take values near multiples of the
 * hop, so a bucket that is not the hop puts a beat frequency into the
 * histogram.
 */
export const OFFSET_BUCKET_MS = HOP_MS;

/**
 * Sum each bucket with its immediate neighbours before scoring: a 3-bucket
 * boxcar, ±1.
 *
 * Not smoothing for its own sake — it repairs a specific and unavoidable
 * misalignment. A query is cut from an arbitrary *sample* offset, so its STFT
 * grid is displaced from the reference's by up to half a hop. The two sides
 * therefore analyse slightly different windows of the same audio and a peak can
 * land one frame either side of where it landed in the reference. Without the
 * boxcar a true match's spike splits across two adjacent buckets and each half
 * is compared against a threshold sized for the whole.
 *
 * ±1 rather than ±2, matching audfprint's `--match-win` default of 2 frames.
 * Widening it raises the false-positive floor linearly — a wider window
 * collects more of the flat coincidence background — for jitter that is
 * bounded at about 1.5 hops by construction.
 */
export const OFFSET_BUCKET_TOLERANCE = 1;

/**
 * The score at which a match is declared: **250 time-aligned hash tokens**.
 *
 * Derived by §2.3.1's procedure, not chosen: measure the empirical distribution
 * of scores among *incorrectly* matching works, decide an acceptable
 * false-positive rate, and read the threshold off the tail. The paper's own
 * worked rates are 0.1% and 0.01%, "depending on the application".
 *
 * **The false-positive distribution.** The §8 leave-one-out cross-matrix, on
 * the synthetic corpus in `__tests__/synthetic-audio.ts`: 40 generated tracks of
 * 20 s, each queried against the 39 others both as a 10-second middle excerpt
 * and whole — 3,086 non-matching (query, work) pairs that produced any score at
 * all.
 *
 *     median   9      p95   52      p99   93      p99.9  154      max  204
 *
 * The tail is clean exponential: 52 → 93 → 154 across three decades of tail
 * probability is 25.5 and 26.5 score points per e-fold. Extrapolating that fit
 * from p99.9 downward:
 *
 *     10^-4 per pair . . . 214        10^-5 per pair . . . 274
 *
 * **250 sits at about 2.5 × 10^-5** — stricter than both of the paper's example
 * rates, and above every one of the 3,086 coincidences actually observed.
 *
 * **The true-positive side**, same corpus, 10-second excerpt taken from the
 * middle at a deliberately non-hop-aligned sample offset. Worst track of 40:
 *
 *     clean . . . . . . . . . 1298     low-pass 3 kHz . . . . 1131
 *     gain x0.25 / x4 . . . . 1298     low-pass 2 kHz . . . .  799
 *     gain -6 dB  . . . . . . 1298     low-pass 1.5 kHz . . .  475
 *
 * Every one of those is 40/40 above the threshold with the correct work *and*
 * the correct offset. The thinnest margin among them is the 1.5 kHz low-pass at
 * 2.3x the worst observed coincidence; the clean case is 6.4x.
 *
 * **Where it stops.** Additive white noise, proportion of 40 tracks clearing
 * 250: +30 dB 40/40, +20 dB 38/40, +15 dB 38/40, +10 dB 34/40, +6 dB 25/40,
 * 0 dB 11/40, -6 dB 3/40. Monotone and gradual — §8's "degrade gracefully with
 * SNR, not cliff-edge" — and short of Wang's Figure 4, which reports 50%
 * recognition at about -6 dB for a 10-second clip. Two honest reasons for the
 * shortfall rather than one excuse: our noise is white across the whole
 * analysis band where the paper's was a recording of a pub (heavily
 * low-frequency), and the paper's 50% is a system-level recognition rate
 * against its own threshold rather than against ours.
 *
 * **This number must be re-derived, not inherited.** §2.3.1 is explicit that
 * the false-positive rate is a function of database *size*, and 40 synthetic
 * tracks is not a catalogue. Re-run the cross-matrix in `match.test.ts` against
 * the real reference set before trusting this at any larger scale — and note
 * that it is calibrated for the four-shift query analysis in `index.ts`, so
 * changing `QUERY_SHIFTS` invalidates it too.
 */
export const MATCH_SCORE_THRESHOLD = 250;

/** One occurrence of a hash in the reference catalogue. */
export interface Posting {
  readonly workId: string;
  /** Anchor time from the start of the reference work. */
  readonly offsetMs: number;
}

export interface MatchCandidate {
  readonly workId: string;
  /**
   * The histogram peak height: the number of matching, time-aligned hash
   * tokens. §2.3, quoted directly — "the score is simply the number of
   * matching, time-aligned hash tokens". Not a normalised similarity, not a
   * probability. A raw count, which is why `claims.score` is an `integer` and
   * why a dispute can be argued about it.
   */
  readonly score: number;
  /**
   * reference time − query time, at the winning bucket. For a query that is an
   * excerpt of the reference, this *is* the excerpt's start position inside the
   * reference work.
   */
  readonly deltaMs: number;
  /** First and last query-side anchor time contributing to the winning bucket
   * — the matched span in the *claimed video's* timeline. */
  readonly matchStartMs: number;
  readonly matchEndMs: number;
  /** Where `matchStartMs` sits in the reference work. `claims.reference_offset_ms`. */
  readonly referenceOffsetMs: number;
}

export interface MatchOptions {
  readonly minScore?: number;
  readonly bucketMs?: number;
  readonly tolerance?: number;
  readonly limit?: number;
}

/** hash → every place it occurs. §1.5's inverted index, in memory. */
export function buildIndex(
  entries: Iterable<{ readonly hash: number; readonly workId: string; readonly offsetMs: number }>,
): Map<number, Posting[]> {
  const index = new Map<number, Posting[]>();
  for (const { hash, workId, offsetMs } of entries) {
    const postings = index.get(hash);
    if (postings) postings.push({ workId, offsetMs });
    else index.set(hash, [{ workId, offsetMs }]);
  }
  return index;
}

interface Bucket {
  count: number;
  minQueryMs: number;
  maxQueryMs: number;
}

/**
 * Score a query's landmarks against an in-memory index.
 *
 * This is the reference implementation of the scoring rule. The production path
 * runs the same histogram inside Postgres (`adapters/repositories/content-id.ts`
 * — §6 argues for that: aggregating tens of thousands of candidate rows in the
 * database beats shipping them over the wire to be aggregated). Keeping both
 * is not duplication for its own sake; the repository suite asserts that they
 * agree row for row, which is the only cheap way to catch the SQL and the rule
 * drifting apart.
 *
 * At most one candidate per work — its best bucket. A work genuinely reused
 * twice in one upload produces two spikes and would deserve two claims; that is
 * a product decision (how many claims may one work make on one video?) rather
 * than a matching one, and reporting the strongest is the honest default until
 * it is made.
 */
export function matchAgainstIndex(
  query: Landmarks,
  index: ReadonlyMap<number, readonly Posting[]>,
  options: MatchOptions = {},
): MatchCandidate[] {
  const bucketMs = options.bucketMs ?? OFFSET_BUCKET_MS;
  const tolerance = options.tolerance ?? OFFSET_BUCKET_TOLERANCE;
  const minScore = options.minScore ?? MATCH_SCORE_THRESHOLD;
  const limit = options.limit ?? 20;

  // work → bucket → tally. A nested map rather than a composite string key: the
  // inner map is iterated per work when the boxcar runs, and a flat
  // `${workId}:${bucket}` key would have to be re-parsed to do it.
  const byWork = new Map<string, Map<number, Bucket>>();

  const { hashes, offsetsMs } = query;
  for (let i = 0; i < hashes.length; i++) {
    const postings = index.get(hashes[i]!);
    if (!postings) continue;
    const queryMs = offsetsMs[i]!;
    for (const posting of postings) {
      const bucket = Math.round((posting.offsetMs - queryMs) / bucketMs);
      let buckets = byWork.get(posting.workId);
      if (!buckets) {
        buckets = new Map();
        byWork.set(posting.workId, buckets);
      }
      const tally = buckets.get(bucket);
      if (tally) {
        tally.count++;
        if (queryMs < tally.minQueryMs) tally.minQueryMs = queryMs;
        if (queryMs > tally.maxQueryMs) tally.maxQueryMs = queryMs;
      } else {
        buckets.set(bucket, { count: 1, minQueryMs: queryMs, maxQueryMs: queryMs });
      }
    }
  }

  const candidates: MatchCandidate[] = [];
  for (const [workId, buckets] of byWork) {
    const best = bestBucket(buckets, tolerance);
    if (!best || best.score < minScore) continue;
    const deltaMs = Math.round(best.bucket * bucketMs);
    candidates.push({
      workId,
      score: best.score,
      deltaMs,
      matchStartMs: best.minQueryMs,
      matchEndMs: best.maxQueryMs,
      referenceOffsetMs: best.minQueryMs + deltaMs,
    });
  }

  // Score descending; work id ascending to break ties, so a caller that takes
  // the first row gets the same row on every run.
  candidates.sort((a, b) => b.score - a.score || (a.workId < b.workId ? -1 : 1));
  return candidates.slice(0, limit);
}

interface BestBucket {
  readonly bucket: number;
  readonly score: number;
  readonly minQueryMs: number;
  readonly maxQueryMs: number;
}

/**
 * The ±`tolerance` boxcar of `OFFSET_BUCKET_TOLERANCE`, and its argmax.
 *
 * **The score is summed across the boxcar; the span is taken from the centre
 * bucket alone.** That asymmetry is deliberate and was measured. The boxcar
 * exists to reunite a true spike that sub-hop jitter split across adjacent
 * buckets, so its neighbours belong in the *count*. But a neighbour bucket also
 * collects unrelated coincidences at nearby offsets, and the span is a min and
 * a max — statistics a single outlier moves all by itself.
 *
 * Observed on a six-second reuse pasted 25 s into a minute-long unrelated
 * upload: the winning bucket held 1,026 contributions spanning 24973–30755 ms,
 * which is the pasted region to within a hop. Its neighbours held tens of
 * contributions including one at 18518 ms, and taking min/max across all three
 * reported a claim starting six and a half seconds before the borrowed audio
 * did. A claim that overstates which part of a video used the work is worse
 * than one that understates it, because the span is the evidence the uploader
 * is invited to check.
 */
function bestBucket(
  buckets: ReadonlyMap<number, Bucket>,
  tolerance: number,
): BestBucket | null {
  let best: BestBucket | null = null;
  for (const [bucket, centre] of buckets) {
    let score = 0;
    for (let d = -tolerance; d <= tolerance; d++) {
      score += buckets.get(bucket + d)?.count ?? 0;
    }
    // Ties go to the earlier bucket, so the reported offset is stable when a
    // spike sits exactly between two.
    if (!best || score > best.score || (score === best.score && bucket < best.bucket)) {
      best = {
        bucket,
        score,
        minQueryMs: centre.minQueryMs,
        maxQueryMs: centre.maxQueryMs,
      };
    }
  }
  return best;
}
